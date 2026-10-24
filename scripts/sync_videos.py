#!/usr/bin/env python3
"""Sync WordPress posts that expose a direct HTTPS MP4 in their public HTML."""
import base64, html, json, os, re, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

API = os.getenv("WORDPRESS_API", "https://baddiehub.com/wp-json/wp/v2/posts")
SITE = "https://baddiehub.com"
DATA = Path("assets/data/videos.json")
THUMBS = Path("assets/thumb")
USER_AGENT = "Mozilla/5.0 (compatible; VideoCatalogSync/1.0)"

def fetch(url, timeout=30):
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json,*/*"})
    with urlopen(req, timeout=timeout) as res:
        return res.read(), res.headers.get("Content-Type", "")

def decode_url(video):
    try:
        raw = base64.b64decode(video["encrypted"]).decode("latin1")[::-1]
        key = video["iv"]
        return "".join(chr(ord(c) ^ ord(key[i % len(key)])) for i,c in enumerate(raw))
    except Exception:
        return ""

def direct_mp4(url):
    try:
        p = urlparse(html.unescape(url.strip()))
        return p.scheme == "https" and p.path.lower().endswith(".mp4") and bool(p.netloc)
    except Exception:
        return False

def meta(content, key):
    patterns = [
        rf'<meta\b[^>]*(?:itemprop|property|name)=["\']{re.escape(key)}["\'][^>]*>',
    ]
    for pattern in patterns:
        for tag in re.findall(pattern, content, flags=re.I):
            m = re.search(r'\bcontent=["\']([^"\']+)["\']', tag, flags=re.I)
            if m:
                return html.unescape(m.group(1)).strip()
    # Handle either attribute order and JSON-LD video objects.
    m = re.search(rf'["\']{re.escape(key)}["\']\s*:\s*["\']([^"\']+)["\']', content, flags=re.I)
    return html.unescape(m.group(1)).strip() if m else ""

def find_video_url(content):
    # Primary source: schema.org VideoObject contentUrl metadata.
    for key in ("contentUrl", "contenturl"):
        value = meta(content, key)
        if direct_mp4(value):
            return value
    # Fallback: direct MP4 links embedded in page HTML/scripts.
    candidates = re.findall(r'https?://[^"\'\s<>\\]+?\.mp4(?:\?[^"\'\s<>\\]*)?', content, flags=re.I)
    for value in candidates:
        value = html.unescape(value).replace("\\/", "/").rstrip("),;")
        if direct_mp4(value):
            return value
    return ""

def parse_post(post):
    link = post.get("link", "")
    try:
        raw, _ = fetch(link)
        page = raw.decode("utf-8", "replace")
    except Exception as e:
        print(f"SKIP fetch {link}: {e}", file=sys.stderr)
        return None
    video_url = find_video_url(page)
    if not video_url:
        return None
    title_html = (post.get("title") or {}).get("rendered") or post.get("slug") or "Untitled"
    title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", title_html))).strip()
    thumb = meta(page, "og:image")
    if not thumb:
        thumb = meta(page, "thumbnailUrl")
    if not thumb:
        media = post.get("_embedded", {}).get("wp:featuredmedia", [])
        if media:
            thumb = media[0].get("source_url", "")
    date = meta(page, "uploadDate") or post.get("date_gmt") or post.get("date") or ""
    return {"source_id": str(post.get("id", "")), "title": title, "video_url": video_url,
            "thumb_url": thumb, "date": date, "link": link}

def get_posts():
    page = 1
    while True:
        url = f"{API}?per_page=100&page={page}&_embed=1&orderby=date&order=desc"
        try:
            raw, _ = fetch(url)
        except Exception as e:
            # WordPress REST API commonly returns 400 for a page past the end.
            if page > 1:
                break
            raise RuntimeError(f"Could not read WordPress API: {e}")
        try:
            posts = json.loads(raw)
        except Exception as e:
            raise RuntimeError(f"Invalid JSON from API: {e}")
        if not isinstance(posts, list) or not posts:
            break
        yield from posts
        if len(posts) < 100:
            break
        page += 1
        time.sleep(0.15)

def encode_url(url, video_id):
    iv = f"HYL{video_id.replace('video','')}{base64.b32encode(os.urandom(4)).decode('ascii')[:6]}"
    x = "".join(chr(ord(c) ^ ord(iv[i % len(iv)])) for i,c in enumerate(url))[::-1]
    return {"provider":"videy","encrypted":base64.b64encode(x.encode("latin1")).decode("ascii"),"iv":iv,"ver":1}

def download_thumb(url, target):
    if not url or not url.startswith("https://"):
        return False
    try:
        raw, _ = fetch(url)
        # Pillow is installed by the workflow. Avoid saving arbitrary non-image data.
        from PIL import Image
        from io import BytesIO
        im = Image.open(BytesIO(raw)).convert("RGB")
        im.thumbnail((960, 720))
        im.save(target, "WEBP", quality=84, method=5)
        return True
    except Exception as e:
        print(f"Thumbnail unavailable {url}: {e}", file=sys.stderr)
        return False

def main():
    if not DATA.exists():
        raise RuntimeError(f"Missing {DATA}")
    db = json.loads(DATA.read_text(encoding="utf-8"))
    videos = db.get("videos", [])
    known_urls = {decode_url(v.get("video", {})) for v in videos}
    known_urls.discard("")
    known_ids = {v.get("id") for v in videos}
    next_num = max([int(m.group(1)) for vid in known_ids if (m := re.fullmatch(r"video(\d+)", str(vid)))] or [0]) + 1

    posts = list(get_posts())
    print(f"API posts fetched: {len(posts)}")
    # API is newest-first; process in that order, preserve existing catalog entries.
    additions = []
    seen_new = set()
    # Assign increasing IDs from older to newer so numeric-ID sorting keeps newest first.
    for post in reversed(posts):
        item = parse_post(post)
        if not item:
            continue
        url = item["video_url"]
        if url in known_urls or url in seen_new:
            continue
        seen_new.add(url)
        vid = f"video{next_num:03d}"
        thumb_path = THUMBS / f"{vid}.webp"
        if not download_thumb(item["thumb_url"], thumb_path):
            # The catalog format requires a local thumbnail. Remove any partial file and skip safely.
            try: thumb_path.unlink(missing_ok=True)
            except Exception: pass
            print(f"SKIP no usable thumbnail: {item['title']}", file=sys.stderr)
            continue
        additions.append({
            "id": vid,
            "title": item["title"] or f"Video {next_num}",
            "thumb": f"assets/thumb/{vid}.webp",
            "views": "—",
            "duration": "",
            "video": encode_url(url, vid),
            "source": {"site_id": item["source_id"], "url": item["link"], "date": item["date"]}
        })
        known_urls.add(url)
        next_num += 1

    if additions:
        # Reverse back to newest-first; IDs were assigned oldest-to-newest.
        additions.reverse()
        db["videos"] = additions + videos
        db["version"] = str(db.get("version", "1.3"))
        db["updated"] = datetime.now(timezone.utc).isoformat()
        DATA.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"New MP4 videos added: {len(additions)}")

if __name__ == "__main__":
    main()
