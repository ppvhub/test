
#!/usr/bin/env python3
"""Test-sync recent WordPress posts that expose direct HTTPS MP4 URLs."""

import base64
import html
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from itertools import islice
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

API = os.getenv(
    "WORDPRESS_API",
    "https://baddiehub.com/wp-json/wp/v2/posts",
)
SITE = "https://baddiehub.com"

DATA = Path("assets/data/videos.json")
THUMBS = Path("assets/thumb")

USER_AGENT = "Mozilla/5.0 (compatible; VideoCatalogSync/1.0)"
REQUEST_TIMEOUT = 15
MAX_POSTS = 20


def log(message):
    print(message, flush=True)


def fetch(url, timeout=REQUEST_TIMEOUT):
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/json,*/*",
        },
    )
    with urlopen(req, timeout=timeout) as response:
        return response.read(), response.headers.get("Content-Type", "")


def decode_url(video):
    """Decode the existing catalog's URL format."""
    try:
        raw = base64.b64decode(video["encrypted"]).decode("latin1")[::-1]
        key = video["iv"]
        if not key:
            return ""
        return "".join(
            chr(ord(char) ^ ord(key[i % len(key)]))
            for i, char in enumerate(raw)
        )
    except Exception:
        return ""


def direct_mp4(url):
    try:
        parsed = urlparse(html.unescape(url.strip()))
        return (
            parsed.scheme == "https"
            and bool(parsed.netloc)
            and parsed.path.lower().endswith(".mp4")
        )
    except Exception:
        return False


def meta(content, key):
    """Read metadata regardless of whether content/property order varies."""
    escaped_key = re.escape(key)

    # Match a meta tag containing the requested attribute.
    tag_pattern = (
        r"<meta\b(?=[^>]*\b(?:itemprop|property|name)\s*=\s*"
        r"""["']"""
        + escaped_key
        + r"""["'])[^>]*>"""
    )

    for tag in re.findall(tag_pattern, content, flags=re.I):
        match = re.search(
            r"""\bcontent\s*=\s*["']([^"']+)["']""",
            tag,
            flags=re.I,
        )
        if match:
            return html.unescape(match.group(1)).strip()

    # Fallback for JSON-LD properties.
    match = re.search(
        r"""["']"""
        + escaped_key
        + r"""["']\s*:\s*["']([^"']+)["']""",
        content,
        flags=re.I,
    )
    return html.unescape(match.group(1)).strip() if match else ""


def find_video_url(content):
    # Primary source: schema.org VideoObject contentUrl metadata.
    value = meta(content, "contentUrl")
    if direct_mp4(value):
        return value

    # Fallback: direct MP4 URLs embedded in HTML or scripts.
    candidates = re.findall(
        r"""https?://[^"'\s<>\\]+?\.mp4(?:\?[^"'\s<>\\]*)?""",
        content,
        flags=re.I,
    )

    for value in candidates:
        value = html.unescape(value).replace("\\/", "/").rstrip("),;")
        if direct_mp4(value):
            return value

    return ""


def parse_post(post):
    link = post.get("link", "")
    if not link:
        log("SKIP: post has no link")
        return None

    try:
        raw, _ = fetch(link)
        page = raw.decode("utf-8", "replace")
    except Exception as error:
        log(f"SKIP fetch {link}: {error}")
        return None

    video_url = find_video_url(page)
    if not video_url:
        log(f"NO MP4 found: {link}")
        return None

    title_html = (
        (post.get("title") or {}).get("rendered")
        or post.get("slug")
        or "Untitled"
    )
    title = re.sub(
        r"\s+",
        " ",
        html.unescape(re.sub(r"<[^>]+>", "", title_html)),
    ).strip()

    thumb = meta(page, "og:image") or meta(page, "thumbnailUrl")

    if not thumb:
        media_items = (
            post.get("_embedded", {}).get("wp:featuredmedia", [])
        )
        if media_items:
            thumb = media_items[0].get("source_url", "")

    date = (
        meta(page, "uploadDate")
        or post.get("date_gmt")
        or post.get("date")
        or ""
    )

    return {
        "source_id": str(post.get("id", "")),
        "title": title,
        "video_url": video_url,
        "thumb_url": thumb,
        "date": date,
        "link": link,
    }


def get_posts():
    """Fetch WordPress posts in newest-first order."""
    page_number = 1

    while True:
        url = (
            f"{API}?per_page=100&page={page_number}"
            "&_embed=1&orderby=date&order=desc"
        )
        log(f"Fetching WordPress API page {page_number}...")

        try:
            raw, _ = fetch(url)
        except Exception as error:
            if page_number > 1:
                log(f"End of pagination: {error}")
                break
            raise RuntimeError(
                f"Could not read WordPress API: {error}"
            ) from error

        try:
            posts = json.loads(raw)
        except Exception as error:
            raise RuntimeError(
                f"Invalid JSON from WordPress API: {error}"
            ) from error

        if not isinstance(posts, list) or not posts:
            break

        yield from posts

        if len(posts) < 100:
            break

        page_number += 1
        time.sleep(0.15)


def encode_url(url, video_id):
    """Keep the existing catalog's inferred encryption structure."""
    iv = (
        f"HYL{video_id.replace('video', '')}"
        f"{base64.b32encode(os.urandom(4)).decode('ascii')[:6]}"
    )
    encoded = "".join(
        chr(ord(char) ^ ord(iv[i % len(iv)]))
        for i, char in enumerate(url)
    )[::-1]

    return {
        "provider": "videy",
        "encrypted": base64.b64encode(
            encoded.encode("latin1")
        ).decode("ascii"),
        "iv": iv,
        "ver": 1,
    }


def download_thumb(url, target):
    if not url or not url.startswith("https://"):
        log(f"SKIP thumbnail: invalid URL ({url})")
        return False

    try:
        raw, content_type = fetch(url, timeout=REQUEST_TIMEOUT)

        if content_type and not content_type.lower().startswith("image/"):
            log(f"SKIP thumbnail: unexpected content type {content_type}")
            return False

        from io import BytesIO
        from PIL import Image

        with Image.open(BytesIO(raw)) as image_file:
            image = image_file.convert("RGB")
            image.thumbnail((960, 720))
            target.parent.mkdir(parents=True, exist_ok=True)
            image.save(target, "WEBP", quality=84, method=5)

        return True

    except Exception as error:
        log(f"Thumbnail unavailable {url}: {error}")
        return False


def main():
    if not DATA.exists():
        raise RuntimeError(f"Missing catalog file: {DATA}")

    db = json.loads(DATA.read_text(encoding="utf-8"))
    if not isinstance(db, dict) or not isinstance(db.get("videos", []), list):
        raise RuntimeError("Catalog JSON must contain a videos array.")

    videos = db.get("videos", [])
    known_urls = {
        decode_url(video.get("video", {}))
        for video in videos
        if isinstance(video, dict)
    }
    known_urls.discard("")

    known_ids = {video.get("id") for video in videos}
    numeric_ids = [
        int(match.group(1))
        for video_id in known_ids
        if (
            match := re.fullmatch(r"video(\d+)", str(video_id))
        )
    ]
    next_num = max(numeric_ids or [0]) + 1

    # Limit the first test to the 20 newest posts.
    posts = list(islice(get_posts(), MAX_POSTS))
    log(f"API posts selected for test: {len(posts)}")

    additions = []
    seen_new = set()

    # Assign IDs oldest-to-newest, then reverse additions for display.
    for index, post in enumerate(reversed(posts), start=1):
        log(
            f"[{index}/{len(posts)}] Checking post: "
            f"{post.get('link', '(no link)')}"
        )

        item = parse_post(post)
        if not item:
            continue

        video_url = item["video_url"]

        if video_url in known_urls or video_url in seen_new:
            log(f"SKIP duplicate video: {item['title']}")
            continue

        video_id = f"video{next_num:03d}"
        thumbnail_path = THUMBS / f"{video_id}.webp"

        if not download_thumb(item["thumb_url"], thumbnail_path):
            try:
                thumbnail_path.unlink(missing_ok=True)
            except OSError:
                pass

            log(f"SKIP no usable thumbnail: {item['title']}")
            continue

        additions.append(
            {
                "id": video_id,
                "title": item["title"] or f"Video {next_num}",
                "thumb": f"assets/thumb/{video_id}.webp",
                "views": "—",
                "duration": "",
                "video": encode_url(video_url, video_id),
                "source": {
                    "site_id": item["source_id"],
                    "url": item["link"],
                    "date": item["date"],
                },
            }
        )

        known_urls.add(video_url)
        next_num += 1
        log(f"FOUND new video: {item['title']}")

    if additions:
        additions.reverse()
        db["videos"] = additions + videos
        db["version"] = str(db.get("version", "1.3"))
        db["updated"] = datetime.now(timezone.utc).isoformat()

        DATA.write_text(
            json.dumps(db, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    log(f"New MP4 videos added: {len(additions)}")
    log("Sync script finished.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"FATAL: {error}", file=sys.stderr, flush=True)
        raise
