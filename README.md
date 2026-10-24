# v1.2
Contact me on Telegram to get this landing page along with installation guide..

Telegram - @Herrmawann


## Automatic WordPress video sync

GitHub Actions runs `scripts/sync_videos.py` every 6 hours and can also be started manually from **Actions → Sync WordPress videos → Run workflow**. It pages through the WordPress REST API, fetches each post page, and imports only posts with a direct HTTPS `.mp4` URL and a downloadable thumbnail. New items are encrypted using the site's existing `HyLooksEncoder` format and prepended to `assets/data/videos.json`.

The first run scans all posts and may take a while. Review the workflow log after the first run. The source page must expose a direct MP4 URL in its server-rendered HTML for this importer to detect it.
