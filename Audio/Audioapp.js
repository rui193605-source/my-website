'use strict';

/* ================= DOM 引用 ================= */
const $ = (id) => document.getElementById(id);
const canvas = $('core');           // 主舞台画布
const g = canvas.getContext('2d');  // 主画布上下文
const spec = $('spectrum');         // 右侧频谱画布
const sg = spec.getContext('2d');   // 频谱画布上下文
const playerEl = $('player');       // 播放器面板
const ppBtn = $('playpause');       // 播放 / 暂停按钮
const trackEl = $('track');         // 文件名
const seekEl = $('seek');           // 进度条
const timeEl = $('time');           // 时间显示
const muteBtn = $('mute');          // 静音按钮

/* ================= 运行时状态 ================= */
let ctx;                 // AudioContext（首次交互时创建）
let analyser;            // 频谱分析节点
let bins;                // 频域数据（Uint8Array）
let wave;                // 时域数据（Float32Array）
let master;              // 主音量节点
let stream;              // 麦克风 MediaStream
let source;              // 当前音源（BufferSource / MediaStreamSource）
let buffer;              // 解码后的音频数据
let offset = 0;          // 暂停 / 跳转后的播放偏移（秒）
let mode = 'mic';        // 输入模式：mic | file
let playing = false;     // 是否正在播放
let loading = false;     // 是否正在异步加载
let session = 0;         // 会话计数，用于作废旧异步任务
let rafTime = 0;         // 上一帧时间戳
let angle = -0.32;       // 视角水平旋转
let tilt = 0.58;         // 视角俯仰（Z 轴压扁系数）
let zoom = 1;            // 缩放
let drag = null;         // 拖拽状态
let gain = 1.4;          // 灵敏度
let smoothing = 0.75;    // 运动平滑度
let energy = 0;          // 当前能量（RMS）
let micState = 'idle';   // 麦克风权限：idle（未询问/无设备）| granted | denied
let fileName = '';       // 当前音频文件名
let startedAt = 0;       // 本轮播放开始时的音频时钟（秒）
let seeking = false;     // 是否正在拖动进度条
let lastVolume = 40;     // 静音前的音量

/* ================= 控制棒阵列 ================= */
// 半径 15 的圆内所有整数格点，每格一根控制棒
const rods = [];
for (let x = -15; x <= 15; x++) {
  for (let z = -15; z <= 15; z++) {
    const r = Math.hypot(x, z);
    if (r > 15) continue;
    rods.push({
      x,
      z,
      r,      // 到中心的距离，决定对应频段
      h: 0,   // 当前高度（逐帧插值）
      seed: Math.abs(Math.sin(x * 127.1 + z * 311.7)), // 稳定的伪随机外观种子
      idx: 0  // 当前映射到的频点索引
    });
  }
}

/* ================= 画布尺寸（适配 DPR） ================= */
function size() {
  for (const c of [canvas, spec]) {
    const rect = c.getBoundingClientRect();
    const d = Math.min(devicePixelRatio || 1, 2); // DPR 最高按 2 倍渲染
    c.width = Math.round(rect.width * d);
    c.height = Math.round(rect.height * d);
    c.getContext('2d').setTransform(d, 0, 0, d, 0, 0);
  }
}
new ResizeObserver(size).observe(canvas);
new ResizeObserver(size).observe(spec);

/* ================= 3D → 屏幕投影 ================= */
// 等距视角：先绕 Y 轴旋转，再按 tilt 压扁 Z 轴，最后按高度 h 上移
function point(x, z, h = 0) {
  const w = canvas.clientWidth;
  const H = canvas.clientHeight;
  const s = Math.min(w / 45, H / 37) * zoom;
  const rx = x * Math.cos(angle) - z * Math.sin(angle);
  const rz = x * Math.sin(angle) + z * Math.cos(angle);
  return [w / 2 + rx * s, H * 0.55 + rz * s * tilt - h * s];
}

/* ================= 多边形绘制 ================= */
function poly(points, fill, stroke) {
  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 0.55;
    g.stroke();
  }
}

/* ================= 同心圆环 ================= */
function ring(r, color, width) {
  g.beginPath();
  for (let i = 0; i <= 100; i++) {
    const a = (i / 100) * Math.PI * 2;
    const p = point(Math.cos(a) * r, Math.sin(a) * r);
    i ? g.lineTo(...p) : g.moveTo(...p);
  }
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}

/* ================= 主渲染循环 ================= */
function frame(t) {
  // dt：相对上一帧的步长（以 60fps 为 1），上限 3，避免卡顿后跳变
  const dt = Math.min((t - rafTime) / 16.67, 3) || 1;
  rafTime = t;

  const w = canvas.clientWidth;
  const H = canvas.clientHeight;
  g.clearRect(0, 0, w, H);

  // 播放中才读取频域数据
  if (analyser && playing) analyser.getByteFrequencyData(bins);

  let sum = 0;        // 频域总和（保留备用）
  let peak = 0;       // 峰值幅度
  let peakIndex = 0;  // 峰值所在频点
  if (playing && bins) {
    for (let i = 0; i < bins.length; i++) {
      sum += bins[i];
      if (bins[i] > peak) {
        peak = bins[i];
        peakIndex = i;
      }
    }
  }

  // 用时域 RMS 估算输入电平
  energy = 0;
  if (playing && wave) {
    analyser.getFloatTimeDomainData(wave);
    for (const v of wave) energy += v * v;
    energy = Math.sqrt(energy / wave.length);
  }

  // 底座与外圈
  ring(16.4, '#060b07', 20);
  ring(16.5, '#505948', 2);
  ring(16, '#878969', 1);
  ring(17.3, '#303a2d', 1);

  // 外圈刻度环（80 段交替明暗）
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    poly(
      [
        point(Math.cos(a) * 15.7, Math.sin(a) * 15.7),
        point(Math.cos(a + 0.034) * 15.7, Math.sin(a + 0.034) * 15.7),
        point(Math.cos(a + 0.034) * 16.15, Math.sin(a + 0.034) * 16.15),
        point(Math.cos(a) * 16.15, Math.sin(a) * 16.15)
      ],
      i % 2 ? '#484d31' : '#adac64'
    );
  }

  // 画家算法：按深度（远 → 近）排序后绘制，保证遮挡关系正确
  const sorted = [...rods].sort(
    (a, b) =>
      (a.x * Math.sin(angle) + a.z * Math.cos(angle)) -
      (b.x * Math.sin(angle) + b.z * Math.cos(angle))
  );

  for (const rod of sorted) {
    let amp = 0; // 本根控制棒的振幅（0 ~ 1+）

    if (playing && bins) {
      // 中心 → 边缘映射到 45Hz ~ 14.4kHz 的对数频段
      const hz = 45 * Math.pow(320, rod.r / 15);
      const idx = Math.max(
        1,
        Math.min(bins.length - 2, Math.round(hz / (ctx.sampleRate / 2048)))
      );
      rod.idx = idx;
      // 取相邻三个频点平均，减少抖动
      amp = (bins[idx] + bins[idx - 1] + bins[idx + 1]) / 765;
      amp = Math.pow(amp, 1.7) * gain; // 伽马校正 + 灵敏度
    } else if (!playing && micState !== 'granted') {
      // 未授权 / 检测不到麦克风：保持波浪式待机动画
      amp =
        0.1 +
        0.2 * (0.5 + 0.5 * Math.sin(rod.r * 0.6 - t * 0.0007 + rod.x * 0.1));
    }

    const target = 0.07 + amp * 4.8; // 目标高度
    // 指数平滑趋近目标：smoothing 越大，运动越柔
    rod.h += (target - rod.h) * (1 - Math.pow(0.45 + smoothing * 0.53, dt));

    const { x, z, h } = rod;

    // 顶面四角
    const a = point(x - 0.44, z - 0.44, h);
    const b = point(x + 0.44, z - 0.44, h);
    const c = point(x + 0.44, z + 0.44, h);
    const d = point(x - 0.44, z + 0.44, h);

    // 底面四角
    const a0 = point(x - 0.44, z - 0.44);
    const b0 = point(x + 0.44, z - 0.44);
    const c0 = point(x + 0.44, z + 0.44);
    const d0 = point(x - 0.44, z + 0.44);

    // 四个侧面
    poly([a, a0, b0, b], '#424838', '#111910');
    poly(
      [b, b0, c0, c],
      `rgb(${55 + amp * 30},${62 + amp * 30},${44 + amp * 20})`,
      '#141b12'
    );
    poly([c, c0, d0, d], '#333c2b', '#131b11');
    poly([d, d0, a0, a], '#39432f', '#111910');

    // 顶面基色：少量特殊单元呈现铜色 / 灰绿色
    const base =
      rod.seed > 0.92
        ? [143, 109, 81]
        : rod.seed > 0.85
          ? [97, 118, 104]
          : [
              139 + rod.seed * 29,
              148 + rod.seed * 22,
              119 + rod.seed * 21
            ];

    poly(
      [a, b, c, d],
      `rgb(${base[0] + amp * 43},${base[1] + amp * 40},${base[2] + amp * 24})`,
      '#232d20'
    );

    // 顶面中心的小圆点
    const p = point(x, z, h + 0.01);
    const s = Math.min(w / 45, H / 37) * zoom;
    g.beginPath();
    g.ellipse(p[0], p[1], s * 0.12, s * 0.12 * tilt, 0, 0, Math.PI * 2);
    g.fillStyle = '#404735';
    g.fill();

    // 放大时给部分单元加一点反光像素
    if (s > 13 && rod.seed > 0.6) {
      g.fillStyle = '#c3c7a3';
      g.fillRect(p[0] - s * 0.3, p[1] - s * 0.19, 1, 1);
    }
  }

  /* ---- 右侧频谱条形图 ---- */
  const sw = spec.clientWidth;
  const sh = spec.clientHeight;
  sg.clearRect(0, 0, sw, sh);
  for (let i = 0; i < 48; i++) {
    let v = 0;
    if (playing && bins) {
      // 二次曲线取样，让低频占据更多条
      const bi = Math.min(
        bins.length - 1,
        Math.floor(Math.pow(i / 47, 2) * 700)
      );
      v = bins[bi] / 255;
    }
    sg.fillStyle = i < 12 ? '#d8b975' : i < 30 ? '#c3cf87' : '#95b1a1';
    sg.fillRect(
      (i * sw) / 48,
      sh - Math.max(2, v * sh),
      sw / 48 - 3,
      Math.max(2, v * sh)
    );
  }

  /* ---- 读数刷新（限流，约每 150ms 一次） ---- */
  if (t % 150 < 25) {
    $('level').innerHTML =
      (playing ? Math.round(20 * Math.log10(Math.max(energy, 0.001))) : '—') +
      '<small>dB</small>';

    $('freq').innerHTML =
      (playing && peak > 0
        ? Math.round((peakIndex * ctx.sampleRate) / 2048)
        : '—') + '<small>Hz</small>';

    if (buffer) updatePlayerTime();
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ================= 初始化 / 恢复音频上下文 ================= */
async function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    bins = new Uint8Array(analyser.frequencyBinCount);
    wave = new Float32Array(analyser.fftSize);
    master = ctx.createGain();
    master.gain.value = 0.4;
    analyser.connect(master);
    master.connect(ctx.destination);
  }
  await ctx.resume();
}

/* ================= 停止播放并释放节点 ================= */
function stop() {
  session++;        // 作废进行中的异步任务
  loading = false;

  if (source) {
    source.onended = null;
    try {
      source.stop?.();
    } catch {}
    source.disconnect();
    source = null;
  }

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  playing = false;
  update();
}

/* ================= 播放器工具 ================= */
// 秒 → m:ss
function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  return (
    Math.floor(sec / 60) +
    ':' +
    String(Math.floor(sec % 60)).padStart(2, '0')
  );
}

// 当前播放位置（秒）
function playPosition() {
  if (!buffer) return 0;
  const dur = buffer.duration || 0;
  if (!playing || mode !== 'file' || !ctx) return Math.min(offset, dur);
  return Math.min(offset + (ctx.currentTime - startedAt), dur);
}

// 更新滑块已选部分的填充比例
function setFill(input) {
  const v = +input.value;
  const min = +input.min || 0;
  const max = +input.max || 100;
  input.style.setProperty('--p', ((v - min) / (max - min)) * 100 + '%');
}

// 进度条与时间
function updatePlayerTime() {
  if (!buffer) return;
  const dur = buffer.duration || 0;
  const cur = playPosition();
  if (!seeking) {
    seekEl.value = dur ? (cur / dur) * 1000 : 0;
    setFill(seekEl);
  }
  timeEl.textContent = fmt(cur) + ' / ' + fmt(dur);
}

// 播放器整体状态
function updatePlayer() {
  const has = !!buffer;
  playerEl.hidden = !has;
  if (!has) return;

  trackEl.textContent = fileName || '未命名音频';

  const active = playing && mode === 'file';
  ppBtn.classList.toggle('playing', active);
  ppBtn.setAttribute('aria-label', active ? '暂停' : '播放');

  updatePlayerTime();
}

// 暂停文件播放（保留播放位置）
function pauseFile() {
  if (!playing || mode !== 'file') return;
  offset = playPosition();

  if (source) {
    source.onended = null;
    try {
      source.stop?.();
    } catch {}
    source.disconnect();
    source = null;
  }

  playing = false;
  update();
}
function update() {
  $('mic').classList.toggle('selected', mode === 'mic');

  $('status').textContent = playing
    ? '运行中 · ' + (mode === 'mic' ? '实时输入' : '音频分析')
    : '待机 · ' + (mode === 'mic' ? '麦克风输入' : '已暂停');

  updatePlayer();
}

/* ================= 开始播放 ================= */
async function start() {
  if (loading || playing) return;
  loading = true;
  const attempt = ++session;

  try {
    await audio();
    if (attempt !== session) return;

    if (mode === 'mic') {
      /* ---- 麦克风输入 ---- */
      const id = ++session;
      loading = true;
      $('message').textContent = '等待麦克风授权…';

      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (id !== session) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }

      stream = s;
      micState = 'granted';
      source = ctx.createMediaStreamSource(s);
      source.connect(analyser);
      master.gain.value = 0; // 麦克风不内放，避免啸叫
      $('message').textContent = '正在监听麦克风；停止或切换输入即可关闭。';
    } else if (mode === 'file' && buffer) {
      /* ---- 本地音频文件 ---- */
      master.gain.value = +$('volume').value / 100;
      if (offset >= buffer.duration) offset = 0;

      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      source.onended = () => {
        stop();
        offset = 0;
        update();
      };
      startedAt = ctx.currentTime;
      source.start(0, offset);
      $('message').textContent = '音频仅在本机处理，不会上传。';
    } else {
      // 无可用音源（正常流程不会进入）
      loading = false;
      return;
    }

    playing = true;
    update();
  } catch (e) {
    if (mode === 'mic') micState = 'denied';
    stop();
    $('message').textContent =
      mode === 'mic'
        ? '无法访问麦克风，请检查浏览器权限，或导入音频。'
        : '无法播放此音频，请尝试其他文件。';
  } finally {
    if (attempt === session || !playing) loading = false;
  }
}

/* ================= 事件绑定 ================= */

// 切换为麦克风
$('mic').onclick = () => {
  if (mode === 'file' && playing) offset = playPosition();
  stop();
  mode = 'mic';
  update();
  start();
};

// 导入音频文件
$('upload').onclick = () => $('file').click();

$('file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;

  stop();
  const id = session;
  loading = true;
  $('message').textContent = '正在读取音频…';

  try {
    await audio();
    const decoded = await ctx.decodeAudioData(await f.arrayBuffer());
    if (id !== session) return;

    buffer = decoded;
    mode = 'file';
    offset = 0;
    fileName = f.name || '未命名音频';
    update();
    loading = false;
    $('message').textContent = '已载入音频，点击播放开始。';
  } catch {
    $('message').textContent = '无法读取该文件，请尝试 MP3 或 WAV 音频。';
  } finally {
    loading = false;
    e.target.value = '';
  }
};

/* ================= 滑块：数值即时生效，文字/填充每帧最多更新一次 ================= */
function bindRange(id, outId, apply, format) {
  const input = $(id);
  const out = outId ? $(outId) : null;
  let queued = false;

  const render = () => {
    queued = false;
    const v = +input.value;
    setFill(input);
    if (out) out.textContent = format(v);
  };

  input.oninput = () => {
    apply(+input.value);
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  };

  render(); // 初始化填充与读数
}

// 灵敏度
bindRange(
  'gain',
  'gainval',
  (v) => {
    gain = v;
  },
  (v) => v.toFixed(1) + '×'
);

// 运动平滑度
bindRange(
  'smooth',
  'smoothval',
  (v) => {
    smoothing = v / 100;
  },
  (v) => v + '%'
);

// 播放音量（仅作用于导入的文件）
bindRange(
  'volume',
  null,
  (v) => {
    muteBtn.classList.toggle('muted', v === 0);
    muteBtn.setAttribute('aria-label', v === 0 ? '取消静音' : '静音');
    if (master && mode !== 'mic') {
      master.gain.setTargetAtTime(v / 100, ctx.currentTime, 0.03);
    }
  },
  (v) => v + '%'
);

lastVolume = +$('volume').value || 40;

// 静音 / 恢复
muteBtn.onclick = () => {
  const v = +$('volume').value;
  if (v > 0) {
    lastVolume = v;
    $('volume').value = 0;
  } else {
    $('volume').value = lastVolume || 40;
  }
  $('volume').dispatchEvent(new Event('input'));
};

// 拖动进度：预览时间，松手后跳转
seekEl.oninput = () => {
  if (!buffer) return;
  seeking = true;
  setFill(seekEl);
  timeEl.textContent =
    fmt((+seekEl.value / 1000) * buffer.duration) +
    ' / ' +
    fmt(buffer.duration);
};

seekEl.onchange = () => {
  if (!buffer) {
    seeking = false;
    return;
  }
  seeking = false;

  const target = (+seekEl.value / 1000) * buffer.duration;
  if (mode !== 'file') {
    offset = target;
    return;
  }

  const wasPlaying = playing;
  if (playing) pauseFile();
  offset = Math.min(target, buffer.duration);
  if (wasPlaying) start();
  else updatePlayerTime();
};

// 播放 / 暂停
ppBtn.onclick = async () => {
  if (!buffer) return;

  if (mode === 'file' && playing) {
    pauseFile();
    return;
  }

  stop();
  mode = 'file';
  if (offset >= buffer.duration - 0.05) offset = 0;
  update();
  await start();
};

/* ================= 画布交互：拖动旋转 / 滚轮 & 双指缩放 ================= */
const pointers = new Map(); // 当前按下的指针
let pinch = null;           // 双指缩放基准

canvas.onpointerdown = (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 1) {
    drag = { x: e.clientX, y: e.clientY };
    pinch = null;
  } else if (pointers.size === 2) {
    // 第二根手指按下：进入缩放，暂停旋转
    drag = null;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    pinch = { dist, zoom };
  }
};

canvas.onpointermove = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // 双指：按两指间距比例缩放
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    zoom = Math.max(0.65, Math.min(1.5, pinch.zoom * (dist / pinch.dist)));
    return;
  }

  // 单指 / 鼠标：旋转视角
  if (!drag) return;
  angle += (e.clientX - drag.x) * 0.006;
  tilt = Math.max(0.25, Math.min(0.85, tilt + (e.clientY - drag.y) * 0.002));
  drag = { x: e.clientX, y: e.clientY };
};

function endPointer(e) {
  pointers.delete(e.pointerId);

  if (pointers.size === 1) {
    // 从双指回到单指：以剩余手指为起点重新开始旋转
    const p = [...pointers.values()][0];
    drag = { x: p.x, y: p.y };
    pinch = null;
  } else if (pointers.size === 0) {
    drag = null;
    pinch = null;
  } else {
    // 仍有多指：重置缩放基准
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    pinch = { dist, zoom };
  }
}

canvas.onpointerup = endPointer;
canvas.onpointercancel = endPointer;

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoom = Math.max(0.65, Math.min(1.5, zoom - e.deltaY * 0.001));
  },
  { passive: false }
);

// 重置视角
$('reset').onclick = () => {
  angle = -0.32;
  tilt = 0.58;
  zoom = 1;
};

// 全屏切换
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    $('message').textContent = '当前浏览器不支持全屏。';
  }
};

document.addEventListener('fullscreenchange', () => {
  $('fullscreen').textContent = document.fullscreenElement
    ? '退出全屏 ↙'
    : '全屏 ↗';

  // 等布局稳定后重新计算画布像素尺寸
  requestAnimationFrame(size);
});

// 页面卸载时释放音频资源
window.addEventListener('pagehide', stop);

// 启动时读取已有权限：未授权/被拒绝 → 波浪待机；已授权 → 平整待机
if (navigator.permissions?.query) {
  try {
    navigator.permissions
      .query({ name: 'microphone' })
      .then((status) => {
        const apply = () => {
          micState =
            status.state === 'granted'
              ? 'granted'
              : status.state === 'denied'
                ? 'denied'
                : 'idle';
        };
        apply();
        status.onchange = apply;
      })
      .catch(() => {});
  } catch {}
}

update();

/* ================= 可选：向宿主环境注册工具 ================= */
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(
      document.modelContext.registerTool({
        name: 'configure_reactor_response',
        description:
          'Adjust the reactor audio visualizer sensitivity and motion smoothing.',
        inputSchema: {
          type: 'object',
          properties: {
            sensitivity: { type: 'number', minimum: 0.3, maximum: 3 },
            smoothing: { type: 'number', minimum: 0, maximum: 95 }
          },
          required: ['sensitivity', 'smoothing'],
          additionalProperties: false
        },
        execute(input) {
          // 参数校验
          if (
            !input ||
            !Number.isFinite(input.sensitivity) ||
            input.sensitivity < 0.3 ||
            input.sensitivity > 3 ||
            !Number.isFinite(input.smoothing) ||
            input.smoothing < 0 ||
            input.smoothing > 95
          ) {
            throw Error('Invalid response settings');
          }

          // 写入滑块并触发 input 事件，复用现有绑定
          $('gain').value = input.sensitivity;
          $('gain').dispatchEvent(new Event('input'));
          $('smooth').value = input.smoothing;
          $('smooth').dispatchEvent(new Event('input'));

          return { sensitivity: gain, smoothing: smoothing * 100 };
        }
      })
    ).catch(() => {});
  } catch {}
}
