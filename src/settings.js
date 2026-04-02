// Settings page logic — loaded by index.html

let listeningElement = null;

async function initSettings() {
  const settings = await window.snapmark.getSettings();

  // Populate hotkey displays
  document.getElementById('hotkey-region').textContent = formatHotkey(settings.hotkeys.captureRegion);
  document.getElementById('hotkey-fullscreen').textContent = formatHotkey(settings.hotkeys.captureFullscreen);
  document.getElementById('hotkey-record').textContent = formatHotkey(settings.hotkeys.recordRegion);

  // Auto-copy toggle
  const autoCopy = document.getElementById('auto-copy');
  autoCopy.checked = settings.copyToClipboardAfterCapture;
  autoCopy.onchange = async () => {
    settings.copyToClipboardAfterCapture = autoCopy.checked;
    await window.snapmark.saveSettings(settings);
  };

  // Launch at startup toggle
  const openAtLogin = document.getElementById('open-at-login');
  openAtLogin.checked = settings.openAtLogin !== false;
  openAtLogin.onchange = async () => {
    settings.openAtLogin = openAtLogin.checked;
    await window.snapmark.saveSettings(settings);
  };

  // Hotkey listeners
  document.querySelectorAll('.hotkey-input').forEach((el) => {
    el.addEventListener('click', () => startListening(el, settings));
  });

  // Storage path
  const dir = await window.snapmark.getScreenshotsDir();
  document.getElementById('storage-path').textContent = dir;
  document.getElementById('open-storage-btn').addEventListener('click', () => {
    window.snapmark.openScreenshotFolder();
  });
}

function startListening(el, settings) {
  if (listeningElement) {
    listeningElement.classList.remove('listening');
    listeningElement.textContent = formatHotkey(settings.hotkeys[listeningElement.dataset.key]);
  }

  listeningElement = el;
  el.classList.add('listening');
  el.textContent = 'Press keys...';

  const handler = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignore lone modifier keys
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    const parts = [];
    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    // Normalize key name
    let key = e.key;
    if (key.length === 1) key = key.toUpperCase();
    if (key === ' ') key = 'Space';
    parts.push(key);

    const combo = parts.join('+');

    settings.hotkeys[el.dataset.key] = combo;
    el.textContent = formatHotkey(combo);
    el.classList.remove('listening');
    listeningElement = null;

    document.removeEventListener('keydown', handler, true);

    await window.snapmark.saveSettings(settings);
  };

  document.addEventListener('keydown', handler, true);
}

function formatHotkey(combo) {
  if (!combo) return '';
  return combo
    .replace('CommandOrControl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')
    .replace('Shift', navigator.platform.includes('Mac') ? '⇧' : 'Shift')
    .replace('Alt', navigator.platform.includes('Mac') ? '⌥' : 'Alt')
    .replace(/\+/g, ' + ');
}
