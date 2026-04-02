# SnapMark

A cross-platform desktop screenshot, annotation, and screen recording app built with Electron.

Capture any region of your screen, annotate it with shapes, arrows, text, highlights, and pixelation, record screen as video — then copy to clipboard or save. All in one fluid workflow.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Screenshot Capture
- **Region capture** — drag to select any area of your screen
- **Fullscreen capture** — capture the entire screen instantly
- **Retina/HiDPI support** — captures at native resolution on macOS
- **Global hotkeys** — trigger capture from anywhere without switching windows

### Screen Recording
- **Record region** — select an area and record it as WebM video
- **Record fullscreen** — record the entire screen
- **Floating toolbar** — draggable timer with pause/resume and stop controls
- **Region highlight** — pulsing red border shows exactly what's being recorded
- **Saved to library** — recordings appear in the gallery alongside screenshots

### Annotation Editor
All annotation happens inline on a fullscreen overlay — no separate editor window.

- **Move tool (V)** — select, drag, and reposition any annotation
- **Rectangle (R)** — draw outlined rectangles
- **Highlight (H)** — semi-transparent filled rectangles
- **Line (L)** — straight lines
- **Arrow (A)** — lines with arrowheads
- **Freehand pen (P)** — draw freely with your mouse
- **Text (T)** — click to place text, adjustable font size (12–72px), drag to move, double-click to edit
- **Pixelate/Blur (B)** — drag over sensitive information to pixelate it
- **Color picker** — 6 preset colors + full native color picker for any color
- **Stroke width** — adjustable slider (1–12px)
- **Undo** — Ctrl/Cmd+Z to undo annotations
- **Resizable selection** — drag corner/edge handles to resize after selecting
- **All annotations movable** — click and drag any shape, line, text, or highlight to reposition

### Gallery
- Thumbnails of all recent screenshots and recordings
- Video badge on recordings, with playback preview
- Click any capture to preview full-size (images) or play (videos)
- **Copy to clipboard** directly from the gallery (images)
- **Save As** to export to any location
- **Delete** individual captures
- **Clear All** in settings to free up storage

### System Tray
- App lives in the system tray when the main window is closed
- Quick access: Capture Region, Capture Fullscreen, Record Region, Record Fullscreen, Stop Recording
- Tooltip shows current hotkey bindings

### Settings
- **Customizable hotkeys** — set any key combination for capture and recording
- **Launch at startup** — on by default, starts minimized to tray
- **Auto-copy to clipboard** — toggle on/off
- **Storage management** — view folder path, file count, total size, clear all
- **About** — app info, author, links

---

## Installation

### Download

Go to the [Releases](https://github.com/hau2/SnapMark/releases) page and download the latest version:

| Platform | File | Description |
|----------|------|-------------|
| macOS (installer) | `SnapMark-x.x.x-universal.dmg` | Drag to Applications |
| macOS (portable) | `SnapMark-x.x.x-universal-mac.zip` | Extract and run, no install needed |
| Windows (installer) | `SnapMark-Setup-x.x.x.exe` | Installs with Start Menu shortcut |
| Windows (portable) | `SnapMark-Portable-x.x.x.exe` | Run directly, no install needed |

### macOS — Bypass Gatekeeper

Since the app is not signed with an Apple Developer certificate, macOS will block it on first launch. To open it:

1. **Right-click** (or Control+click) on `SnapMark.app`
2. Select **"Open"** from the context menu
3. Click **"Open"** again on the warning dialog

You only need to do this once. Alternatively:

1. Go to **System Settings > Privacy & Security**
2. Scroll down to find *"SnapMark.app was blocked"*
3. Click **"Open Anyway"**

### Windows

Run the `.exe` installer. If Windows Defender SmartScreen appears, click **"More info"** then **"Run anyway"**.

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Setup

```bash
git clone https://github.com/hau2/SnapMark.git
cd SnapMark
npm install
```

### Run

```bash
npm start
```

### Build

```bash
# macOS
npm run build:mac

# Windows
npm run build:win
```

Build output goes to the `dist/` directory.

---

## Default Hotkeys

| Action | macOS | Windows |
|--------|-------|---------|
| Capture Region | `Cmd+Shift+4` | `Alt+S` |
| Capture Fullscreen | `Cmd+Shift+3` | `Alt+Shift+S` |
| Record Region | `Cmd+G` | `Alt+G` |

These can be customized in Settings.

## Editor Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Move / select tool |
| `R` | Rectangle tool |
| `H` | Highlight tool |
| `L` | Line tool |
| `A` | Arrow tool |
| `P` | Pen tool |
| `T` | Text tool |
| `B` | Blur/Pixelate tool |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+C` | Copy to clipboard |
| `Cmd/Ctrl+S` | Save as PNG |
| `Delete` | Delete selected annotation |
| `Esc` | Cancel and close |

---

## Project Structure

```
SnapMark/
├── main.js                    # Main process: windows, IPC, tray, shortcuts, capture, recording
├── preload.js                 # Secure contextBridge IPC
├── package.json               # Electron + electron-builder config
├── src/
│   ├── index.html             # Main window: gallery + settings
│   ├── selector.html          # Fullscreen overlay: selection + annotation toolbar
│   ├── editor.js              # Annotation canvas logic (draw, move, text editing)
│   ├── settings.js            # Hotkey and settings logic
│   ├── recorder.html          # Hidden window: screen recording engine
│   ├── recorder.js            # MediaRecorder + canvas cropping logic
│   └── recording-toolbar.html # Floating toolbar: timer, pause, stop
├── assets/
│   ├── icon.png               # Application icon (1024x1024)
│   └── tray-icon.png          # System tray icon
├── SECURITY.md                # Security & safety report
└── .github/
    └── workflows/
        └── release.yml        # CI: build & publish releases on tag push
```

---

## How It Works

### Screenshots
1. **Capture** — The main window hides, waits 400ms (critical on macOS), then uses Electron's `desktopCapturer` at native resolution
2. **Select** — A fullscreen transparent overlay shows the screenshot. Drag to select a region with live dimension display
3. **Annotate** — A floating toolbar appears. Draw annotations on a separate canvas layer clipped to the selection
4. **Export** — Both canvas layers are merged and cropped to the selection. Copy to clipboard or save as PNG

### Screen Recording
1. **Select region** — Same selector overlay, but returns the region coordinates instead of entering annotation mode
2. **Record** — A hidden renderer window captures the screen via `getUserMedia` + `MediaRecorder`. For region recording, frames are cropped via canvas + `captureStream(30fps)`
3. **Highlight** — A transparent, click-through window with a pulsing red border shows the recording area
4. **Stop** — Recording saved as WebM (VP9, 2.5 Mbps). Main window opens showing the new recording

### Gallery
- All captures (screenshots + recordings) stored in the app's userData directory
- Displayed as thumbnails with video badge for recordings
- Click to preview images or play videos

---

## Creating a Release

Releases are automated via GitHub Actions. To publish a new version:

```bash
# Update version in package.json, then:
git add -A
git commit -m "release: v1.1.0"
git tag v1.1.0
git push origin master --tags
```

The workflow builds macOS (.dmg) and Windows (.exe + portable) installers, then creates a GitHub Release with the artifacts attached.

---

## Tech Stack

- **Electron 28** — cross-platform desktop framework
- **Vanilla JS + HTML Canvas** — no frameworks, no runtime dependencies
- **MediaRecorder API** — native WebM screen recording
- **electron-builder** — packaging and distribution

---

## Security

See [SECURITY.md](SECURITY.md) for the full security and safety report, including:
- Privacy and data handling (offline-only, no telemetry)
- Permissions breakdown
- Source code transparency
- Build verification steps
- IPC channel audit

---

## Author

**Le Cong Hau (Hari Le)**
- Email: leconghau095@gmail.com
- GitHub: [github.com/hau2/SnapMark](https://github.com/hau2/SnapMark)

---

## License

MIT
