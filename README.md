# Remote Viewer

A local-only 24h “master schedule” viewer for your personal video files. Drop videos into `MEDIA_ROOT`, define a single-day schedule, and Remote Viewer starts the correct file at the correct offset so it feels like you tuned into a live feed.

## Requirements

- Node.js 20+ (see `.nvmrc` for the tested version).
- `ffprobe` is bundled via `ffprobe-static`; no system install required.

## Setup

```bash
npm install
```

Create or point `MEDIA_ROOT` at your library (defaults to `<repo>/media`). All files under this folder are addressable by their relative paths.

## Develop

```bash
MEDIA_ROOT=/path/to/videos npm run dev
# open http://localhost:3000
```

The UI is minimal: view “Now Playing,” and the built-in video element jumps to the correct offset. A lightweight poll (~30s) refreshes when programs roll over.

## Notes

- Supported extensions: `.mp4`, `.mkv`, `.mov`, `.avi`, `.m4v`, `.webm`.
- Schedules are in-memory and rebuilt on access with a short cache; reload after adding/removing files.
- Path validation prevents escaping `MEDIA_ROOT`; files are streamed via `/api/media` with range support.
- A schedule is required: store JSON at `data/schedule.json` or use `PUT /api/schedule`. `/api/now-playing` resolves strictly against the schedule (no looping fallback). A simple admin UI is available at `/admin/schedule` for the single-day (24h) editor.
