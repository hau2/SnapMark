const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  screen,
  Tray,
  Menu,
  nativeImage,
  clipboard,
  dialog,
  shell,
  Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let selectorWindow = null;
let recorderWindow = null;
let recordingToolbarWindow = null;
let recordingHighlightWindow = null;
let tray = null;
let settings = null;
let isCapturing = false;
let isRecording = false;
let pendingRecordRegion = null; // resolve function for region-selected

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');

// ── Settings ────────────────────────────────────────────────────────────────

function loadSettings() {
  const isMac = process.platform === 'darwin';
  const defaults = {
    hotkeys: {
      captureRegion: isMac ? 'Command+Shift+4' : 'Alt+S',
      captureFullscreen: isMac ? 'Command+Shift+3' : 'Alt+Shift+S',
      recordRegion: isMac ? 'Command+G' : 'Alt+G',
    },
    saveDirectory: path.join(app.getPath('desktop')),
    copyToClipboardAfterCapture: true,
    openAtLogin: true,
  };
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return { ...defaults, ...data, hotkeys: { ...defaults.hotkeys, ...data.hotkeys } };
    }
  } catch (_) { /* use defaults */ }
  return defaults;
}

function saveSettings(newSettings) {
  settings = newSettings;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  registerHotkeys();
  applyOpenAtLogin();
}

function applyOpenAtLogin() {
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.openAtLogin !== false,
      openAsHidden: true,
    });
  } catch (e) {
    console.error('Failed to set login item:', e.message);
  }
}

// ── Media directory ────────────────────────────────────────────────────────

function ensureScreenshotsDir() {
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
}

function getRecentMedia() {
  ensureScreenshotsDir();
  try {
    return fs
      .readdirSync(screenshotsDir)
      .filter((f) => f.endsWith('.png') || f.endsWith('.webm'))
      .map((f) => {
        const full = path.join(screenshotsDir, f);
        return {
          name: f,
          path: full,
          mtime: fs.statSync(full).mtimeMs,
          type: f.endsWith('.webm') ? 'video' : 'image',
        };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 50);
  } catch (_) {
    return [];
  }
}

// ── Hotkeys ────────────────────────────────────────────────────────────────

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const reg = (key, fn) => {
    try { globalShortcut.register(key, fn); }
    catch (e) { console.error(`Failed to register ${key}:`, e.message); }
  };
  reg(settings.hotkeys.captureRegion, () => startCapture('region'));
  reg(settings.hotkeys.captureFullscreen, () => startCapture('full'));
  if (settings.hotkeys.recordRegion) {
    reg(settings.hotkeys.recordRegion, () => startRecording('region'));
  }
  if (tray) {
    tray.setToolTip(
      `SnapMark\nCapture: ${settings.hotkeys.captureRegion}\nRecord: ${settings.hotkeys.recordRegion || 'N/A'}`
    );
  }
}

// ── Display helpers ───────────────────────────────────────────────────────

function getActiveDisplay() {
  const cursor = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(cursor);
}

function findSourceForDisplay(sources, display) {
  const displayId = String(display.id);
  const match = sources.find((s) => String(s.display_id) === displayId);
  return match || sources[0];
}

function getVirtualBounds() {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ── Capture (screenshot) ──────────────────────────────────────────────────

async function startCapture(mode) {
  if (isCapturing || selectorWindow || isRecording) return;
  isCapturing = true;

  try {
    if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
    await new Promise((r) => setTimeout(r, 400));

    const displays = screen.getAllDisplays();
    const maxScale = Math.max(...displays.map((d) => d.scaleFactor || 1));

    // Capture all screens at their native resolution
    let sources;
    try {
      // Use a large thumbnail to get all screens at good resolution
      const largest = displays.reduce((a, b) =>
        (a.size.width * a.scaleFactor) > (b.size.width * b.scaleFactor) ? a : b
      );
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(largest.size.width * (largest.scaleFactor || 1)),
          height: Math.round(largest.size.height * (largest.scaleFactor || 1)),
        },
      });
    } catch (e) {
      console.error('desktopCapturer error:', e);
      return;
    }

    if (!sources || sources.length === 0) return;

    if (mode === 'full') {
      // Full capture of the active display only
      const activeDisplay = getActiveDisplay();
      const source = findSourceForDisplay(sources, activeDisplay);
      const buffer = source.thumbnail.toPNG();
      const filename = `screenshot-${Date.now()}.png`;
      ensureScreenshotsDir();
      fs.writeFileSync(path.join(screenshotsDir, filename), buffer);
      if (settings.copyToClipboardAfterCapture) clipboard.writeImage(source.thumbnail);
      showNotification('Screenshot captured', 'Fullscreen screenshot saved.');
      if (mainWindow) mainWindow.webContents.send('screenshots-updated');
      return;
    }

    // Region mode: build per-display data for stitching in the renderer
    const virtualBounds = getVirtualBounds();
    const displayData = displays.map((d) => {
      const source = findSourceForDisplay(sources, d);
      return {
        dataURL: source ? source.thumbnail.toDataURL() : null,
        x: d.bounds.x - virtualBounds.x,
        y: d.bounds.y - virtualBounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        scaleFactor: d.scaleFactor || 1,
      };
    });

    openSelector(virtualBounds, maxScale, displayData, 'capture');
  } finally {
    if (mode === 'full') isCapturing = false;
  }
}

function openSelector(virtualBounds, scaleFactor, displayData, selectorMode) {
  if (selectorWindow) { selectorWindow.close(); selectorWindow = null; }

  const isMac = process.platform === 'darwin';

  selectorWindow = new BrowserWindow({
    x: virtualBounds.x,
    y: virtualBounds.y,
    width: virtualBounds.width,
    height: virtualBounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: isMac, // macOS needs fullscreen; Windows uses positioned window
    fullscreenable: isMac,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  if (!isMac) {
    // On Windows, maximize across all screens
    selectorWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  selectorWindow.loadFile(path.join(__dirname, 'src', 'selector.html'));

  selectorWindow.webContents.once('did-finish-load', () => {
    selectorWindow.webContents.send('init-selector', {
      displayData,
      screenW: virtualBounds.width,
      screenH: virtualBounds.height,
      scaleFactor,
      mode: selectorMode || 'capture',
    });
  });

  selectorWindow.on('closed', () => {
    selectorWindow = null;
    isCapturing = false;
    if (pendingRecordRegion) {
      pendingRecordRegion(null);
      pendingRecordRegion = null;
    }
  });
}

// ── Recording ─────────────────────────────────────────────────────────────

async function startRecording(mode) {
  if (isCapturing || isRecording || selectorWindow) return;
  isRecording = true;

  if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
  await new Promise((r) => setTimeout(r, 400));

  const activeDisplay = getActiveDisplay();
  const { width, height } = activeDisplay.size;
  const scaleFactor = activeDisplay.scaleFactor || 1;

  // Get source ID for the active screen
  let sources;
  try {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch (e) {
    console.error('desktopCapturer error:', e);
    isRecording = false;
    return;
  }
  if (!sources || sources.length === 0) { isRecording = false; return; }
  const source = findSourceForDisplay(sources, activeDisplay);
  const sourceId = source.id;

  let region = null;
  let isFullscreen = true;

  if (mode === 'region') {
    // Reuse the multi-monitor selector for region selection
    const displays = screen.getAllDisplays();
    const maxScale = Math.max(...displays.map((d) => d.scaleFactor || 1));
    let bgSources;
    try {
      const largest = displays.reduce((a, b) =>
        (a.size.width * a.scaleFactor) > (b.size.width * b.scaleFactor) ? a : b
      );
      bgSources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(largest.size.width * (largest.scaleFactor || 1)),
          height: Math.round(largest.size.height * (largest.scaleFactor || 1)),
        },
      });
    } catch (_) { isRecording = false; return; }

    const virtualBounds = getVirtualBounds();
    const displayData = displays.map((d) => {
      const src = findSourceForDisplay(bgSources, d);
      return {
        dataURL: src ? src.thumbnail.toDataURL() : null,
        x: d.bounds.x - virtualBounds.x,
        y: d.bounds.y - virtualBounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        scaleFactor: d.scaleFactor || 1,
      };
    });

    openSelector(virtualBounds, maxScale, displayData, 'record-select');

    region = await new Promise((resolve) => { pendingRecordRegion = resolve; });
    if (!region) { isRecording = false; return; }

    closeSelectorWindow();
    await new Promise((r) => setTimeout(r, 200));

    isFullscreen = false;
  }

  if (!isFullscreen && region) {
    openRecordingHighlight(region, activeDisplay.bounds);
  }

  openRecorderWindow({ sourceId, region, scaleFactor, screenW: width, screenH: height, isFullscreen });
  openRecordingToolbar(activeDisplay);
}

function openRecorderWindow(config) {
  recorderWindow = new BrowserWindow({
    show: false, width: 1, height: 1,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  recorderWindow.loadFile(path.join(__dirname, 'src', 'recorder.html'));

  recorderWindow.webContents.once('did-finish-load', () => {
    recorderWindow.webContents.send('init-recorder', config);
  });

  recorderWindow.on('closed', () => { recorderWindow = null; });
}

function openRecordingToolbar(targetDisplay) {
  const display = targetDisplay || getActiveDisplay();
  const { x: dx, y: dy } = display.bounds;
  const { width } = display.size;

  recordingToolbarWindow = new BrowserWindow({
    width: 280, height: 56,
    x: Math.round(dx + (width - 280) / 2), y: dy + 16,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: true,
    // focusable: true on Windows so toolbar is visible and clickable
    focusable: process.platform === 'win32',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  // Keep it always on top at the highest level
  recordingToolbarWindow.setAlwaysOnTop(true, 'screen-saver');

  recordingToolbarWindow.loadFile(path.join(__dirname, 'src', 'recording-toolbar.html'));
  recordingToolbarWindow.on('closed', () => { recordingToolbarWindow = null; });
}

function stopRecording() {
  if (recorderWindow) {
    recorderWindow.webContents.send('recording-command', 'stop');
  }
}

function openRecordingHighlight(region, displayBounds) {
  const pad = 3; // border thickness
  const x = displayBounds.x + region.x - pad;
  const y = displayBounds.y + region.y - pad;
  const w = region.w + pad * 2;
  const h = region.h + pad * 2;

  recordingHighlightWindow = new BrowserWindow({
    x: Math.round(x), y: Math.round(y),
    width: Math.round(w), height: Math.round(h),
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, movable: false,
    focusable: false, hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Ignore mouse events so user can interact with apps underneath
  recordingHighlightWindow.setIgnoreMouseEvents(true);

  recordingHighlightWindow.loadURL(`data:text/html,
    <html><body style="margin:0;background:transparent;overflow:hidden;">
      <div style="
        width:${Math.round(w)}px;height:${Math.round(h)}px;
        border:${pad}px solid rgba(230,57,70,0.8);
        border-radius:4px;
        box-sizing:border-box;
        animation:pulse 2s infinite;
      "></div>
      <style>
        @keyframes pulse {
          0%,100%{border-color:rgba(230,57,70,0.8)}
          50%{border-color:rgba(230,57,70,0.3)}
        }
      </style>
    </body></html>
  `);

  recordingHighlightWindow.on('closed', () => { recordingHighlightWindow = null; });
}

function closeRecordingWindows() {
  if (recorderWindow) { recorderWindow.close(); recorderWindow = null; }
  if (recordingToolbarWindow) { recordingToolbarWindow.close(); recordingToolbarWindow = null; }
  if (recordingHighlightWindow) { recordingHighlightWindow.close(); recordingHighlightWindow = null; }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function showMainWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
}

function closeSelectorWindow() {
  if (selectorWindow) { selectorWindow.close(); selectorWindow = null; }
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

// ── Tray ───────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Capture Region', click: () => startCapture('region') },
    { label: 'Capture Fullscreen', click: () => startCapture('full') },
    { type: 'separator' },
    { label: 'Record Region', click: () => startRecording('region') },
    { label: 'Record Fullscreen', click: () => startRecording('full') },
    { type: 'separator' },
    { label: 'Stop Recording', click: () => stopRecording(), enabled: false, id: 'stop-rec' },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        showMainWindow();
        if (mainWindow) mainWindow.webContents.send('open-settings');
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('SnapMark');

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

// ── Main Window ────────────────────────────────────────────────────────────

function createMainWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 900, height: 640, minWidth: 600, minHeight: 400,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    frame: !isMac, backgroundColor: '#0d0d1a', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

// ── IPC Handlers ───────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('get-settings', () => settings);
  ipcMain.handle('save-settings', (_e, newSettings) => { saveSettings(newSettings); return true; });
  ipcMain.handle('get-screenshots', () => getRecentMedia());

  ipcMain.handle('get-screenshot-data', (_e, filePath) => {
    try {
      if (filePath.endsWith('.webm')) {
        // Return file:// URL for video
        return `file://${filePath}`;
      }
      const buffer = fs.readFileSync(filePath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (_) { return null; }
  });

  ipcMain.handle('capture-region', () => startCapture('region'));
  ipcMain.handle('capture-full', () => startCapture('full'));

  // Save image
  ipcMain.handle('save-image', async (_e, dataURL) => {
    const buffer = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    const filename = `screenshot-${Date.now()}.png`;
    ensureScreenshotsDir();
    fs.writeFileSync(path.join(screenshotsDir, filename), buffer);
    closeSelectorWindow();
    await new Promise((r) => setTimeout(r, 150));
    const dialogParent = mainWindow && mainWindow.isVisible() ? mainWindow : undefined;
    const { filePath } = await dialog.showSaveDialog(dialogParent, {
      defaultPath: path.join(settings.saveDirectory, filename),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (filePath) fs.writeFileSync(filePath, buffer);
    showNotification('Screenshot saved', filePath ? `Saved to ${path.basename(filePath)}` : 'Saved to library.');
    if (mainWindow) mainWindow.webContents.send('screenshots-updated');
    return true;
  });

  ipcMain.handle('copy-clipboard', (_e, dataURL) => {
    const buffer = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    clipboard.writeImage(nativeImage.createFromBuffer(buffer));
    const filename = `screenshot-${Date.now()}.png`;
    ensureScreenshotsDir();
    fs.writeFileSync(path.join(screenshotsDir, filename), buffer);
    return true;
  });

  ipcMain.handle('copy-and-close', async (_e, dataURL) => {
    const buffer = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    clipboard.writeImage(nativeImage.createFromBuffer(buffer));
    const filename = `screenshot-${Date.now()}.png`;
    ensureScreenshotsDir();
    fs.writeFileSync(path.join(screenshotsDir, filename), buffer);
    closeSelectorWindow();
    showNotification('Copied to clipboard', 'Screenshot copied and saved to library.');
    if (mainWindow) mainWindow.webContents.send('screenshots-updated');
    return true;
  });

  ipcMain.handle('quick-save', async (_e, dataURL) => {
    const buffer = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    const filename = `screenshot-${Date.now()}.png`;
    ensureScreenshotsDir();
    fs.writeFileSync(path.join(screenshotsDir, filename), buffer);
    closeSelectorWindow();
    showNotification('Screenshot saved', 'Saved to library.');
    if (mainWindow) mainWindow.webContents.send('screenshots-updated');
    return true;
  });

  ipcMain.handle('close-selector', () => { closeSelectorWindow(); });

  ipcMain.handle('open-screenshot-folder', () => { ensureScreenshotsDir(); shell.openPath(screenshotsDir); });
  ipcMain.handle('delete-screenshot', (_e, fp) => { try { fs.unlinkSync(fp); return true; } catch (_) { return false; } });

  ipcMain.handle('copy-screenshot-to-clipboard', (_e, fp) => {
    try { clipboard.writeImage(nativeImage.createFromPath(fp)); return true; } catch (_) { return false; }
  });

  ipcMain.handle('save-screenshot-as', async (_e, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      const isVideo = filePath.endsWith('.webm');
      const { filePath: dest } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: path.join(settings.saveDirectory, path.basename(filePath)),
        filters: isVideo
          ? [{ name: 'WebM Video', extensions: ['webm'] }]
          : [{ name: 'PNG Image', extensions: ['png'] }],
      });
      if (dest) { fs.writeFileSync(dest, buffer); return true; }
      return false;
    } catch (_) { return false; }
  });

  ipcMain.handle('get-screenshots-dir', () => screenshotsDir);

  ipcMain.handle('get-storage-size', () => {
    ensureScreenshotsDir();
    try {
      const files = fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png') || f.endsWith('.webm'));
      let total = 0;
      for (const f of files) total += fs.statSync(path.join(screenshotsDir, f)).size;
      return { count: files.length, bytes: total };
    } catch (_) { return { count: 0, bytes: 0 }; }
  });

  ipcMain.handle('clear-all-captures', () => {
    ensureScreenshotsDir();
    try {
      const files = fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png') || f.endsWith('.webm'));
      for (const f of files) fs.unlinkSync(path.join(screenshotsDir, f));
      if (mainWindow) mainWindow.webContents.send('screenshots-updated');
      return files.length;
    } catch (_) { return 0; }
  });
  ipcMain.handle('open-external', (_e, url) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) shell.openExternal(url);
  });

  // ── Recording IPC ──────────────────────────────────────────────────────

  ipcMain.handle('start-recording', (_e, mode) => startRecording(mode));
  ipcMain.handle('stop-recording', () => stopRecording());

  ipcMain.handle('region-selected', (_e, region) => {
    if (pendingRecordRegion) {
      pendingRecordRegion(region);
      pendingRecordRegion = null;
    }
  });

  ipcMain.handle('send-recording-command', (_e, cmd) => {
    if (recorderWindow) {
      recorderWindow.webContents.send('recording-command', cmd);
    }
    if (cmd === 'stop') {
      // Will be cleaned up when recording-complete fires
    }
  });

  ipcMain.handle('recording-time-update', (_e, ms) => {
    if (recordingToolbarWindow) {
      recordingToolbarWindow.webContents.send('recording-time-update', ms);
    }
  });

  ipcMain.handle('recording-complete', (_e, data) => {
    closeRecordingWindows();
    isRecording = false;

    if (!data) {
      showNotification('Recording failed', 'Could not save recording.');
      return;
    }

    const buffer = Buffer.from(data);
    const filename = `recording-${Date.now()}.webm`;
    ensureScreenshotsDir();
    fs.writeFileSync(path.join(screenshotsDir, filename), buffer);

    showNotification('Recording saved', `${filename} saved to library.`);
    showMainWindow();
    if (mainWindow) mainWindow.webContents.send('screenshots-updated');
  });
}

// ── Single instance lock ───────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    settings = loadSettings();
    createMainWindow();
    createTray();
    registerHotkeys();
    applyOpenAtLogin();
    setupIPC();

    app.on('activate', () => { if (mainWindow) mainWindow.show(); });
  });

  app.on('window-all-closed', () => { /* keep running in tray */ });
  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); });
}
