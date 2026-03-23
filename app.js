const ui = {
  upload: document.getElementById('upload'),
  playBtn: document.getElementById('playBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  resetBtn: document.getElementById('resetBtn'),
  video: document.getElementById('original-video'),
  canvas: document.getElementById('canvas'),
  display: document.getElementById('display'),
  jumpDetails: document.getElementById('jump-details'),
  metrics: document.getElementById('metrics'),
  debug: document.getElementById('debug'),
  log: document.getElementById('log'),
  history: document.getElementById('jump-history'),
  statusDot: document.getElementById('statusDot'),
  videoMeta: document.getElementById('videoMeta'),
  confidenceValue: document.getElementById('confidenceValue'),
  phaseValue: document.getElementById('phaseValue'),
  metricVy: document.getElementById('metric-vy'),
  metricRot: document.getElementById('metric-rot'),
  metricLean: document.getElementById('metric-lean'),
  metricSwing: document.getElementById('metric-swing'),
  metricHeight: document.getElementById('metric-height'),
  metricToe: document.getElementById('metric-toe'),
  takeoffThreshold: document.getElementById('takeoffThreshold'),
  landingThreshold: document.getElementById('landingThreshold'),
  rotationThreshold: document.getElementById('rotationThreshold'),
  takeoffThresholdValue: document.getElementById('takeoffThresholdValue'),
  landingThresholdValue: document.getElementById('landingThresholdValue'),
  rotationThresholdValue: document.getElementById('rotationThresholdValue'),
};

class JumpDetector {
  constructor(config) {
    this.config = config;
    this.maxHistory = 90;
    this.reset();
  }

  reset() {
    this.history = [];
    this.eventHistory = [];
    this.isJumping = false;
    this.cooldown = 0;
    this.jumpStartFrame = null;
    this.lastStableMetrics = this.createEmptyMetrics();
    this.baselineHipY = null;
    this.trackedCenterX = null;
  }

  createEmptyMetrics() {
    return {
      vy: 0,
      rotation: 0,
      forwardLean: 0,
      legSwing: 0,
      jumpHeight: 0,
      toePick: false,
      airFrames: 0,
      phase: 'Ожидание',
    };
  }

  updateConfig(nextConfig) {
    this.config = { ...this.config, ...nextConfig };
  }

  trackPerson(landmarks) {
    const shoulderCenterX = (landmarks[11].x + landmarks[12].x) / 2;

    if (this.trackedCenterX === null) {
      this.trackedCenterX = shoulderCenterX;
      return true;
    }

    const drift = Math.abs(shoulderCenterX - this.trackedCenterX);
    this.trackedCenterX = shoulderCenterX;
    return drift < 0.55;
  }

  calculateMetrics(landmarks) {
    if (!landmarks || this.history.length < 4) {
      return this.createEmptyMetrics();
    }

    const current = landmarks;
    const previous = this.history[this.history.length - 4];

    const nose = current[0];
    const leftShoulder = current[11];
    const rightShoulder = current[12];
    const leftHip = current[23];
    const rightHip = current[24];
    const leftKnee = current[25];
    const rightKnee = current[26];
    const leftAnkle = current[27];
    const rightAnkle = current[28];

    const hipCenterY = (leftHip.y + rightHip.y) / 2;
    if (this.baselineHipY === null) {
      this.baselineHipY = hipCenterY;
    }

    const previousShoulderX = (previous[11].x + previous[12].x) / 2;
    const currentShoulderX = (leftShoulder.x + rightShoulder.x) / 2;
    const previousAnkleY = (previous[27].y + previous[28].y) / 2;
    const currentAnkleY = (leftAnkle.y + rightAnkle.y) / 2;

    const vy = (previous[0].y - nose.y) * 100;
    const rotation = Math.abs(currentShoulderX - previousShoulderX) * 100;
    const forwardLean = hipCenterY - (leftShoulder.y + rightShoulder.y) / 2;
    const legSwing = Math.abs(leftKnee.x - rightKnee.x) * 100;
    const jumpHeight = Math.max(0, (this.baselineHipY - hipCenterY) * 100);
    const toePick = Math.abs(currentAnkleY - previousAnkleY) * 100 > 12;
    const airFrames = this.isJumping && this.jumpStartFrame !== null
      ? this.history.length - this.jumpStartFrame
      : 0;

    this.baselineHipY = this.baselineHipY * 0.92 + hipCenterY * 0.08;

    return {
      vy,
      rotation,
      forwardLean,
      legSwing,
      jumpHeight,
      toePick,
      airFrames,
      phase: this.resolvePhase(vy),
    };
  }

  resolvePhase(vy) {
    if (this.isJumping && vy < this.config.landingThreshold) return 'Приземление';
    if (this.isJumping) return 'Полет';
    if (vy > this.config.takeoffThreshold * 0.75) return 'Заход';
    return 'Ожидание';
  }

  estimateRotations(airFrames, rotation) {
    if (airFrames > 36 || rotation > 0.34) return 4;
    if (airFrames > 28 || rotation > 0.25) return 3;
    if (airFrames > 18 || rotation > 0.18) return 2;
    return 1;
  }

  classifyJump(metrics) {
    const rotations = this.estimateRotations(metrics.airFrames, metrics.rotation / 100);
    const axelSignal = metrics.forwardLean > 0.028 && metrics.rotation > 9 && metrics.vy > 0.16;

    if (axelSignal) {
      return {
        type: `${rotations}A`,
        family: rotations >= 4 ? 'ultra' : 'axel',
        rationale: 'Выраженный наклон вперед + вход через аксельный паттерн.',
        confidence: Math.min(0.98, 0.72 + metrics.vy + metrics.rotation / 100),
      };
    }

    if (metrics.toePick) {
      if (metrics.rotation > 18) {
        return {
          type: `${rotations}Lz`,
          family: 'toe',
          rationale: 'Toe-pick активен, ротация корпуса выше базового порога.',
          confidence: 0.76,
        };
      }

      if (metrics.legSwing > 32) {
        return {
          type: `${rotations}F`,
          family: 'toe',
          rationale: 'Toe-pick и выраженный swing свободной ноги.',
          confidence: 0.72,
        };
      }

      return {
        type: `${rotations}T`,
        family: 'toe',
        rationale: 'Прыжок из зубцовой группы с умеренной ротацией.',
        confidence: 0.68,
      };
    }

    if (metrics.legSwing > 38) {
      return {
        type: `${rotations}S`,
        family: 'edge',
        rationale: 'Реберный заход с заметным swing-паттерном.',
        confidence: 0.71,
      };
    }

    if (metrics.rotation > this.config.rotationThreshold * 100) {
      return {
        type: `${rotations}Lo`,
        family: 'edge',
        rationale: 'Высокая ротация корпуса без явного toe assist.',
        confidence: 0.7,
      };
    }

    return {
      type: `${rotations}?`,
      family: 'edge',
      rationale: 'Обнаружен прыжковый паттерн, но данных для точной группы мало.',
      confidence: 0.52,
    };
  }

  analyze(landmarks) {
    if (!landmarks || !this.trackPerson(landmarks)) {
      return { jumpInfo: null, metrics: this.lastStableMetrics };
    }

    this.history.push(landmarks);
    if (this.history.length > this.maxHistory) this.history.shift();

    const metrics = this.calculateMetrics(landmarks);
    this.lastStableMetrics = metrics;

    if (this.cooldown > 0) {
      this.cooldown -= 1;
      return { jumpInfo: null, metrics };
    }

    if (metrics.vy > this.config.takeoffThreshold && !this.isJumping) {
      this.isJumping = true;
      this.jumpStartFrame = this.history.length - 1;
      this.pushEvent(`Зафиксирован взлет: vy=${metrics.vy.toFixed(3)}`);
    }

    if (metrics.vy < this.config.landingThreshold && this.isJumping) {
      this.isJumping = false;
      this.cooldown = 42;
      const jumpInfo = this.classifyJump(metrics);
      this.pushEvent(`Приземление: ${jumpInfo.type} / conf ${Math.round(jumpInfo.confidence * 100)}%`);
      return { jumpInfo, metrics };
    }

    return { jumpInfo: null, metrics };
  }

  pushEvent(message) {
    this.eventHistory.unshift({
      message,
      timestamp: new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    });

    if (this.eventHistory.length > 6) {
      this.eventHistory.pop();
    }
  }
}

function setLog(message, active = false) {
  ui.log.textContent = message;
  ui.statusDot.classList.toggle('active', active);
}

function updateThresholdLabels() {
  ui.takeoffThresholdValue.value = Number(ui.takeoffThreshold.value).toFixed(2);
  ui.landingThresholdValue.value = Number(ui.landingThreshold.value).toFixed(2);
  ui.rotationThresholdValue.value = Number(ui.rotationThreshold.value).toFixed(2);
}

function renderHistory(events) {
  ui.history.innerHTML = '';

  if (!events.length) {
    ui.history.innerHTML = '<li>Журнал пока пуст.</li>';
    return;
  }

  events.forEach((event) => {
    const item = document.createElement('li');
    item.textContent = `${event.timestamp} — ${event.message}`;
    ui.history.appendChild(item);
  });
}

function updateMetrics(metrics) {
  ui.metricVy.textContent = metrics.vy.toFixed(3);
  ui.metricRot.textContent = metrics.rotation.toFixed(1);
  ui.metricLean.textContent = metrics.forwardLean.toFixed(3);
  ui.metricSwing.textContent = metrics.legSwing.toFixed(1);
  ui.metricHeight.textContent = metrics.jumpHeight.toFixed(3);
  ui.metricToe.textContent = metrics.toePick ? 'Да' : 'Нет';
  ui.phaseValue.textContent = metrics.phase;
}

function renderDecision(jumpInfo) {
  if (!jumpInfo) return;

  ui.display.textContent = jumpInfo.type;
  ui.display.className = `jump-card ${jumpInfo.family}`;
  ui.confidenceValue.textContent = `${Math.round(jumpInfo.confidence * 100)}%`;
  ui.jumpDetails.textContent = `${jumpInfo.rationale} Это эвристический вывод, не финальная судейская оценка.`;

  window.setTimeout(() => {
    if (ui.display.textContent === jumpInfo.type) {
      ui.display.textContent = 'IDLE';
      ui.display.className = 'jump-card idle';
      ui.jumpDetails.textContent = 'Ожидание следующего элемента.';
      ui.confidenceValue.textContent = '0%';
    }
  }, 2800);
}

function updateControls({ loaded, playing }) {
  ui.playBtn.disabled = !loaded || playing;
  ui.pauseBtn.disabled = !loaded || !playing;
  ui.resetBtn.disabled = !loaded;
}

function resetCanvas(ctx) {
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
}

function initApp() {
  const poseAvailable = typeof Pose !== 'undefined' && typeof drawConnectors !== 'undefined' && typeof POSE_CONNECTIONS !== 'undefined';

  const detector = new JumpDetector({
    takeoffThreshold: Number(ui.takeoffThreshold.value),
    landingThreshold: Number(ui.landingThreshold.value),
    rotationThreshold: Number(ui.rotationThreshold.value),
  });

  const ctx = ui.canvas.getContext('2d');
  const pose = poseAvailable
    ? new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      })
    : null;

  if (pose) {
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
  }

  let processing = false;
  let lastObjectUrl = null;

  const syncDetectorConfig = () => {
    updateThresholdLabels();
    detector.updateConfig({
      takeoffThreshold: Number(ui.takeoffThreshold.value),
      landingThreshold: Number(ui.landingThreshold.value),
      rotationThreshold: Number(ui.rotationThreshold.value),
    });
  };

  [ui.takeoffThreshold, ui.landingThreshold, ui.rotationThreshold].forEach((input) => {
    input.addEventListener('input', syncDetectorConfig);
  });

  if (pose) {
    pose.onResults((results) => {
      if (!results.poseLandmarks || !processing) return;

    if (ui.video.videoWidth && ui.video.videoHeight) {
      ui.canvas.width = ui.video.videoWidth;
      ui.canvas.height = ui.video.videoHeight;
    }

    resetCanvas(ctx);
    ctx.drawImage(results.image, 0, 0, ui.canvas.width, ui.canvas.height);

    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
      color: '#66e3ff',
      lineWidth: 2,
    });

    results.poseLandmarks.forEach((landmark, index) => {
      if (landmark.visibility <= 0.5) return;

      ctx.beginPath();
      ctx.arc(landmark.x * ui.canvas.width, landmark.y * ui.canvas.height, 4, 0, Math.PI * 2);
      ctx.fillStyle = index >= 27 ? '#ff5d88' : index >= 23 ? '#47f0a7' : index >= 11 ? '#66e3ff' : '#ffb648';
      ctx.fill();
    });

    const { jumpInfo, metrics } = detector.analyze(results.poseLandmarks);
    updateMetrics(metrics);
    renderHistory(detector.eventHistory);

    ui.metrics.textContent = `Фаза: ${metrics.phase}. Высота: ${metrics.jumpHeight.toFixed(3)}. Toe assist: ${metrics.toePick ? 'обнаружен' : 'нет'}.`;
    ui.debug.textContent = `STATE: ${detector.isJumping ? 'AIRBORNE' : 'TRACKING'} | cooldown=${detector.cooldown} | frames=${detector.history.length}`;

      if (jumpInfo) {
        renderDecision(jumpInfo);
      }
    });
  }

  async function processFrame() {
    if (!processing || ui.video.paused || ui.video.ended) return;

    try {
      if (!pose) return;
      await pose.send({ image: ui.video });
      window.requestAnimationFrame(processFrame);
    } catch (error) {
      processing = false;
      setLog('PROCESSING_ERROR');
      ui.debug.textContent = `Ошибка обработки: ${error.message}`;
      updateControls({ loaded: Boolean(ui.video.src), playing: false });
    }
  }

  ui.upload.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (lastObjectUrl) {
      URL.revokeObjectURL(lastObjectUrl);
    }

    detector.reset();
    renderHistory([]);
    ui.display.textContent = 'IDLE';
    ui.display.className = 'jump-card idle';
    ui.jumpDetails.textContent = 'Видео загружено. Запустите воспроизведение для анализа.';
    ui.videoMeta.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    setLog(`LOADING: ${file.name}`);

    const handleLoaded = () => {
      ui.canvas.width = ui.video.videoWidth || 1280;
      ui.canvas.height = ui.video.videoHeight || 720;
      ui.videoMeta.textContent = `${file.name} · ${ui.video.videoWidth}×${ui.video.videoHeight}`;
      ui.debug.textContent = pose
        ? 'Готово к анализу. Нажмите «Старт». '
        : 'Видео готово к просмотру. AI-анализ недоступен, потому что MediaPipe не загрузился.';
      setLog(pose ? 'VIDEO_READY' : 'VIDEO_READY_NO_AI');
      updateControls({ loaded: true, playing: false });
    };

    const handleError = () => {
      setLog('VIDEO_LOAD_ERROR');
      ui.debug.textContent = `Не удалось загрузить видео «${file.name}». Возможно, браузер не поддерживает кодек этого файла.`;
    };

    ui.video.addEventListener('loadedmetadata', handleLoaded, { once: true });
    ui.video.addEventListener('error', handleError, { once: true });

    const objectUrl = URL.createObjectURL(file);
    lastObjectUrl = objectUrl;
    ui.video.src = objectUrl;
    ui.video.load();
  });

  ui.playBtn.addEventListener('click', async () => {
    if (!ui.video.src) return;
    await ui.video.play();
    processing = true;
    setLog(pose ? 'DETECTING' : 'PLAYBACK_ONLY', Boolean(pose));
    ui.debug.textContent = pose
      ? 'Идет анализ позы и прыжков.'
      : 'Видео воспроизводится без AI-анализа: MediaPipe не загрузился.';
    updateControls({ loaded: true, playing: true });
    if (pose) processFrame();
  });

  ui.pauseBtn.addEventListener('click', () => {
    ui.video.pause();
    processing = false;
    setLog('PAUSED');
    updateControls({ loaded: true, playing: false });
  });

  ui.resetBtn.addEventListener('click', () => {
    ui.video.pause();
    ui.video.currentTime = 0;
    processing = false;
    detector.reset();
    resetCanvas(ctx);
    renderHistory([]);
    updateMetrics(detector.createEmptyMetrics());
    ui.display.textContent = 'IDLE';
    ui.display.className = 'jump-card idle';
    ui.jumpDetails.textContent = 'Сессия сброшена. Можно запускать повторный анализ.';
    ui.metrics.textContent = 'Ожидание видео для запуска модели.';
    ui.debug.textContent = 'Состояние сброшено.';
    setLog('RESET');
    updateControls({ loaded: Boolean(ui.video.src), playing: false });
  });

  ui.video.addEventListener('pause', () => {
    if (!processing) return;
    processing = false;
    setLog('PAUSED');
    updateControls({ loaded: true, playing: false });
  });

  ui.video.addEventListener('play', () => {
    if (processing) return;
    processing = true;
    setLog(pose ? 'DETECTING' : 'PLAYBACK_ONLY', Boolean(pose));
    updateControls({ loaded: true, playing: true });
    if (pose) processFrame();
  });

  ui.video.addEventListener('ended', () => {
    processing = false;
    setLog('ANALYSIS_COMPLETE');
    updateControls({ loaded: true, playing: false });
  });

  updateThresholdLabels();
  updateMetrics(detector.createEmptyMetrics());
  renderHistory([]);

  if (pose) {
    setLog('ENGINE_READY');
    ui.debug.textContent = 'Universal detector ready. Загрузите видео проката.';
  } else {
    setLog('VIDEO_READY_NO_AI');
    ui.debug.textContent = 'MediaPipe не загрузился: загрузка и просмотр видео доступны, но AI-анализ отключен.';
    ui.metrics.textContent = 'Диагностика доступна после загрузки MediaPipe. Проверьте интернет или откройте локальную копию библиотек.';
  }
}


window.addEventListener('load', initApp);
