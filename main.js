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
let tray = null;
let settings = null;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');

// ── Settings ────────────────────────────────────────────────────────────────

function loadSettings() {
  const defaults = {
    hotkeys: {
      captureRegion: 'CommandOrControl+Shift+4',
      captureFullscreen: 'CommandOrControl+Shift+3',
    },
    saveDirectory: path.join(app.getPath('desktop')),
    copyToClipboardAfterCapture: true,
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
}

// ── Screenshots directory ──────────────────────────────────────────────────

function ensureScreenshotsDir() {
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
}

function getRecentScreenshots() {
  ensureScreenshotsDir();
  try {
    return fs
      .readdirSync(screenshotsDir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => {
        const full = path.join(screenshotsDir, f);
        return { name: f, path: full, mtime: fs.statSync(full).mtimeMs };
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
  try {
    globalShortcut.register(settings.hotkeys.captureRegion, () => startCapture('region'));
  } catch (e) {
    console.error('Failed to register captureRegion hotkey:', e.message);
  }
  try {
    globalShortcut.register(settings.hotkeys.captureFullscreen, () => startCapture('full'));
  } catch (e) {
    console.error('Failed to register captureFullscreen hotkey:', e.message);
  }
  if (tray) {
    tray.setToolTip(
      `SnapMark\nRegion: ${settings.hotkeys.captureRegion}\nFullscreen: ${settings.hotkeys.captureFullscreen}`
    );
  }
}

// ── Capture ────────────────────────────────────────────────────────────────

async function startCapture(mode) {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  }

  // Wait for window to fully hide — critical on macOS
  await new Promise((r) => setTimeout(r, 400));

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const scaleFactor = primaryDisplay.scaleFactor || 1;

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(width * scaleFactor),
        height: Math.round(height * scaleFactor),
      },
    });
  } catch (e) {
    console.error('desktopCapturer error:', e);
    showMainWindow();
    return;
  }

  if (!sources || sources.length === 0) {
    console.error('No capture sources found');
    showMainWindow();
    return;
  }

  const source = sources[0];
  const dataURL = source.thumbnail.toDataURL();

  if (mode === 'full') {
    const buffer = source.thumbnail.toPNG();
    const filename = `screenshot-${Date.now()}.png`;
    ensureScreenshotsDir();
    const filePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(filePath, buffer);

    if (settings.copyToClipboardAfterCapture) {
      clipboard.writeImage(source.thumbnail);
    }

    showNotification('Screenshot captured', 'Fullscreen screenshot saved and copied to clipboard.');
    showMainWindow();
    if (mainWindow) mainWindow.webContents.send('screenshots-updated');
    return;
  }

  openSelector(dataURL, width, height, scaleFactor);
}

function openSelector(dataURL, screenW, screenH, scaleFactor) {
  if (selectorWindow) {
    selectorWindow.close();
    selectorWindow = null;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y } = primaryDisplay.bounds;

  selectorWindow = new BrowserWindow({
    x,
    y,
    width: screenW,
    height: screenH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreen: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  selectorWindow.loadFile(path.join(__dirname, 'src', 'selector.html'));

  selectorWindow.webContents.once('did-finish-load', () => {
    selectorWindow.webContents.send('init-selector', {
      dataURL,
      screenW,
      screenH,
      scaleFactor,
    });
  });

  selectorWindow.on('closed', () => {
    selectorWindow = null;
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function showMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function closeSelectorWindow() {
  if (selectorWindow) {
    selectorWindow.close();
    selectorWindow = null;
  }
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
    width: 900,
    height: 640,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    frame: !isMac,
    backgroundColor: '#0d0d1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── IPC Handlers ───────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('get-settings', () => settings);

  ipcMain.handle('save-settings', (_e, newSettings) => {
    saveSettings(newSettings);
    return true;
  });

  ipcMain.handle('get-screenshots', () => getRecentScreenshots());

  ipcMain.handle('get-screenshot-data', (_e, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (_) {
      return null;
    }
  });

  ipcMain.handle('capture-region', () => startCapture('region'));
  ipcMain.handle('capture-full', () => startCapture('full'));

  // Save: close selector FIRST, then show dialog from main window
  ipcMain.handle('save-image', async (_e, dataURL) => {
    const buffer = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    const filename = `screenshot-${Date.now()}.png`;

    // Always save to internal screenshots directory
    ensureScreenshotsDir();
    const internalPath = path.join(screenshotsDir, filename);
    fs.writeFileSync(internalPath, buffer);

    // Close the selector overlay FIRST so dialog is visible
    closeSelectorWindow();

    // Small delay for window to close
    await new Promise((r) => setTimeout(r, 150));

    // Show save dialog from main window context
    showMainWindow();

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(settings.saveDirectory, filename),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });

    if (filePath) {
      fs.writeFileSync(filePath, buffer);
    }

    showNotification('Screenshot saved', filePath ? `Saved to ${path.basename(filePath)}` : 'Saved to library.');
    if (mainWindow) mainWindow.webContents.send('screenshots-updated');
    return true;
  });

  // Copy: write to clipboard, close selector, show feedback via notification
  ipcMain.handle('copy-clipboard', (_e, dataURL) => {
    const buffer = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    clipboard.writeImage(img);

    // Also save to internal library
    const filename = `screenshot-${Date.now()}.png`;
    ensureScreenshotsDir();
    fs.writeFileSync(path.join(screenshotsDir, filename), buffer);

    return true;
  });

  // Copy + close selector flow (renderer calls this after copy-clipboard)
  ipcMain.handle('copy-and-close', async (_e, dataURL) => {
    const buffer = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    const img = nativeImage.createFromBuffer(buffer);
    clipboard.writeImage(img);

    // Also save to internal library
    const filename = `screenshot-${Date.now()}.png`;
    ensureScreenshotsDir();
    fs.writeFileSync(path.join(screenshotsDir, filename), buffer);

    closeSelectorWindow();
    showNotification('Copied to clipboard', 'Screenshot copied and saved to library.');
    showMainWindow();
    if (mainWindow) mainWindow.webContents.send('screenshots-updated');
    return true;
  });

  // Save without dialog (quick save to library only)
  ipcMain.handle('quick-save', async (_e, dataURL) => {
    const buffer = Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    const filename = `screenshot-${Date.now()}.png`;
    ensureScreenshotsDir();
    const internalPath = path.join(screenshotsDir, filename);
    fs.writeFileSync(internalPath, buffer);

    closeSelectorWindow();
    showNotification('Screenshot saved', 'Saved to library.');
    showMainWindow();
    if (mainWindow) mainWindow.webContents.send('screenshots-updated');
    return true;
  });

  ipcMain.handle('close-selector', () => {
    closeSelectorWindow();
    // Don't show main window on cancel/Esc — user just wants to go back to what they were doing
  });

  ipcMain.handle('open-screenshot-folder', () => {
    ensureScreenshotsDir();
    shell.openPath(screenshotsDir);
  });

  ipcMain.handle('delete-screenshot', (_e, filePath) => {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (_) {
      return false;
    }
  });

  // Copy a recent screenshot from gallery to clipboard
  ipcMain.handle('copy-screenshot-to-clipboard', (_e, filePath) => {
    try {
      const img = nativeImage.createFromPath(filePath);
      clipboard.writeImage(img);
      return true;
    } catch (_) {
      return false;
    }
  });

  // Save a recent screenshot to a user-chosen location
  ipcMain.handle('save-screenshot-as', async (_e, filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const { filePath: dest } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: path.join(settings.saveDirectory, path.basename(filePath)),
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      });
      if (dest) {
        fs.writeFileSync(dest, buffer);
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  settings = loadSettings();
  createMainWindow();
  createTray();
  registerHotkeys();
  setupIPC();

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
