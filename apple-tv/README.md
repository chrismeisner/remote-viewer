# Remote Viewer — tvOS App

A lightweight Apple TV client for [Remote Viewer](../README.md). Connects to a deployed Remote Viewer server and plays scheduled media through the native tvOS video player.

## Architecture

```
┌──────────────┐        ┌──────────────────────┐        ┌─────────┐
│  Apple TV    │──API──▶│  Remote Viewer Server │──FTP──▶│  Media  │
│  (this app)  │        │  (Next.js, deployed)  │        │  Server │
└──────────────┘        └──────────────────────┘        └─────────┘
       │                         │
       │◀── /api/now-playing ────┘
       │◀── /api/channels ───────┘
       │◀── /api/media (proxy) ──┘──▶ CDN
```

The tvOS app is a **pure client** — it talks to your already-deployed Remote Viewer server using the same APIs the web player uses. No FTP credentials ever touch the Apple TV.

## Screens

| Screen | Purpose |
|--------|---------|
| **Connect** | Enter server URL + viewer password |
| **Channel Browser** | Grid of active channels |
| **Player** | Full-screen AVPlayer with native tvOS transport controls |

## Prerequisites

- **Xcode 15+** with tvOS 17 SDK
- **[XcodeGen](https://github.com/yonaskolb/XcodeGen)** for project generation
- A deployed Remote Viewer server (Heroku, VPS, etc.) with `source=remote` configured

## Quick Start

```bash
# 1. Install XcodeGen (if you don't have it)
brew install xcodegen

# 2. Generate the Xcode project
cd apple-tv
xcodegen generate

# 3. Open in Xcode
open RemoteViewer.xcodeproj
```

Then select the **RemoteViewer** scheme, pick an Apple TV simulator, and run.

### Without XcodeGen

If you prefer not to use XcodeGen:

1. Open Xcode → File → New → Project → tvOS → App (SwiftUI)
2. Name it "RemoteViewer", set bundle ID to `com.remoteviewer.tvos`
3. Delete the generated `ContentView.swift`
4. Drag all `.swift` files from `RemoteViewer/` into the project
5. Set deployment target to tvOS 17.0
6. Copy `Info.plist` into the project settings

## How It Works

1. **Connect** — The app calls `GET /api/auth/verify` to check if a password is required, then `POST /api/auth/verify` to authenticate. The server sets an HTTP-only cookie that URLSession stores automatically.

2. **Browse Channels** — `GET /api/channels?source=remote` returns the list of active channels with their names and schedule types.

3. **Play** — `GET /api/now-playing?source=remote&channel=<id>` returns the current program with a media URL and time offset. The app creates an `AVPlayer`, seeks to the correct offset, and starts playback. When the program ends, it automatically fetches the next one.

4. **Media Delivery** — Video streams through the server's `/api/media` proxy, which forwards to the CDN with range-request support. This means the Apple TV gets full seeking and scrubbing via the Siri Remote.

## File Structure

```
apple-tv/
├── project.yml                  # XcodeGen project spec
├── README.md
└── RemoteViewer/
    ├── RemoteViewerApp.swift    # @main entry point
    ├── Models.swift             # Codable API response types
    ├── APIClient.swift          # HTTP client (URLSession)
    ├── SessionManager.swift     # Auth state + Keychain storage
    ├── ConnectView.swift        # Server URL + password form
    ├── ChannelBrowserView.swift # Channel grid with card buttons
    ├── PlayerView.swift         # AVPlayerViewController wrapper
    ├── Info.plist
    └── Assets.xcassets/
```

7 Swift files. That's it.

## Future Enhancements

- [ ] Channel cover art on browser cards
- [ ] Now-playing info overlay (title, year, progress)
- [ ] Top Shelf extension showing current programs
- [ ] Direct CDN playback (bypass server proxy)
- [ ] Multiple server profiles
- [ ] Siri "Play channel 3" shortcut
- [ ] Background audio support
