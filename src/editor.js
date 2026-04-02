// ── State ────────────────────────────────────────────────────────────────────
let screenshotImg = null;
let scaleFactor = 1;
let screenW = 0;
let screenH = 0;

// Selection
let selecting = false;
let selStart = { x: 0, y: 0 };
let selRect = null;

// Resize
let resizing = false;
let resizeHandle = null;
let resizeOrigin = null;

// Drawing
let mode = 'select'; // 'select' | 'annotate'
let selectorMode = 'capture'; // 'capture' | 'record-select'
let tool = 'rect';
let color = '#e63946';
let strokeWidth = 3;
let fontSize = 20;
let annotations = [];
let currentAnnotation = null;
let isDrawing = false;

// Text
let textActive = false;

// Move tool state
let selectedIdx = -1;       // index of selected annotation
let isDraggingAnnotation = false;
let dragOffset = { x: 0, y: 0 };

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

const HANDLE_SIZE = 8;

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
  selectorMode = data.mode || 'capture';
  if (selectorMode === 'record-select') {
    hint.textContent = 'Click and drag to select recording area';
  }

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

  const rx = selRect.x * s, ry = selRect.y * s;
  const rw = selRect.w * s, rh = selRect.h * s;

  ovCtx.clearRect(rx, ry, rw, rh);
  ovCtx.strokeStyle = '#e63946';
  ovCtx.lineWidth = 2 * s;
  ovCtx.setLineDash([]);
  ovCtx.strokeRect(rx, ry, rw, rh);

  const hs = 6 * s;
  ovCtx.fillStyle = '#fff';
  const handles = getHandlePositions();
  for (const key in handles) {
    const h = handles[key];
    ovCtx.fillRect(h.x * s - hs / 2, h.y * s - hs / 2, hs, hs);
  }
}

// ── Resize handles ──────────────────────────────────────────────────────────

function getHandlePositions() {
  if (!selRect) return {};
  const { x, y, w, h } = selRect;
  return {
    tl: { x, y }, t: { x: x + w / 2, y }, tr: { x: x + w, y },
    r: { x: x + w, y: y + h / 2 }, br: { x: x + w, y: y + h },
    b: { x: x + w / 2, y: y + h }, bl: { x, y: y + h }, l: { x, y: y + h / 2 },
  };
}

function hitTestHandle(mx, my) {
  const handles = getHandlePositions();
  for (const key in handles) {
    const h = handles[key];
    if (Math.abs(mx - h.x) <= HANDLE_SIZE && Math.abs(my - h.y) <= HANDLE_SIZE) return key;
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

function getResizeAnchor(handle) {
  const { x, y, w, h } = selRect;
  const map = {
    tl: { x: x + w, y: y + h }, t: { x, y: y + h }, tr: { x, y: y + h },
    r: { x, y }, br: { x, y }, b: { x, y }, bl: { x: x + w, y }, l: { x: x + w, y },
  };
  return map[handle];
}

function computeResizedRect(handle, anchor, mx, my) {
  let x1, y1, x2, y2;
  if (handle === 't' || handle === 'b') {
    x1 = selRect.x; x2 = selRect.x + selRect.w;
    y1 = Math.min(anchor.y, my); y2 = Math.max(anchor.y, my);
  } else if (handle === 'l' || handle === 'r') {
    y1 = selRect.y; y2 = selRect.y + selRect.h;
    x1 = Math.min(anchor.x, mx); x2 = Math.max(anchor.x, mx);
  } else {
    x1 = Math.min(anchor.x, mx); y1 = Math.min(anchor.y, my);
    x2 = Math.max(anchor.x, mx); y2 = Math.max(anchor.y, my);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function isInsideSelection(mx, my) {
  if (!selRect) return false;
  return mx >= selRect.x && mx <= selRect.x + selRect.w &&
         my >= selRect.y && my <= selRect.y + selRect.h;
}

// ── Annotation hit testing ──────────────────────────────────────────────────

function getTextBounds(a) {
  const s = scaleFactor;
  drawCtx.font = `bold ${a.fontSize * s}px system-ui, sans-serif`;
  const lines = a.text.split('\n');
  let maxW = 0;
  for (const line of lines) {
    const m = drawCtx.measureText(line);
    if (m.width > maxW) maxW = m.width;
  }
  return {
    x: a.x,
    y: a.y,
    w: maxW / s,
    h: a.fontSize * 1.2 * lines.length,
  };
}

function getAnnotationBounds(a) {
  if (a.type === 'text') return getTextBounds(a);
  if (a.type === 'pen') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of a.points) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  // rect, highlight, line, arrow, blur
  const x = Math.min(a.startX, a.endX), y = Math.min(a.startY, a.endY);
  return { x, y, w: Math.abs(a.endX - a.startX), h: Math.abs(a.endY - a.startY) };
}

function pointNearLine(mx, my, x1, y1, x2, y2, threshold) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return Math.hypot(mx - x1, my - y1) <= threshold;
  const t = Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / (len * len)));
  const px = x1 + t * dx, py = y1 + t * dy;
  return Math.hypot(mx - px, my - py) <= threshold;
}

function hitTestAnnotation(mx, my) {
  const tolerance = 6;
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];

    if (a.type === 'text') {
      const b = getTextBounds(a);
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return i;
    } else if (a.type === 'line' || a.type === 'arrow') {
      if (pointNearLine(mx, my, a.startX, a.startY, a.endX, a.endY, tolerance + a.strokeWidth)) return i;
    } else if (a.type === 'pen') {
      for (let j = 1; j < a.points.length; j++) {
        if (pointNearLine(mx, my, a.points[j-1].x, a.points[j-1].y, a.points[j].x, a.points[j].y, tolerance + a.strokeWidth)) return i;
      }
    } else if (a.type === 'rect') {
      // Hit test the 4 edges of the rectangle
      const x1 = Math.min(a.startX, a.endX), y1 = Math.min(a.startY, a.endY);
      const x2 = Math.max(a.startX, a.endX), y2 = Math.max(a.startY, a.endY);
      const t = tolerance + a.strokeWidth;
      if (pointNearLine(mx, my, x1, y1, x2, y1, t) ||
          pointNearLine(mx, my, x2, y1, x2, y2, t) ||
          pointNearLine(mx, my, x2, y2, x1, y2, t) ||
          pointNearLine(mx, my, x1, y2, x1, y1, t)) return i;
    } else if (a.type === 'highlight' || a.type === 'blur') {
      // Hit test the filled area
      const x = Math.min(a.startX, a.endX), y = Math.min(a.startY, a.endY);
      const w = Math.abs(a.endX - a.startX), h = Math.abs(a.endY - a.startY);
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) return i;
    }
  }
  return -1;
}

function moveAnnotation(idx, dx, dy) {
  const a = annotations[idx];
  if (a.type === 'text') {
    a.x += dx;
    a.y += dy;
  } else if (a.type === 'pen') {
    a.startX += dx; a.startY += dy;
    a.endX += dx; a.endY += dy;
    for (const p of a.points) { p.x += dx; p.y += dy; }
  } else {
    a.startX += dx; a.startY += dy;
    a.endX += dx; a.endY += dy;
  }
}

// ── Mouse events ────────────────────────────────────────────────────────────

drawCanvas.addEventListener('mousedown', (e) => {
  if (textActive) return;
  const mx = e.clientX, my = e.clientY;

  if (mode === 'select') {
    selecting = true;
    selStart = { x: mx, y: my };
    hint.classList.add('hidden');
    return;
  }

  // Annotate mode — check resize handles first
  const handle = hitTestHandle(mx, my);
  if (handle) {
    resizing = true;
    resizeHandle = handle;
    resizeOrigin = getResizeAnchor(handle);
    return;
  }

  // Any tool — try to grab existing annotations first
  if (isInsideSelection(mx, my)) {
    const hit = hitTestAnnotation(mx, my);
    if (hit >= 0) {
      selectedIdx = hit;
      isDraggingAnnotation = true;
      const a = annotations[hit];
      if (a.type === 'text') {
        dragOffset = { x: mx - a.x, y: my - a.y };
      } else {
        dragOffset = { x: mx - a.startX, y: my - a.startY };
      }
      redrawAnnotations();
      return;
    }
  }

  // Move tool on empty area — deselect
  if (tool === 'move') {
    selectedIdx = -1;
    redrawAnnotations();
    return;
  }

  // Text tool — don't start drawing (handled by click event)
  if (tool === 'text') return;

  // Start drawing if inside selection
  if (isInsideSelection(mx, my)) {
    startAnnotation(e);
  }
});

drawCanvas.addEventListener('mousemove', (e) => {
  if (textActive) return;
  const mx = e.clientX, my = e.clientY;

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
    dimLabel.style.display = 'block';
    dimLabel.style.left = selRect.x + selRect.w + 10 + 'px';
    dimLabel.style.top = selRect.y + selRect.h + 10 + 'px';
    dimLabel.textContent = `${Math.round(selRect.w * scaleFactor)} x ${Math.round(selRect.h * scaleFactor)}`;
    return;
  }

  // Dragging annotation
  if (isDraggingAnnotation && selectedIdx >= 0) {
    const a = annotations[selectedIdx];
    let ox, oy;
    if (a.type === 'text') {
      ox = a.x; oy = a.y;
      a.x = mx - dragOffset.x;
      a.y = my - dragOffset.y;
    } else {
      const dx = mx - dragOffset.x - a.startX;
      const dy = my - dragOffset.y - a.startY;
      moveAnnotation(selectedIdx, dx, dy);
      dragOffset = { x: mx - a.startX, y: my - a.startY };
    }
    redrawAnnotations();
    return;
  }

  if (mode === 'annotate') {
    const handle = hitTestHandle(mx, my);
    if (handle) {
      drawCanvas.style.cursor = handleCursor(handle);
    } else if (isInsideSelection(mx, my)) {
      // Show grab cursor when hovering over text annotation (any tool)
      const hit = hitTestAnnotation(mx, my);
      if (hit >= 0) {
        drawCanvas.style.cursor = 'grab';
      } else if (tool === 'move') {
        drawCanvas.style.cursor = 'default';
      } else if (tool === 'text') {
        drawCanvas.style.cursor = 'text';
      } else {
        drawCanvas.style.cursor = 'crosshair';
      }
    } else {
      drawCanvas.style.cursor = 'default';
    }

    if (currentAnnotation && isDrawing) {
      updateAnnotation(e);
    }
  }
});

drawCanvas.addEventListener('mouseup', (e) => {
  if (textActive) return;
  const mx = e.clientX, my = e.clientY;

  if (mode === 'select' && selecting) {
    selecting = false;
    dimLabel.style.display = 'none';
    selRect = normalizeRect(selStart, { x: mx, y: my });
    if (selRect.w < 10 || selRect.h < 10) { selRect = null; return; }
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

  if (isDraggingAnnotation) {
    isDraggingAnnotation = false;
    redrawAnnotations();
    return;
  }

  if (mode === 'annotate' && currentAnnotation && isDrawing) {
    finishAnnotation(e);
  }
});

// ── Double-click to edit text ───────────────────────────────────────────────

drawCanvas.addEventListener('dblclick', (e) => {
  if (mode !== 'annotate' || textActive) return;
  const mx = e.clientX, my = e.clientY;
  const hit = hitTestAnnotation(mx, my);
  if (hit >= 0 && annotations[hit].type === 'text') {
    editTextAnnotation(hit);
  }
});

function editTextAnnotation(idx) {
  const a = annotations[idx];
  textActive = true;
  textInput.style.display = 'block';
  textInput.style.left = a.x + 'px';
  textInput.style.top = a.y + 'px';
  textInput.style.color = a.color;
  textInput.style.borderColor = a.color;
  textInput.style.fontSize = a.fontSize + 'px';
  textInput.value = a.text;

  setTimeout(() => {
    textInput.focus();
    textInput.select();
  }, 30);

  let committed = false;

  const commitEdit = () => {
    if (committed) return;
    committed = true;
    const text = textInput.value.trim();
    if (text) {
      a.text = text;
    } else {
      annotations.splice(idx, 1);
    }
    selectedIdx = -1;
    redrawAnnotations();
    textInput.style.display = 'none';
    textActive = false;
    textInput.removeEventListener('keydown', onKey);
    textInput.removeEventListener('blur', onBlur);
  };

  const onBlur = () => setTimeout(commitEdit, 100);

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
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

// ── Text tool — create new text on click ────────────────────────────────────

drawCanvas.addEventListener('click', (e) => {
  if (mode !== 'annotate' || tool !== 'text' || textActive || resizing) return;
  const mx = e.clientX, my = e.clientY;
  // If clicking on existing text, don't create new — let dblclick handle edit
  if (hitTestAnnotation(mx, my) >= 0) return;
  if (isInsideSelection(mx, my) && !hitTestHandle(mx, my)) {
    showTextInput(mx, my);
  }
});

function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

// ── Annotate mode ───────────────────────────────────────────────────────────

function enterAnnotateMode() {
  // Record-select mode: just return the region and close
  if (selectorMode === 'record-select') {
    window.snapmark.regionSelected({
      x: selRect.x, y: selRect.y,
      w: selRect.w, h: selRect.h,
    });
    return;
  }

  mode = 'annotate';
  drawCanvas.style.cursor = 'crosshair';
  toolbar.classList.add('visible');
  repositionToolbar();
}

function repositionToolbar() {
  if (!selRect) return;
  requestAnimationFrame(() => {
    const tbRect = toolbar.getBoundingClientRect();
    const toolbarH = tbRect.height, toolbarW = tbRect.width;
    let ty = selRect.y + selRect.h + 14;
    if (ty + toolbarH > screenH - 16) ty = selRect.y - toolbarH - 14;
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

function setActiveTool(newTool) {
  tool = newTool;
  selectedIdx = -1;
  document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });

  if (tool === 'move') {
    drawCanvas.style.cursor = 'default';
  } else if (tool === 'text') {
    drawCanvas.style.cursor = 'text';
  } else {
    drawCanvas.style.cursor = 'crosshair';
  }

  // Toggle stroke width vs font size slider
  document.getElementById('stroke-group').style.display = (tool === 'text' || tool === 'move') ? 'none' : 'flex';
  document.getElementById('fontsize-group').style.display = tool === 'text' ? 'flex' : 'none';
  redrawAnnotations();
}

document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveTool(btn.dataset.tool);
  });
});

function setColor(newColor) {
  color = newColor;
  document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
  document.getElementById('color-picker-btn').classList.remove('active');
  const preset = document.querySelector(`.color-dot[data-color="${newColor}"]`);
  if (preset) {
    preset.classList.add('active');
  } else {
    document.getElementById('color-picker-btn').classList.add('active');
    document.getElementById('color-picker-btn').style.background = newColor;
  }
  document.getElementById('color-picker').value = newColor;
}

document.querySelectorAll('.color-dot').forEach((dot) => {
  dot.addEventListener('click', (e) => { e.stopPropagation(); setColor(dot.dataset.color); });
});

const colorPicker = document.getElementById('color-picker');
colorPicker.addEventListener('input', (e) => { e.stopPropagation(); setColor(e.target.value); });
colorPicker.addEventListener('click', (e) => e.stopPropagation());
colorPicker.addEventListener('mousedown', (e) => e.stopPropagation());

document.getElementById('stroke-width').addEventListener('input', (e) => {
  strokeWidth = parseInt(e.target.value);
  document.getElementById('stroke-label').textContent = strokeWidth;
});

document.getElementById('font-size').addEventListener('input', (e) => {
  fontSize = parseInt(e.target.value);
  document.getElementById('fontsize-label').textContent = fontSize + 'px';
});

document.getElementById('undo-btn').addEventListener('click', (e) => { e.stopPropagation(); undo(); });
document.getElementById('copy-btn').addEventListener('click', (e) => { e.stopPropagation(); copyToClipboard(); });
document.getElementById('save-btn').addEventListener('click', (e) => { e.stopPropagation(); saveImage(); });
document.getElementById('cancel-btn').addEventListener('click', (e) => { e.stopPropagation(); cancel(); });

// ── Drawing annotations ─────────────────────────────────────────────────────

function startAnnotation(e) {
  const x = e.clientX, y = e.clientY;
  isDrawing = true;
  currentAnnotation = {
    type: tool,
    color,
    strokeWidth,
    startX: x, startY: y,
    points: tool === 'pen' ? [{ x, y }] : [],
    endX: x, endY: y,
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

function showTextInput(x, y) {
  textActive = true;
  textInput.style.display = 'block';
  textInput.style.left = x + 'px';
  textInput.style.top = y + 'px';
  textInput.style.color = color;
  textInput.style.borderColor = color;
  textInput.style.fontSize = fontSize + 'px';
  textInput.value = '';

  setTimeout(() => { textInput.focus(); }, 30);

  let committed = false;
  const capturedFontSize = fontSize;

  const commitText = () => {
    if (committed) return;
    committed = true;
    const text = textInput.value.trim();
    if (text) {
      annotations.push({ type: 'text', color, text, x, y, fontSize: capturedFontSize });
      redrawAnnotations();
    }
    textInput.style.display = 'none';
    textActive = false;
    textInput.removeEventListener('keydown', onKey);
    textInput.removeEventListener('blur', onBlur);
  };

  const onBlur = () => setTimeout(commitText, 100);

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
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

  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    drawCtx.save();
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';

    switch (a.type) {
      case 'rect': drawRectAnnotation(a, s); break;
      case 'highlight': drawHighlight(a, s); break;
      case 'line': drawLine(a, s); break;
      case 'arrow': drawArrow(a, s); break;
      case 'pen': drawPen(a, s); break;
      case 'text': drawText(a, s); break;
      case 'blur': drawBlur(a, s); break;
    }

    // Draw selection highlight for selected annotation
    if (i === selectedIdx) {
      drawSelectionHighlight(a, s);
    }

    drawCtx.restore();
  }

  if (selRect) {
    drawCtx.restore();
  }
}

function drawSelectionHighlight(a, s) {
  drawCtx.setLineDash([4 * s, 4 * s]);
  drawCtx.strokeStyle = '#4fc3f7';
  drawCtx.lineWidth = 1.5 * s;

  if (a.type === 'text') {
    const b = getTextBounds(a);
    const pad = 4;
    drawCtx.strokeRect((b.x - pad) * s, (b.y - pad) * s, (b.w + pad * 2) * s, (b.h + pad * 2) * s);
  } else if (a.type === 'pen') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of a.points) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    drawCtx.strokeRect((minX - 4) * s, (minY - 4) * s, (maxX - minX + 8) * s, (maxY - minY + 8) * s);
  } else {
    const x = Math.min(a.startX, a.endX), y = Math.min(a.startY, a.endY);
    const w = Math.abs(a.endX - a.startX), h = Math.abs(a.endY - a.startY);
    drawCtx.strokeRect((x - 4) * s, (y - 4) * s, (w + 8) * s, (h + 8) * s);
  }
  drawCtx.setLineDash([]);
}

function drawRectAnnotation(a, s) {
  const x = Math.min(a.startX, a.endX) * s, y = Math.min(a.startY, a.endY) * s;
  const w = Math.abs(a.endX - a.startX) * s, h = Math.abs(a.endY - a.startY) * s;
  drawCtx.strokeStyle = a.color;
  drawCtx.lineWidth = a.strokeWidth * s;
  drawCtx.strokeRect(x, y, w, h);
}

function drawHighlight(a, s) {
  const x = Math.min(a.startX, a.endX) * s, y = Math.min(a.startY, a.endY) * s;
  const w = Math.abs(a.endX - a.startX) * s, h = Math.abs(a.endY - a.startY) * s;
  drawCtx.fillStyle = a.color;
  drawCtx.globalAlpha = 0.3;
  drawCtx.fillRect(x, y, w, h);
  drawCtx.globalAlpha = 1;
}

function drawLine(a, s) {
  drawCtx.strokeStyle = a.color;
  drawCtx.lineWidth = a.strokeWidth * s;
  drawCtx.beginPath();
  drawCtx.moveTo(a.startX * s, a.startY * s);
  drawCtx.lineTo(a.endX * s, a.endY * s);
  drawCtx.stroke();
}

function drawArrow(a, s) {
  const x1 = a.startX * s, y1 = a.startY * s;
  const x2 = a.endX * s, y2 = a.endY * s;
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
  const x = Math.min(a.startX, a.endX), y = Math.min(a.startY, a.endY);
  const w = Math.abs(a.endX - a.startX), h = Math.abs(a.endY - a.startY);
  if (w < 2 || h < 2) return;
  const sx = Math.round(x * s), sy = Math.round(y * s);
  const sw = Math.round(w * s), sh = Math.round(h * s);
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
            r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; count++;
          }
        }
        r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
        for (let dy = 0; dy < pixelSize && py + dy < sh; dy++) {
          for (let dx = 0; dx < pixelSize && px + dx < sw; dx++) {
            const idx = ((py + dy) * sw + (px + dx)) * 4;
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b;
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
  if (selectedIdx >= 0) { selectedIdx = -1; }
  annotations.pop();
  redrawAnnotations();
}

// ── Export ───────────────────────────────────────────────────────────────────

function getExportDataURL() {
  // Temporarily clear selection highlight for export
  const savedIdx = selectedIdx;
  selectedIdx = -1;
  redrawAnnotations();

  const s = scaleFactor;
  const cx = selRect.x * s, cy = selRect.y * s;
  const cw = selRect.w * s, ch = selRect.h * s;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = cw;
  exportCanvas.height = ch;
  const ctx = exportCanvas.getContext('2d');
  ctx.drawImage(bgCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
  ctx.drawImage(drawCanvas, cx, cy, cw, ch, 0, 0, cw, ch);

  selectedIdx = savedIdx;
  redrawAnnotations();
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
  if (textActive) return;

  if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }

  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); return; }

  if ((e.metaKey || e.ctrlKey) && e.key === 'c' && mode === 'annotate') {
    e.preventDefault(); copyToClipboard(); return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 's' && mode === 'annotate') {
    e.preventDefault(); saveImage(); return;
  }

  // Delete selected annotation
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx >= 0) {
    e.preventDefault();
    annotations.splice(selectedIdx, 1);
    selectedIdx = -1;
    redrawAnnotations();
    return;
  }

  // Tool shortcuts
  if (mode === 'annotate' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const keyMap = {
      v: 'move', r: 'rect', h: 'highlight', l: 'line',
      a: 'arrow', p: 'pen', t: 'text', b: 'blur',
    };
    if (keyMap[e.key]) {
      e.preventDefault();
      setActiveTool(keyMap[e.key]);
    }
  }
});

document.addEventListener('contextmenu', (e) => e.preventDefault());
