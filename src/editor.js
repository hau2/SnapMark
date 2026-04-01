// ── State ────────────────────────────────────────────────────────────────────
let screenshotImg = null;
let scaleFactor = 1;
let screenW = 0;
let screenH = 0;

// Selection
let selecting = false;
let selStart = { x: 0, y: 0 };
let selRect = null; // { x, y, w, h } in CSS pixels

// Resize
let resizing = false;
let resizeHandle = null; // 'tl','t','tr','r','br','b','bl','l'
let resizeOrigin = null; // fixed corner during resize

// Drawing
let mode = 'select'; // 'select' | 'annotate'
let tool = 'rect';
let color = '#e63946';
let strokeWidth = 3;
let annotations = [];
let currentAnnotation = null;
let isDrawing = false;

// Text
let textActive = false;

// Canvases
const bgCanvas = document.getElementById('bg-canvas');
const bgCtx = bgCanvas.getContext('2d');
const overlay = document.getElementById('overlay');
const ovCtx = overlay.getContext('2d');
const drawCanvas = document.getElementById('draw-canvas');
const drawCtx = drawCanvas.getContext('2d');
const dimLabel = document.getElementById('dim-label');
const toolbar = document.getElementById('toolbar');
const textInput = document.getElementById('text-input');
const hint = document.getElementById('hint');

const HANDLE_SIZE = 8; // CSS pixels — hit target for resize handles

// ── Toast helper ────────────────────────────────────────────────────────────

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast-icon').textContent = '';
  toast.querySelector('.toast-text').textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

// ── Init from main process ──────────────────────────────────────────────────

window.snapmark.onInitSelector((data) => {
  screenW = data.screenW;
  screenH = data.screenH;
  scaleFactor = data.scaleFactor;

  [bgCanvas, overlay, drawCanvas].forEach((c) => {
    c.width = screenW * scaleFactor;
    c.height = screenH * scaleFactor;
    c.style.width = screenW + 'px';
    c.style.height = screenH + 'px';
  });

  screenshotImg = new Image();
  screenshotImg.onload = () => {
    bgCtx.drawImage(screenshotImg, 0, 0, bgCanvas.width, bgCanvas.height);
    drawOverlay();
  };
  screenshotImg.src = data.dataURL;
});

// ── Dark overlay with cutout ────────────────────────────────────────────────

function drawOverlay() {
  const s = scaleFactor;
  ovCtx.clearRect(0, 0, overlay.width, overlay.height);
  ovCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ovCtx.fillRect(0, 0, overlay.width, overlay.height);

  if (!selRect) return;

  const rx = selRect.x * s;
  const ry = selRect.y * s;
  const rw = selRect.w * s;
  const rh = selRect.h * s;

  // Cutout
  ovCtx.clearRect(rx, ry, rw, rh);

  // Border
  ovCtx.strokeStyle = '#e63946';
  ovCtx.lineWidth = 2 * s;
  ovCtx.setLineDash([]);
  ovCtx.strokeRect(rx, ry, rw, rh);

  // Corner + edge handles
  const hs = 6 * s;
  ovCtx.fillStyle = '#fff';
  const handles = getHandlePositions();
  for (const key in handles) {
    const h = handles[key];
    ovCtx.fillRect(h.x * s - hs / 2, h.y * s - hs / 2, hs, hs);
  }
}

// ── Resize handle positions (CSS pixels) ────────────────────────────────────

function getHandlePositions() {
  if (!selRect) return {};
  const { x, y, w, h } = selRect;
  return {
    tl: { x, y },
    t:  { x: x + w / 2, y },
    tr: { x: x + w, y },
    r:  { x: x + w, y: y + h / 2 },
    br: { x: x + w, y: y + h },
    b:  { x: x + w / 2, y: y + h },
    bl: { x, y: y + h },
    l:  { x, y: y + h / 2 },
  };
}

function hitTestHandle(mx, my) {
  const handles = getHandlePositions();
  for (const key in handles) {
    const h = handles[key];
    if (Math.abs(mx - h.x) <= HANDLE_SIZE && Math.abs(my - h.y) <= HANDLE_SIZE) {
      return key;
    }
  }
  return null;
}

function handleCursor(handle) {
  const map = {
    tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize',
    t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize',
  };
  return map[handle] || 'crosshair';
}

// When resizing, we need a fixed anchor point (the opposite corner/edge)
function getResizeAnchor(handle) {
  const { x, y, w, h } = selRect;
  const map = {
    tl: { x: x + w, y: y + h },
    t:  { x: x,     y: y + h },
    tr: { x,        y: y + h },
    r:  { x,        y },
    br: { x,        y },
    b:  { x,        y },
    bl: { x: x + w, y },
    l:  { x: x + w, y },
  };
  return map[handle];
}

function computeResizedRect(handle, anchor, mx, my) {
  let x1, y1, x2, y2;

  if (handle === 't' || handle === 'b') {
    // Vertical only
    x1 = selRect.x;
    x2 = selRect.x + selRect.w;
    y1 = Math.min(anchor.y, my);
    y2 = Math.max(anchor.y, my);
  } else if (handle === 'l' || handle === 'r') {
    // Horizontal only
    y1 = selRect.y;
    y2 = selRect.y + selRect.h;
    x1 = Math.min(anchor.x, mx);
    x2 = Math.max(anchor.x, mx);
  } else {
    // Corner — free resize both axes
    x1 = Math.min(anchor.x, mx);
    y1 = Math.min(anchor.y, my);
    x2 = Math.max(anchor.x, mx);
    y2 = Math.max(anchor.y, my);
  }

  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function isInsideSelection(mx, my) {
  if (!selRect) return false;
  return mx >= selRect.x && mx <= selRect.x + selRect.w &&
         my >= selRect.y && my <= selRect.y + selRect.h;
}

// ── Mouse events ────────────────────────────────────────────────────────────

drawCanvas.addEventListener('mousedown', (e) => {
  if (textActive) return;

  const mx = e.clientX;
  const my = e.clientY;

  if (mode === 'select') {
    selecting = true;
    selStart = { x: mx, y: my };
    hint.classList.add('hidden');
    return;
  }

  // Annotate mode
  // Check resize handles first
  const handle = hitTestHandle(mx, my);
  if (handle) {
    resizing = true;
    resizeHandle = handle;
    resizeOrigin = getResizeAnchor(handle);
    return;
  }

  // Start drawing if inside selection
  if (isInsideSelection(mx, my)) {
    startAnnotation(e);
  }
});

drawCanvas.addEventListener('mousemove', (e) => {
  if (textActive) return;

  const mx = e.clientX;
  const my = e.clientY;

  if (mode === 'select' && selecting) {
    const rect = normalizeRect(selStart, { x: mx, y: my });
    selRect = rect;
    drawOverlay();

    dimLabel.style.display = 'block';
    dimLabel.style.left = rect.x + rect.w + 10 + 'px';
    dimLabel.style.top = rect.y + rect.h + 10 + 'px';
    dimLabel.textContent = `${Math.round(rect.w * scaleFactor)} x ${Math.round(rect.h * scaleFactor)}`;
    return;
  }

  if (resizing && resizeHandle && resizeOrigin) {
    selRect = computeResizedRect(resizeHandle, resizeOrigin, mx, my);
    if (selRect.w < 20) selRect.w = 20;
    if (selRect.h < 20) selRect.h = 20;
    drawOverlay();
    redrawAnnotations();

    // Update dimension label
    dimLabel.style.display = 'block';
    dimLabel.style.left = selRect.x + selRect.w + 10 + 'px';
    dimLabel.style.top = selRect.y + selRect.h + 10 + 'px';
    dimLabel.textContent = `${Math.round(selRect.w * scaleFactor)} x ${Math.round(selRect.h * scaleFactor)}`;
    return;
  }

  if (mode === 'annotate') {
    // Update cursor based on handle proximity
    const handle = hitTestHandle(mx, my);
    if (handle) {
      drawCanvas.style.cursor = handleCursor(handle);
    } else if (isInsideSelection(mx, my)) {
      drawCanvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
    } else {
      drawCanvas.style.cursor = 'default';
    }

    // Continue drawing
    if (currentAnnotation && isDrawing) {
      updateAnnotation(e);
    }
  }
});

drawCanvas.addEventListener('mouseup', (e) => {
  if (textActive) return;

  const mx = e.clientX;
  const my = e.clientY;

  if (mode === 'select' && selecting) {
    selecting = false;
    dimLabel.style.display = 'none';

    selRect = normalizeRect(selStart, { x: mx, y: my });

    if (selRect.w < 10 || selRect.h < 10) {
      selRect = null;
      return;
    }

    enterAnnotateMode();
    return;
  }

  if (resizing) {
    resizing = false;
    dimLabel.style.display = 'none';
    resizeHandle = null;
    resizeOrigin = null;
    repositionToolbar();
    return;
  }

  if (mode === 'annotate' && currentAnnotation && isDrawing) {
    finishAnnotation(e);
  }
});

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

// ── Annotate mode ───────────────────────────────────────────────────────────

function enterAnnotateMode() {
  mode = 'annotate';
  drawCanvas.style.cursor = 'crosshair';
  toolbar.classList.add('visible');
  repositionToolbar();
}

function repositionToolbar() {
  if (!selRect) return;
  requestAnimationFrame(() => {
    const tbRect = toolbar.getBoundingClientRect();
    const toolbarH = tbRect.height;
    const toolbarW = tbRect.width;

    let ty = selRect.y + selRect.h + 14;
    if (ty + toolbarH > screenH - 16) {
      ty = selRect.y - toolbarH - 14;
    }
    if (ty < 8) ty = 8;

    let tx = selRect.x + (selRect.w - toolbarW) / 2;
    tx = Math.max(8, Math.min(tx, screenW - toolbarW - 8));

    toolbar.style.left = tx + 'px';
    toolbar.style.top = ty + 'px';
  });
}

// ── Toolbar interactions ────────────────────────────────────────────────────

toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
toolbar.addEventListener('mouseup', (e) => e.stopPropagation());
toolbar.addEventListener('click', (e) => e.stopPropagation());

document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    tool = btn.dataset.tool;
    drawCanvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
  });
});

document.querySelectorAll('.color-dot').forEach((dot) => {
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
    dot.classList.add('active');
    color = dot.dataset.color;
  });
});

document.getElementById('stroke-width').addEventListener('input', (e) => {
  strokeWidth = parseInt(e.target.value);
  document.getElementById('stroke-label').textContent = strokeWidth;
});

document.getElementById('undo-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  undo();
});

document.getElementById('copy-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  copyToClipboard();
});

document.getElementById('save-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  saveImage();
});

document.getElementById('cancel-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  cancel();
});

// ── Drawing annotations ─────────────────────────────────────────────────────

function startAnnotation(e) {
  const x = e.clientX;
  const y = e.clientY;

  if (tool === 'text') {
    // For text, we handle it on mouseup to avoid focus issues
    return;
  }

  isDrawing = true;
  currentAnnotation = {
    type: tool,
    color,
    strokeWidth,
    startX: x,
    startY: y,
    points: tool === 'pen' ? [{ x, y }] : [],
    endX: x,
    endY: y,
  };
}

function updateAnnotation(e) {
  if (!currentAnnotation || !isDrawing) return;

  currentAnnotation.endX = e.clientX;
  currentAnnotation.endY = e.clientY;

  if (currentAnnotation.type === 'pen') {
    currentAnnotation.points.push({ x: e.clientX, y: e.clientY });
  }

  redrawAnnotations();
}

function finishAnnotation(e) {
  if (!currentAnnotation || !isDrawing) return;

  currentAnnotation.endX = e.clientX;
  currentAnnotation.endY = e.clientY;

  if (currentAnnotation.type === 'pen') {
    currentAnnotation.points.push({ x: e.clientX, y: e.clientY });
  }

  const dx = Math.abs(currentAnnotation.endX - currentAnnotation.startX);
  const dy = Math.abs(currentAnnotation.endY - currentAnnotation.startY);
  if (currentAnnotation.type === 'pen' || dx > 2 || dy > 2) {
    annotations.push(currentAnnotation);
  }

  currentAnnotation = null;
  isDrawing = false;
  redrawAnnotations();
}

// ── Text tool — triggered on click (mouseup), not mousedown ─────────────────

drawCanvas.addEventListener('click', (e) => {
  if (mode !== 'annotate' || tool !== 'text' || textActive || resizing) return;
  const mx = e.clientX;
  const my = e.clientY;
  if (isInsideSelection(mx, my) && !hitTestHandle(mx, my)) {
    showTextInput(mx, my);
  }
});

function showTextInput(x, y) {
  textActive = true;
  textInput.style.display = 'block';
  textInput.style.left = x + 'px';
  textInput.style.top = y + 'px';
  textInput.style.color = color;
  textInput.style.borderColor = color;
  textInput.style.fontSize = Math.max(14, strokeWidth * 5) + 'px';
  textInput.value = '';

  // Delay focus so browser finishes processing the click event chain
  setTimeout(() => {
    textInput.focus();
  }, 30);

  let committed = false;

  const commitText = () => {
    if (committed) return;
    committed = true;

    const text = textInput.value.trim();
    if (text) {
      annotations.push({
        type: 'text',
        color,
        strokeWidth,
        text,
        x,
        y,
        fontSize: Math.max(14, strokeWidth * 5),
      });
      redrawAnnotations();
    }
    textInput.style.display = 'none';
    textActive = false;
    textInput.removeEventListener('keydown', onKey);
    textInput.removeEventListener('blur', onBlur);
  };

  const onBlur = () => {
    // Small delay to let potential click events resolve first
    setTimeout(commitText, 100);
  };

  const onKey = (e) => {
    e.stopPropagation(); // Don't let keystrokes reach the global handler
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitText();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Cancel without saving
      committed = true;
      textInput.style.display = 'none';
      textActive = false;
      textInput.removeEventListener('keydown', onKey);
      textInput.removeEventListener('blur', onBlur);
    }
  };

  textInput.addEventListener('keydown', onKey);
  textInput.addEventListener('blur', onBlur);
}

// ── Render annotations ──────────────────────────────────────────────────────

function redrawAnnotations() {
  const s = scaleFactor;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  if (selRect) {
    drawCtx.save();
    drawCtx.beginPath();
    drawCtx.rect(selRect.x * s, selRect.y * s, selRect.w * s, selRect.h * s);
    drawCtx.clip();
  }

  const all = currentAnnotation ? [...annotations, currentAnnotation] : annotations;

  for (const a of all) {
    drawCtx.save();
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';

    switch (a.type) {
      case 'rect': drawRectAnnotation(a, s); break;
      case 'highlight': drawHighlight(a, s); break;
      case 'arrow': drawArrow(a, s); break;
      case 'pen': drawPen(a, s); break;
      case 'text': drawText(a, s); break;
      case 'blur': drawBlur(a, s); break;
    }

    drawCtx.restore();
  }

  if (selRect) {
    drawCtx.restore();
  }
}

function drawRectAnnotation(a, s) {
  const x = Math.min(a.startX, a.endX) * s;
  const y = Math.min(a.startY, a.endY) * s;
  const w = Math.abs(a.endX - a.startX) * s;
  const h = Math.abs(a.endY - a.startY) * s;
  drawCtx.strokeStyle = a.color;
  drawCtx.lineWidth = a.strokeWidth * s;
  drawCtx.strokeRect(x, y, w, h);
}

function drawHighlight(a, s) {
  const x = Math.min(a.startX, a.endX) * s;
  const y = Math.min(a.startY, a.endY) * s;
  const w = Math.abs(a.endX - a.startX) * s;
  const h = Math.abs(a.endY - a.startY) * s;
  drawCtx.fillStyle = a.color;
  drawCtx.globalAlpha = 0.3;
  drawCtx.fillRect(x, y, w, h);
  drawCtx.globalAlpha = 1;
}

function drawArrow(a, s) {
  const x1 = a.startX * s;
  const y1 = a.startY * s;
  const x2 = a.endX * s;
  const y2 = a.endY * s;

  drawCtx.strokeStyle = a.color;
  drawCtx.fillStyle = a.color;
  drawCtx.lineWidth = a.strokeWidth * s;

  drawCtx.beginPath();
  drawCtx.moveTo(x1, y1);
  drawCtx.lineTo(x2, y2);
  drawCtx.stroke();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(12, a.strokeWidth * 4) * s;
  drawCtx.beginPath();
  drawCtx.moveTo(x2, y2);
  drawCtx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
  drawCtx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
  drawCtx.closePath();
  drawCtx.fill();
}

function drawPen(a, s) {
  if (a.points.length < 2) return;
  drawCtx.strokeStyle = a.color;
  drawCtx.lineWidth = a.strokeWidth * s;
  drawCtx.beginPath();
  drawCtx.moveTo(a.points[0].x * s, a.points[0].y * s);
  for (let i = 1; i < a.points.length; i++) {
    drawCtx.lineTo(a.points[i].x * s, a.points[i].y * s);
  }
  drawCtx.stroke();
}

function drawText(a, s) {
  drawCtx.fillStyle = a.color;
  drawCtx.font = `bold ${a.fontSize * s}px system-ui, sans-serif`;
  drawCtx.textBaseline = 'top';

  const lines = a.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    drawCtx.fillText(lines[i], a.x * s, (a.y + i * a.fontSize * 1.2) * s);
  }
}

function drawBlur(a, s) {
  const x = Math.min(a.startX, a.endX);
  const y = Math.min(a.startY, a.endY);
  const w = Math.abs(a.endX - a.startX);
  const h = Math.abs(a.endY - a.startY);

  if (w < 2 || h < 2) return;

  const sx = Math.round(x * s);
  const sy = Math.round(y * s);
  const sw = Math.round(w * s);
  const sh = Math.round(h * s);

  if (sw < 1 || sh < 1) return;

  try {
    const imageData = bgCtx.getImageData(sx, sy, sw, sh);
    const pixelSize = Math.max(8, Math.round(s * 8));
    const data = imageData.data;

    for (let py = 0; py < sh; py += pixelSize) {
      for (let px = 0; px < sw; px += pixelSize) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = 0; dy < pixelSize && py + dy < sh; dy++) {
          for (let dx = 0; dx < pixelSize && px + dx < sw; dx++) {
            const idx = ((py + dy) * sw + (px + dx)) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
            count++;
          }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        for (let dy = 0; dy < pixelSize && py + dy < sh; dy++) {
          for (let dx = 0; dx < pixelSize && px + dx < sw; dx++) {
            const idx = ((py + dy) * sw + (px + dx)) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
          }
        }
      }
    }

    drawCtx.putImageData(imageData, sx, sy);
  } catch (e) {
    drawCtx.fillStyle = 'rgba(128, 128, 128, 0.7)';
    drawCtx.fillRect(sx, sy, sw, sh);
  }
}

// ── Undo ────────────────────────────────────────────────────────────────────

function undo() {
  if (annotations.length === 0) return;
  annotations.pop();
  redrawAnnotations();
}

// ── Export ───────────────────────────────────────────────────────────────────

function getExportDataURL() {
  const s = scaleFactor;
  const cx = selRect.x * s;
  const cy = selRect.y * s;
  const cw = selRect.w * s;
  const ch = selRect.h * s;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = cw;
  exportCanvas.height = ch;
  const ctx = exportCanvas.getContext('2d');

  ctx.drawImage(bgCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
  ctx.drawImage(drawCanvas, cx, cy, cw, ch, 0, 0, cw, ch);

  return exportCanvas.toDataURL('image/png');
}

async function copyToClipboard() {
  try {
    const dataURL = getExportDataURL();
    await window.snapmark.copyAndClose(dataURL);
  } catch (e) {
    console.error('Copy failed:', e);
    cancel();
  }
}

async function saveImage() {
  try {
    const dataURL = getExportDataURL();
    await window.snapmark.saveImage(dataURL);
  } catch (e) {
    console.error('Save failed:', e);
    cancel();
  }
}

function cancel() {
  window.snapmark.closeSelector();
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Don't handle when text input is active
  if (textActive) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    cancel();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 'c' && mode === 'annotate') {
    e.preventDefault();
    copyToClipboard();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 's' && mode === 'annotate') {
    e.preventDefault();
    saveImage();
    return;
  }

  // Tool shortcuts (single keys)
  if (mode === 'annotate' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const keyMap = { r: 'rect', h: 'highlight', a: 'arrow', p: 'pen', t: 'text', b: 'blur' };
    if (keyMap[e.key]) {
      e.preventDefault();
      tool = keyMap[e.key];
      document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
      });
      drawCanvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
    }
  }
});

document.addEventListener('contextmenu', (e) => e.preventDefault());
