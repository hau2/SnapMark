# SnapMark

A cross-platform desktop screenshot and annotation app built with Electron.

Capture any region of your screen, annotate it with shapes, arrows, text, highlights, and pixelation, then copy to clipboard or save as PNG — all in one fluid workflow.

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

### Annotation Editor
All annotation happens inline on a fullscreen overlay — no separate editor window.

- **Rectangle** — draw outlined rectangles
- **Highlight** — semi-transparent filled rectangles
- **Arrow** — draw arrows with arrowheads
- **Freehand pen** — draw freely with your mouse
- **Text** — click to place text with adjustable font size (12–72px)
- **Pixelate/Blur** — drag over sensitive information to pixelate it
- **Color picker** — 6 preset colors + full native color picker for any color
- **Stroke width** — adjustable slider (1–12px)
- **Undo** — Ctrl/Cmd+Z to undo annotations
- **Resizable selection** — drag corner/edge handles to resize after selecting

### Gallery
- Thumbnails of all recent screenshots
- Click any screenshot to preview full-size
- **Copy to clipboard** directly from the gallery
- **Save As** to export to any location
- **Delete** screenshots you no longer need

### System Tray
- App lives in the system tray when the main window is closed
- Quick access to capture, settings, and quit
- Tooltip shows current hotkey bindings

### Customizable Hotkeys
- Set any key combination for region and fullscreen capture
- Click the hotkey field and press your desired keys
- Settings persisted across sessions

---

## Installation

### Download

Go to the [Releases](https://github.com/hau2/SnapMark/releases) page and download the latest version:

| Platform | File | Description |
|----------|------|-------------|
| macOS | `SnapMark-x.x.x-universal.dmg` | Drag to Applications |
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

These can be customized in Settings.

## Editor Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Rectangle tool |
| `H` | Highlight tool |
| `A` | Arrow tool |
| `P` | Pen tool |
| `T` | Text tool |
| `B` | Blur/Pixelate tool |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+C` | Copy to clipboard |
| `Cmd/Ctrl+S` | Save as PNG |
| `Esc` | Cancel and close |

---

## Project Structure

```
SnapMark/
├── main.js              # Main process: windows, IPC, tray, shortcuts, capture
├── preload.js           # Secure contextBridge IPC
├── package.json         # Electron + electron-builder config
├── src/
│   ├── index.html       # Main window: gallery + settings
│   ├── selector.html    # Fullscreen overlay: selection + annotation toolbar
│   ├── editor.js        # Annotation canvas logic
│   └── settings.js      # Hotkey configuration logic
├── assets/
│   └── tray-icon.png    # System tray icon
└── .github/
    └── workflows/
        └── release.yml  # CI: build & publish releases on tag push
```

---

## How It Works

1. **Capture** — The main window hides, waits 400ms (critical on macOS), then uses Electron's `desktopCapturer` at native resolution
2. **Select** — A fullscreen transparent overlay shows the screenshot. Drag to select a region with live dimension display
3. **Annotate** — A floating toolbar appears. Draw annotations on a separate canvas layer clipped to the selection
4. **Export** — Both canvas layers are merged and cropped to the selection. Copy to clipboard or save as PNG
5. **Gallery** — Screenshots are stored in the app's userData directory and displayed as thumbnails

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

The workflow builds macOS (.dmg) and Windows (.exe) installers, then creates a GitHub Release with the artifacts attached.

---

## Tech Stack

- **Electron 28** — cross-platform desktop framework
- **Vanilla JS + HTML Canvas** — no frameworks, no dependencies
- **electron-builder** — packaging and distribution

---

## License

MIT
