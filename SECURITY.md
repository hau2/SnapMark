# SnapMark — Security & Safety Report

**Document Version:** 1.0
**Date:** April 2, 2026
**Author:** Le Cong Hau (Hari Le)
**Contact:** leconghau095@gmail.com
**Repository:** https://github.com/hau2/SnapMark

---

## 1. Executive Summary

SnapMark is an open-source, offline-only desktop screenshot and annotation tool built with Electron. It operates entirely on the local machine, makes **zero network connections**, collects **no user data**, and stores all screenshots locally. The full source code is publicly auditable on GitHub, and all release binaries are built transparently via GitHub Actions CI/CD.

---

## 2. Application Overview

| Property | Detail |
|----------|--------|
| **Name** | SnapMark |
| **Type** | Desktop application (Windows & macOS) |
| **Framework** | Electron 28 |
| **Language** | Vanilla JavaScript, HTML, CSS |
| **Runtime dependencies** | None (zero third-party libraries at runtime) |
| **Build dependencies** | `electron` (framework), `electron-builder` (packaging) |
| **Total source code** | ~600 lines across 6 files |
| **License** | MIT |

---

## 3. Privacy & Data Handling

### 3.1 No Network Communication

SnapMark makes **no outbound network requests** of any kind. The application:

- Does NOT connect to any server or API
- Does NOT send analytics or telemetry
- Does NOT check for updates over the network
- Does NOT upload screenshots or any user data
- Does NOT contain any tracking pixels, SDKs, or third-party services

This can be independently verified by:
1. Reading the source code — no `fetch()`, `XMLHttpRequest`, `net`, or `http` calls exist
2. Monitoring network traffic while the app is running (e.g., using Wireshark or Little Snitch)

### 3.2 Local-Only Data Storage

All data remains on the user's local machine:

| Data | Location |
|------|----------|
| Screenshots | `{userData}/screenshots/` directory |
| Settings (hotkeys, preferences) | `{userData}/settings.json` |
| No cloud sync | Data is never uploaded or synced |

**userData paths:**
- macOS: `~/Library/Application Support/snapmark/`
- Windows: `C:\Users\<username>\AppData\Roaming\snapmark\`

### 3.3 No Personal Data Collection

SnapMark does NOT collect, process, or store:
- User names or identifiers
- IP addresses
- Usage statistics or behavior data
- Crash reports
- Any personally identifiable information (PII)

---

## 4. Permissions Required

| Permission | Platform | Purpose | Justification |
|------------|----------|---------|---------------|
| Screen Recording | macOS | Capture screen content via `desktopCapturer` API | Core functionality — cannot capture screenshots without this |
| File System (app data) | Both | Read/write screenshots and settings | Store captured screenshots locally |
| Clipboard | Both | Copy screenshots to clipboard | User-initiated action only |
| Global Shortcuts | Both | Register hotkeys for capture | User-configurable keyboard shortcuts |

**No other permissions are requested or required.**

---

## 5. Source Code Transparency

### 5.1 Open Source

The complete source code is available at:
**https://github.com/hau2/SnapMark**

Anyone can:
- Read every line of code
- Fork and modify the application
- Build from source independently

### 5.2 File Structure

```
SnapMark/
├── main.js           — Main process (window management, IPC, capture logic)
├── preload.js        — Secure IPC bridge (contextBridge)
├── src/
│   ├── index.html    — Main window UI (gallery, settings)
│   ├── selector.html — Screenshot overlay UI (selection, annotation toolbar)
│   ├── editor.js     — Annotation canvas logic
│   └── settings.js   — Hotkey configuration
├── assets/
│   ├── icon.png      — Application icon
│   └── tray-icon.png — System tray icon
└── package.json      — Dependencies and build config
```

### 5.3 No Obfuscation

- Source code is not minified or obfuscated
- No binary blobs or compiled modules
- All logic is in plain readable JavaScript

---

## 6. Build & Distribution Security

### 6.1 Automated Builds

All release binaries are built automatically by **GitHub Actions** — not on any personal machine.

- **Workflow file:** `.github/workflows/release.yml` (publicly visible)
- **Build logs:** https://github.com/hau2/SnapMark/actions (publicly visible)
- **Build environments:**
  - macOS: `macos-latest` (GitHub-hosted runner)
  - Windows: `windows-latest` (GitHub-hosted runner)

### 6.2 Reproducible Builds

Anyone can reproduce the exact same build by:

```bash
git clone https://github.com/hau2/SnapMark.git
cd SnapMark
npm install
npm run build:mac   # or build:win
```

### 6.3 Code Signing Status

| Platform | Signed | Reason |
|----------|--------|--------|
| macOS | No | Requires Apple Developer certificate ($99/year) |
| Windows | No | Requires code signing certificate ($200-400/year) |

**Impact:** Users will see a Gatekeeper warning (macOS) or SmartScreen warning (Windows) on first launch. These warnings indicate the app is **unsigned**, NOT that it is malicious.

### 6.4 Antivirus Verification

The release binaries can be scanned at:
- **VirusTotal:** https://www.virustotal.com (scans with 70+ antivirus engines)
- **Any local antivirus software**

---

## 7. Security Architecture

### 7.1 Electron Security Best Practices

SnapMark follows Electron security guidelines:

| Practice | Implementation |
|----------|---------------|
| Context Isolation | `contextIsolation: true` — renderer cannot access Node.js |
| Node Integration Disabled | `nodeIntegration: false` — renderer has no direct system access |
| Secure IPC | All communication uses `contextBridge` + `ipcRenderer.invoke()` |
| Content Security Policy | CSP headers set in HTML — blocks inline scripts from external sources |
| No Remote Content | App loads only local files — no remote URLs |

### 7.2 IPC Channel Audit

All IPC channels and their purpose:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `get-settings` / `save-settings` | Renderer → Main | Read/write user preferences |
| `capture-region` / `capture-full` | Renderer → Main | Trigger screenshot capture |
| `copy-and-close` | Renderer → Main | Copy image to clipboard |
| `save-image` | Renderer → Main | Save image to disk (with dialog) |
| `get-screenshots` | Renderer → Main | List saved screenshots |
| `delete-screenshot` | Renderer → Main | Delete a screenshot file |
| `close-selector` | Renderer → Main | Close the capture overlay |
| `open-external` | Renderer → Main | Open URL in browser (validated: only `https://` and `mailto:`) |

**No IPC channel transmits data outside the local machine.**

---

## 8. Threat Assessment

| Threat | Risk Level | Mitigation |
|--------|-----------|------------|
| Data exfiltration | **None** | No network communication exists |
| Malware/backdoor | **None** | Source is open, auditable, and builds are automated |
| Unauthorized screen capture | **Low** | Capture only occurs on explicit user action (hotkey/button press) |
| Local file access | **Low** | App only reads/writes its own data directory and user-chosen save paths |
| Dependency supply chain | **Low** | Zero runtime dependencies; only Electron framework at build time |

---

## 9. How to Independently Verify

### Quick Verification (5 minutes)
1. Visit https://github.com/hau2/SnapMark
2. Read `main.js` — confirm no network calls
3. Read `preload.js` — confirm limited IPC surface
4. Check build logs at https://github.com/hau2/SnapMark/actions

### Full Verification (15 minutes)
1. Clone the repository: `git clone https://github.com/hau2/SnapMark.git`
2. Read all source files (~600 lines total)
3. Confirm no network-related code: search for `fetch`, `http`, `net`, `request`, `axios`, `socket`
4. Build from source: `npm install && npm run build:mac`
5. Compare your build with the release binary

### Network Monitoring
1. Install a network monitor (e.g., Little Snitch on macOS, Wireshark on Windows)
2. Launch SnapMark
3. Confirm zero outbound connections

---

## 10. Conclusion

SnapMark is a safe, transparent, offline-only application that:

- Contains no malware, spyware, or tracking of any kind
- Makes zero network connections
- Stores all data locally on the user's machine
- Has fully open and auditable source code
- Is built transparently via GitHub Actions

The macOS Gatekeeper and Windows SmartScreen warnings are solely due to the absence of paid code signing certificates, not due to any security concern with the application itself.

---

*This document can be verified against the source code at https://github.com/hau2/SnapMark at any time.*
