let mediaRecorder = null;
let chunks = [];
let startTime = 0;
let pausedDuration = 0;
let pauseStart = 0;
let timerInterval = null;
let animFrameId = null;

window.snapmark.onInitRecorder(async (data) => {
  const { sourceId, region, scaleFactor, screenW, screenH, isFullscreen } = data;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: screenW * scaleFactor,
          maxWidth: screenW * scaleFactor,
          minHeight: screenH * scaleFactor,
          maxHeight: screenH * scaleFactor,
        },
      },
    });
  } catch (e) {
    console.error('Failed to get media stream:', e);
    window.snapmark.recordingComplete(null);
    return;
  }

  let recordStream = stream;

  // Crop to region via canvas if not fullscreen
  if (!isFullscreen && region) {
    const video = document.getElementById('source');
    video.srcObject = stream;
    await video.play();

    const canvas = document.getElementById('crop-canvas');
    const s = scaleFactor;
    canvas.width = Math.round(region.w * s);
    canvas.height = Math.round(region.h * s);
    const ctx = canvas.getContext('2d');

    function drawFrame() {
      ctx.drawImage(
        video,
        Math.round(region.x * s), Math.round(region.y * s),
        canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height
      );
      animFrameId = requestAnimationFrame(drawFrame);
    }
    drawFrame();

    recordStream = canvas.captureStream(30);
  }

  // Pick best supported codec
  const mimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  let mimeType = '';
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
  }

  mediaRecorder = new MediaRecorder(recordStream, {
    mimeType,
    videoBitsPerSecond: 2500000,
  });

  chunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    clearInterval(timerInterval);
    if (animFrameId) cancelAnimationFrame(animFrameId);

    const blob = new Blob(chunks, { type: 'video/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    // Send as Uint8Array (serializable over IPC)
    window.snapmark.recordingComplete(new Uint8Array(arrayBuffer));

    // Cleanup
    stream.getTracks().forEach((t) => t.stop());
  };

  mediaRecorder.start(100);
  startTime = Date.now();
  pausedDuration = 0;

  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime - pausedDuration;
    window.snapmark.recordingTimeUpdate(elapsed);
  }, 500);
});

window.snapmark.onRecordingCommand((cmd) => {
  if (!mediaRecorder) return;
  if (cmd === 'pause' && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    pauseStart = Date.now();
  }
  if (cmd === 'resume' && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    pausedDuration += Date.now() - pauseStart;
  }
  if (cmd === 'stop') {
    mediaRecorder.stop();
  }
});
