// GARGANTUA — 启动编排:渲染循环 / 相机模式 / 自动化 API / 错误恢复
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { Engine, iscoRadius, horizonRadius } from './engine.js';
import { initState, persist, DEFAULTS, PARAM_META, PARAM_COUNT, QUALITIES, DEBUG_VIEWS, FPS_CAPS, LE_FRAMES, EXPORT_SIZES } from './state.js';
import { UI } from './ui.js';
import { Cinematic, applyPreset, PRESETS } from './cinematic.js';
import { AmbientAudio } from './audio.js';
import { Capture } from './capture.js';
import { Flight } from './flight.js';
import { GeodesicLab } from './geodesic.js';
import { Annotations } from './annotations.js';
import { Achievements } from './achievements.js';
import { Guide } from './guide.js';
import { Tour } from './tour.js';
import { FILM_LOOKS, buildWatermark } from './photomode.js';
import { buildShareURL, decodeShare } from './sharecode.js';

const T0 = performance.now();
const canvas = document.getElementById('gl');
const state = initState();
const IS_MOBILE = matchMedia('(pointer: coarse)').matches;
let exporting = false; // 4K/8K 离屏导出期间冻结主循环与参数修改,避免管线/累积缓冲被踩踏
let diskInnerAuto = true; // 自旋变化时自动把盘内半径跟到 ISCO,用户手动改过即停(初始化段也会用到)

// 页面内错误收集(供自动化验收:window.__GARGANTUA_ERRORS__ 应为空;封顶 200 防长会话泄漏)
window.__GARGANTUA_ERRORS__ = [];
{
  const pushErr = (s) => {
    try {
      if (window.__GARGANTUA_ERRORS__.length < 200) window.__GARGANTUA_ERRORS__.push(s);
    } catch { /* ignore */ }
  };
  const origError = console.error.bind(console);
  console.error = (...a) => {
    try {
      pushErr('console.error: ' + a.map(x => String(x && x.message ? x.message : x)).join(' ').slice(0, 500));
    } catch { /* ignore */ }
    origError(...a);
  };
  window.addEventListener('error', e => pushErr('window.error: ' + (e.message || 'unknown')));
  window.addEventListener('unhandledrejection', e =>
    pushErr('unhandledrejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)).slice(0, 500)));
}

// 全新会话:移动端默认低档(手机 GPU 跑体积盘全效到不了 60fps;有本地存档则尊重存档)
if (!localStorage.getItem('gargantua53f.v1') && IS_MOBILE && !new URLSearchParams(location.search).has('quality')) {
  state.quality = 'low';
}

// ---------------- 相机与控制 ----------------
const camera = new THREE.PerspectiveCamera(state.params.fov, innerWidth / Math.max(innerHeight, 1), 0.1, 600);
{
  // ?preset= 或默认远景全景;FOV 优先级:显式 ?fov= > 显式 ?preset= 自带 > 存档
  // (注意:普通重载绝不能覆盖存档里的 FOV)
  const q0 = new URLSearchParams(location.search);
  const fovExplicit = q0.has('fov') || (q0.get('p') || '').split(',').some(p => p.startsWith('fov='));
  const presetExplicit = state.preset !== null;
  applyPreset(state.preset ?? 0, camera, null);
  if (presetExplicit && !fovExplicit) {
    state.params.fov = +camera.fov.toFixed(1); // 显式 ?preset= 时跟随预设自带 FOV(与运行时行为一致)
  }
  camera.fov = state.params.fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3.4;   // 不得进入视界以内
controls.maxDistance = 90;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.9;

const cine = new Cinematic(camera, controls);
const audio = new AmbientAudio();
let engine = null;
let ui = null;

// ---------------- 互动模块(飞行 / 弹弓 / 标注 / 成就 / 导览) ----------------
const flight = new Flight(camera, canvas, { onWarn: (m) => ui?.toast(m) });
const geolab = new GeodesicLab(camera);
const annotations = new Annotations();
const ach = new Achievements((def) => {
  ui?.toast(`🏆 成就解锁 · ${def.name}`);
  ui?.renderAch(ach);
});
const tour = new Tour(camera, {
  onParam: (k, v) => setParam(k, v),
  onLongExposure: (on, frames) => {
    if (frames != null) setExposureFrames(frames, { user: true }); // 第 7 站只关不设帧数,不能把 undefined 写进存档
    setLongExposure(on);
  },
  onStation: (i, st) => ui?.showTourStation(i, st, tour),
  onStop: () => { syncFovFromCamera(); ui?.hideTour(); }, // 导览直接改了 camera.fov,交还给参数/滑块
  onComplete: () => ach.track('tour'),
});

// ---------------- 致命错误覆盖层 ----------------
function fatal(msg) {
  console.error('[GARGANTUA] FATAL:', msg);
  try {
    ui.showOverlay('GARGANTUA 遇到错误\n' + msg, { error: true, spinner: false });
  } catch { /* UI 未就绪 */ }
}

// ---------------- UI ----------------
const guide = new Guide(); // 功能引导(面板「引导」按钮 / 首访自动弹;见 onFirstFrame)
ui = new UI({
  onParam: (k, v) => setParam(k, v),
  onQuality: (q) => setQuality(q),
  onFpsCap: (v) => setFpsCap(v),
  onExportSize: (v) => setExportSize(v),
  onLongExposure: (on) => setLongExposure(on),
  onExposureFrames: (n, opts) => setExposureFrames(n, opts),
  onPreset: (i) => gotoPreset(i),
  onCine: () => setMode(state.mode === 'cine' ? 'orbit' : 'cine'),
  onMode: (m) => setMode(m),
  onFlyToggle: () => setMode(state.mode === 'fly' ? 'orbit' : 'fly'),
  onMusic: () => toggleMusic(),
  onScreenshot: () => doScreenshot(),
  onResetParams: () => resetParams(),
  onResetView: () => gotoPreset(0, true),
  onReseed: () => reseed(),
  onView: (v) => setView(v),
  onVolDisk: (on) => setVolDisk(on),
  onFlyBoundary: (v, opts) => setFlyBoundary(v, opts),
  onAnnotations: (on) => setAnnotations(on),
  onEHT: (on) => setEHT(on),
  onFilmGrade: (on) => setFilmGrade(on),
  onRefColor: (on) => setRefColor(on),
  onWatermark: (on) => setWatermark(on),
  onTour: (on) => setTour(on),
  onTourNext: () => tour.next(),
  onTourPrev: () => tour.prev(),
  onPhoto: (on) => setPhoto(on),
  onGeoArm: (on) => setGeoArmed(on),
  onFilmLook: (id) => applyFilmLook(id),
  onGuide: (id) => ui.setGuideUI(id),
  onStartGuide: () => guide.start(),
  onShareCopy: () => copyShareLink(),
  onShareImport: () => importShareCode(),
});

// 用户拖拽 → 退出电影循环进入自由轨道(pointer 与鼠标事件都听,覆盖合成输入)
const exitCineOnDrag = () => {
  if (tour.active) tour.interrupt();
  if (state.mode === 'cine') setMode('orbit');
};
canvas.addEventListener('pointerdown', exitCineOnDrag);
canvas.addEventListener('mousedown', exitCineOnDrag);
canvas.addEventListener('touchstart', exitCineOnDrag, { passive: true });

// 光子弹弓:待发状态下点击画面 → 从该像素发射光子扇
canvas.addEventListener('click', (e) => {
  if (!state.geoArmed || exporting) return;
  const rect = canvas.getBoundingClientRect();
  let ndcX = 0, ndcY = 0;
  if (!flight.locked) {
    ndcX = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    ndcY = -(((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
  } // pointer lock 下没有像素坐标 → 打屏幕中心
  camera.updateMatrixWorld();
  const r = geolab.launchFromCamera(ndcX, ndcY, {
    spin: state.params.spin, rs: 2, diskOut: state.params.diskOuter,
    lensing: state.params.lensing,
  });
  ach.track('fan');
  ui.toast(`光子扇 ×${r.count} · 捕获 ${r.statuses.captured} / 逃逸 ${r.statuses.escaped}` +
    (r.statuses.maxed ? ` / 绕行 ${r.statuses.maxed}` : ''));
});

// ---------------- 引擎初始化(含降级) ----------------
try {
  engine = new Engine(canvas);
  engine.renderer.debug.checkShaderErrors = true;
  engine.renderer.debug.onShaderError = () => {
    fatal('着色器编译失败。请点击「安全模式」以低配管线重试,或更新显卡驱动。');
  };
} catch (e) {
  fatal('无法创建 WebGL 2 上下文:' + (e && e.message) + '\n请使用支持 WebGL 2 的现代浏览器(Chrome / Edge / Firefox / Safari 15+)。');
  throw e;
}

engine.setQuality(state.quality);
for (const [k, v] of Object.entries(state.params)) engine.setParam(k, v);
engine.setSeed(state.seed);
engine.setLongExposure(state.longExposure, state.exposureFrames);
engine.setVolDisk(state.volDisk);
engine.setEHT(state.eht);
engine.setFilmGrade(state.filmGrade);
engine.setRefColor(state.refColor);
annotations.visible = state.annotations;
// URL/存档带自旋时,初始化把盘内缘抬到物理下限 ISCO —— 只抬不压:
// 用户手动调大的值与显式 URL 参数(diskInner=)不允许被重置回 ISCO;
// 但显式值低于 ISCO 时仍强制物理下限(与 setParam 的运行时约束一致)
if (state.params.spin > 0.001) {
  const isco = +iscoRadius(state.params.spin).toFixed(2);
  const uq = new URLSearchParams(location.search);
  const diskInnerExplicit = uq.has('diskInner') || (uq.get('p') || '').split(',').some(p => p.startsWith('diskInner='));
  if (state.params.diskInner < isco - 0.01) {
    let target = isco;
    if (diskInnerAuto && !diskInnerExplicit) {
      // 未显式给内半径:跟随 ISCO(含外径比例与 9.0 上限)
      target = +Math.min(Math.max(isco, 2.0), Math.min(state.params.diskOuter * 0.7, 9.0)).toFixed(2);
    }
    state.params.diskInner = target;
    engine.setParam('diskInner', target);
  }
}

// ---------------- 交互回调 ----------------
function clampParam(key, v) {
  const m = PARAM_META.find(x => x.key === key);
  if (!m) return v;
  return Math.min(m.max, Math.max(m.min, v));
}

// 退出电影循环时把镜头当前的 FOV 交还给参数滑块,避免滑块显示与画面不一致
function syncFovFromCamera(doPersist = true) {
  const f = +camera.fov.toFixed(1);
  state.params.fov = f;
  ui.setParamUI('fov', f);
  if (doPersist) persist(state);
}

function setParam(key, v, opts = {}) {
  if (exporting) return;
  if (!(key in DEFAULTS)) return;
  v = clampParam(key, v);
  state.params[key] = v;
  if (key === 'diskInner') {
    // 物理约束:盘内缘不得进入 ISCO 以内(那里没有稳定圆轨道)
    v = Math.max(v, +iscoRadius(state.params.spin).toFixed(2));
    state.params.diskInner = v;
  }
  if (key === 'fov') {
    camera.fov = v;
    camera.updateProjectionMatrix();
    // 电影循环每帧都会写 FOV,手动调节必须切到自由轨道才有效;
    // 但参数重置(Shift+R)不该顺带打断循环——循环下一帧会接管 FOV
    if (state.mode === 'cine' && !opts.fromReset) setMode('orbit');
  } else {
    engine.setParam(key, v);
  }
  if (key === 'diskInner' && !opts.fromAuto) diskInnerAuto = false;
  if (key === 'spin') {
    ach.track('spin', v);
    // 高自旋 ISCO 内移:跟随自旋把盘内缘推到物理正确的位置(除非用户手动定过)
    if (diskInnerAuto) {
      const isco = iscoRadius(v);
      const target = Math.min(Math.max(isco, 2.0), Math.min(state.params.diskOuter * 0.7, 9.0));
      if (Math.abs(target - state.params.diskInner) > 0.05) setParam('diskInner', +target.toFixed(2), { fromAuto: true });
    }
    // 手动定过内半径时,自旋变大也可能让内缘落进 ISCO
    const iscoNow = iscoRadius(v);
    if (state.params.diskInner < iscoNow - 0.01) setParam('diskInner', +iscoNow.toFixed(2), { fromAuto: true });
  }
  if (!opts.fromAuto && !opts.fromTour) ach.track('param');
  ui.setParamUI(key, v);
  persist(state);
}

function setQuality(q) {
  if (exporting) return;
  if (!QUALITIES[q] || q === 'safemode') return;
  state.quality = q;
  engine.setQuality(q);
  ui.setQualityUI(q);
  persist(state);
  ui.toast(`画质 · ${QUALITIES[q].label}`);
}

function setMode(mode, opts = {}) {
  if (exporting) return; // 导出期间冻结相机模式切换
  const prev = state.mode;
  const leavingCine = prev === 'cine' && mode !== 'cine';
  // 导览进行中用户显式切换模式 → 结束导览,避免两套相机驱动打架
  if (tour.active && mode !== 'orbit' && !opts.fromTour) tour.stop();
  // 飞行模式接管/交还相机
  if (mode === 'fly' && prev !== 'fly') {
    controls.enabled = false;
    flight.enter();
  }
  if (prev === 'fly' && mode !== 'fly') {
    flight.leave();
    controls.enabled = true;
    controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    controls.update();
  }
  state.mode = mode;
  state.cine = mode === 'cine';
  ui.setModeUI(mode);
  if (leavingCine) {
    syncFovFromCamera(false);
    persist(state);
  }
  if (opts.silent) return; // 预设切换等场景避免与后续 toast 互相覆盖
  if (mode === 'cine') ui.toast('电影镜头循环 · 拖拽画面接管相机');
  else if (mode === 'fly') ui.toast('自由飞行 · WASD 移动 · R/F 升降 · 滚轮调速 · 点击画面锁定环视');
  else ui.toast('自由轨道 · Space 恢复循环 · G 飞行');
}

function setFpsCap(v) {
  state.fpsCap = FPS_CAPS.includes(v) ? v : 0;
  ui.setFpsCapUI(state.fpsCap);
  persist(state);
  ui.toast(state.fpsCap > 0 ? `帧率限制 · ${state.fpsCap} FPS` : '帧率限制 · 不限');
}

function setExportSize(id) {
  if (exporting) return;
  if (!EXPORT_SIZES.some(s => s.id === id)) return;
  state.exportSize = id;
  ui.setExportSizeUI(id);
  persist(state);
  const s = EXPORT_SIZES.find(x => x.id === id);
  ui.toast(id === 'screen' ? '导出分辨率 · 屏幕' : `导出分辨率 · ${s.label} ${s.w}×${s.h}`);
}

function setLongExposure(on) {
  if (exporting) return;
  state.longExposure = !!on;
  engine.setLongExposure(state.longExposure, state.exposureFrames);
  ui.setLongExposureUI(state.longExposure);
  persist(state);
  ui.toast(state.longExposure ? `长曝光 · 开(≈${state.exposureFrames} 帧累积)` : '长曝光 · 关');
}

// opts.user: 来自面板交互(长曝光关闭时自动开启);opts.commit: 松手提交,清空旧累积让变化立即可见
function setExposureFrames(n, opts = {}) {
  if (exporting) return;
  state.exposureFrames = Math.min(LE_FRAMES.max, Math.max(LE_FRAMES.min, Math.round(n) || LE_FRAMES.def));
  engine.setAccumFrames(state.exposureFrames);
  ui.setExposureFramesUI(state.exposureFrames);
  if (opts.user && !state.longExposure) {
    setLongExposure(true);
  } else if (opts.commit && state.longExposure) {
    engine.clearAccum();
    persist(state);
    ui.toast(`曝光帧数 · ${state.exposureFrames} 帧`);
  } else {
    persist(state);
  }
}

function gotoPreset(i, silent) {
  applyPreset(i, camera, controls);
  if (state.mode === 'cine') setMode('orbit', { silent: true }); // 只发预设自己的 toast,避免双 toast 互相覆盖
  if (state.mode === 'fly') setMode('orbit', { silent: true }); // 预设接管相机
  syncFovFromCamera();
  ach.track('preset', i);
  if (!silent) ui.toast(`视角预设 ${i + 1} · ${PRESETS[i].name} · FOV ${camera.fov.toFixed(0)}°`);
}

function toggleMusic() {
  // enable 是异步的(解码/自动播放策略):await 结果再更新 UI,失败不会"假开"
  audio.toggle().then(on => {
    state.music = on;
    ui.setMusicUI(on);
    ui.toast(on ? '氛围音乐 · 开' : '氛围音乐 · 关');
  });
}

let lastExportUrl = null;

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (lastExportUrl) setTimeout(() => URL.revokeObjectURL(lastExportUrl), 30000);
  lastExportUrl = url;
}

// 截图:屏幕模式走画布直接读取;4K/8K 走离屏原生重渲染(每像素独立积分,不是放大插值)
async function exportImage(name, sizeId = state.exportSize) {
  const size = EXPORT_SIZES.find(s => s.id === sizeId) || EXPORT_SIZES[0];
  if (size.id === 'screen') {
    ach.track('shot');
    const wm = state.watermark ? buildWatermark(state.params, { size: `${engine.W}×${engine.H}` }) : null;
    const url = capture.screenshot(name, { watermark: wm });
    ui.toast('截图已保存 PNG');
    console.log(`[GARGANTUA] screenshot saved (${(url.length / 1024).toFixed(0)} KB base64)`);
    return { mode: 'screen', width: engine.W, height: engine.H, dataUrl: url };
  }
  if (exporting) {
    ui.toast('正在导出,请稍候…');
    return { busy: true };
  }
  exporting = true;
  ui.toast(`正在导出 ${size.label} ${size.w}×${size.h}…`);
  console.log(`[GARGANTUA] export start: ${size.label} ${size.w}×${size.h} · LE=${state.longExposure}`);
  try {
    // 与 renderOne 相同的相机推进:确保预设/电影循环/阻尼的最新姿态进入导出
    if (state.mode === 'cine') cine.update(simTime);
    else controls.update();
    camera.updateMatrixWorld();
    engine.updateCamera(camera);
    const res = await engine.renderExport({
      width: size.w,
      height: size.h,
      timeSec: simTime,
      debugView: state.view,
      frameDt: state.freeze ? 0 : 1 / 60,
      watermark: state.watermark
        ? buildWatermark(state.params, {
            size: `${size.w}×${size.h}`,
            frames: state.longExposure ? state.exposureFrames : 0,
          })
        : null,
      onProgress: (i, n) => {
        if (n > 1 && (i === n || i % 8 === 0)) ui.toast(`正在导出 ${size.label} · ${i}/${n} 帧`);
      },
    });
    const fname = name || `gargantua-${size.id}-${Date.now()}.png`;
    ach.track('shot');
    downloadBlob(res.blob, fname);
    // 供自动化验证:不把大图塞进 data URL,保留 Blob 与尺寸元数据
    window.__LAST_EXPORT__ = { blob: res.blob, width: res.width, height: res.height, frames: res.frames, ms: res.ms, name: fname };
    ui.toast(`已导出 ${size.label} PNG · ${res.width}×${res.height} · ${(res.ms / 1000).toFixed(1)}s`);
    console.log(`[GARGANTUA] export done: ${fname} ${res.width}×${res.height} · ` +
      `${(res.blob.size / 1048576).toFixed(1)} MB · ${res.frames} 帧 · ${res.ms.toFixed(0)} ms`);
    return {
      mode: size.id, width: res.width, height: res.height, bytes: res.blob.size,
      frames: res.frames, ms: +res.ms.toFixed(1), name: fname, url: lastExportUrl,
    };
  } catch (e) {
    console.error('[GARGANTUA] export failed:', e);
    ui.toast('导出失败:' + (e && e.message ? e.message : e));
    return { error: e && e.message ? e.message : String(e) };
  } finally {
    exporting = false;
    last = performance.now();
    lastTick = last;
    frameCredit = 0;
  }
}

function doScreenshot(name) {
  return exportImage(name);
}

function resetParams() {
  for (const k of Object.keys(DEFAULTS)) setParam(k, DEFAULTS[k], { fromReset: true });
  ui.toast('参数已重置为默认');
}

function reseed() {
  state.seed = (Math.random() * 1000000) | 0;
  engine.setSeed(state.seed);
  persist(state);
  ui.toast(`星空种子 ${state.seed}`);
}

function setView(v) {
  state.view = Math.min(9, Math.max(0, v | 0));
  ach.track('view', state.view);
  ui.viewToast(state.view);
}

// ---------------- 性能/画面开关 ----------------
function setVolDisk(on) {
  if (exporting) return;
  state.volDisk = !!on;
  engine.setVolDisk(state.volDisk);
  ui.setToggleUI('volDisk', state.volDisk);
  persist(state);
  ui.toast(state.volDisk ? '体积吸积盘 · 开(盘区积分加密,帧耗上升)' : '体积吸积盘 · 关');
}

function setAnnotations(on) {
  if (exporting) return;
  state.annotations = !!on;
  annotations.visible = state.annotations;
  ui.setToggleUI('annotations', state.annotations);
  persist(state);
  ui.toast(state.annotations ? '物理标注 · 开' : '物理标注 · 关');
}

function setEHT(on) {
  if (exporting) return;
  state.eht = !!on;
  engine.setEHT(state.eht);
  ui.setToggleUI('eht', state.eht);
  persist(state);
  ui.toast(state.eht ? 'EHT 视角 · 模拟事件视界望远镜的有限分辨率(参考 M87*)' : 'EHT 视角 · 关');
}

function setFilmGrade(on) {
  if (exporting) return;
  state.filmGrade = !!on;
  engine.setFilmGrade(state.filmGrade);
  ui.setToggleUI('filmGrade', state.filmGrade);
  persist(state);
  ui.toast(state.filmGrade ? '电影色调 · 开(胶片曲线 + 盘面双色带)' : '电影色调 · 关(纯 ACES)');
}

function setRefColor(on) {
  if (exporting) return;
  state.refColor = !!on;
  engine.setRefColor(state.refColor);
  ui.setToggleUI('refColor', state.refColor);
  persist(state);
  ui.toast(state.refColor ? '参考配色 · 开(内缘白热 + 外缘橙褐)' : '参考配色 · 关(物理黑体 + 多普勒)');
}

function setWatermark(on) {
  if (exporting) return;
  state.watermark = !!on;
  ui.setToggleUI('watermark', state.watermark);
  persist(state);
  ui.toast(state.watermark ? '导出水印 · 开(截图左下角附参数摘要)' : '导出水印 · 关');
}

function setGeoArmed(on) {
  state.geoArmed = !!on;
  ui.setToggleUI('geoArmed', state.geoArmed);
  if (on) {
    if (state.mode === 'cine') setMode('orbit', { silent: true });
    ui.toast('光子弹弓 · 已就绪 — 点击画面发射光子扇');
  } else {
    geolab.clear();
    ui.toast('光子弹弓 · 收起');
  }
}

function setTour(on) {
  if (exporting) return;
  if (on) {
    if (state.mode !== 'orbit') setMode('orbit', { silent: true });
    tour.start(0);
    ui.toast('导览开始 · T 或「退出」结束');
  } else {
    tour.stop();
  }
}

function setPhoto(on) {
  state.photo = !!on;
  ui.setPhotoUI(state.photo, state);
  if (on) ui.toast('摄影模式 · 构图线与胶片风格在顶部工具条');
}

function applyFilmLook(id) {
  const look = FILM_LOOKS.find(l => l.id === id);
  if (!look) return;
  for (const [k, v] of Object.entries(look.params)) setParam(k, v);
  ui.setLookUI(id);
  ui.toast(`胶片风格 · ${look.label}`);
}

// ---------------- 分享码 ----------------
function copyShareLink() {
  const url = buildShareURL(state, camera);
  const done = () => ui.toast('分享链接已复制 · 发给朋友即可打开同款黑洞');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
  } else fallbackCopy(url, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { ui.toast('复制失败,链接已打印到控制台'); console.log('[GARGANTUA] share:', text); }
  ta.remove();
}

function importShareCode(str) {
  const s = (str !== undefined ? str : window.prompt('粘贴分享码(?s= 后面那串)或完整链接:') || '').trim();
  if (!s) return;
  applyShareCode(s);
}

function applyShareCode(s) {
  const m = s.match(/(?:\?|&)s=([A-Za-z0-9\-_]+)/);
  const code = m ? m[1] : s;
  const obj = decodeShare(code);
  if (!obj) { ui.toast('分享码无效'); return; }
  if (obj.p) for (const [k, v] of Object.entries(obj.p)) setParam(k, v);
  if (obj.t) {
    const T = obj.t;
    if (T.vd !== undefined) setVolDisk(!!T.vd);
    if (T.an !== undefined) setAnnotations(!!T.an);
    if (T.eht !== undefined) setEHT(!!T.eht);
    if (T.fg !== undefined) setFilmGrade(!!T.fg);
    if (T.rc !== undefined) setRefColor(!!T.rc);
    if (T.wm !== undefined) setWatermark(!!T.wm);
    if (T.ga !== undefined) setGeoArmed(!!T.ga);
  }
  if (obj.q && QUALITIES[obj.q]) setQuality(obj.q);
  if (typeof obj.sd === 'number') { state.seed = obj.sd | 0; engine.setSeed(state.seed); }
  setLongExposure(!!obj.le);
  if (typeof obj.lf === 'number') setExposureFrames(obj.lf);
  if (Array.isArray(obj.c) && obj.c.length === 4 && obj.c.every(v => typeof v === 'number' && isFinite(v))) {
    setMode('orbit', { silent: true });
    camera.position.set(obj.c[0], obj.c[1], obj.c[2]);
    camera.fov = Math.min(110, Math.max(25, obj.c[3]));
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    syncFovFromCamera(false);
  }
  ui.toast('已载入分享的场景');
}

// URL 带来的初始 UI 状态
ui.setModeUI(state.mode);
ui.setQualityUI(state.quality);
ui.setFpsCapUI(state.fpsCap);
ui.setExportSizeUI(state.exportSize);
ui.setLongExposureUI(state.longExposure);
ui.setExposureFramesUI(state.exposureFrames);
ui.setParamsUI(state.params);
ui.setToggleUI('volDisk', state.volDisk);
ui.setFlyBoundaryUI(state.flyBoundary);
ui.setToggleUI('annotations', state.annotations);
ui.setToggleUI('eht', state.eht);
ui.setToggleUI('filmGrade', state.filmGrade);
ui.setToggleUI('refColor', state.refColor);
ui.setToggleUI('watermark', state.watermark);
ui.setToggleUI('geoArmed', state.geoArmed);
ui.renderAch(ach);
if (!state.hud) ui.toggleHud(false);
if (state.panel) ui.togglePanel(true);

// 分享码场景(?s=)与导览场景(?tour=1)
if (state.share) applyShareCode(state.share);
if (state.tour) setTour(true);
// ?mode=fly 直达:飞行控制必须在初始化时接管相机,否则相机无人驱动
if (state.mode === 'fly') {
  controls.enabled = false;
  flight.enter();
  ui.toast('自由飞行 · WASD 移动 · R/F 升降 · 滚轮调速');
}

// 音乐:自动尝试 + 首次手势兜底(浏览器自动播放策略)
if (state.music) {
  audio.enable().then(ok => ui.setMusicUI(ok));
  const kick = () => {
    if (!audio.enabled) audio.enable().then(ok => ui.setMusicUI(ok));
    window.removeEventListener('pointerdown', kick);
    window.removeEventListener('keydown', kick);
  };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);
}

// ---------------- 截图自动化 ----------------
const capture = new Capture(canvas);
capture.renderOne = renderOne;

// ---------------- 主循环 ----------------
let frame = 0;
let simTime = state.t0 ?? 0;
let loopDt = 1 / 60; // 主循环最近一帧 dt(飞行模式积分用)
let last = performance.now();      // 上一"渲染帧"时间(dt 基准)
let lastTick = last;               // 上一 tick 时间(限流信用基准)
let frameCredit = 0;               // 令牌桶信用(ms)
let lastRafNow = 0;                // 上一 tick 时间戳(rAF 间隔信号)
let ivEma = 0;                     // rAF 间隔 EMA
let vsyncMin = 16.7;               // vsync 周期估计(运行中的最小间隔,缓慢漂移上探)
let fps = 60;
let costEma = 8;
let lastCost = 8;                   // 上一帧 CPU 提交耗时(adapt 在渲染前用)
const frameOpts = { jitter: false }; // 复用的渲染参数对象(主循环每帧零分配)
let rafId = 0;
let hiddenTimer = 0;
let running = true;
const STILL_SETTLE = 36; // still 模式:先渲染 36 帧让阻尼收敛再停

// 隐藏标签页中 rAF 被挂起 → 降级为 setTimeout 驱动。仅自动化场景启用
// (?snap= 截图流 / webdriver):普通用户切后台时循环完全停止,不烧 GPU。
function scheduleLoop() {
  if (!running) return;
  if (document.hidden) {
    if (state.snapName || navigator.webdriver) hiddenTimer = setTimeout(loop, 16);
  } else rafId = requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
  } else if (running) {
    clearTimeout(hiddenTimer);
    // 视口尺寸随可见性变化(嵌入式浏览器窗格),重新适配
    camera.aspect = innerWidth / Math.max(innerHeight, 1);
    camera.updateProjectionMatrix();
    engine.resize();
    scheduleLoop();
  }
});

function stopLoop() {
  running = false;
  cancelAnimationFrame(rafId);
  clearTimeout(hiddenTimer);
}

// 飞行安全边界:用户可调(2.01M 极限贴界,时间膨胀 ~14×);永不低于视界
function flyMinR() {
  return Math.max(state.flyBoundary, horizonRadius(state.params.spin) * 1.005);
}

function setFlyBoundary(v, opts = {}) {
  if (exporting) return;
  v = Math.min(3.0, Math.max(2.01, +v || 2.7));
  state.flyBoundary = v;
  ui.setFlyBoundaryUI(v);
  persist(state);
  if (opts.commit !== false) {
    const dil = 1 / Math.sqrt(Math.max(1e-6, 1 - 2 / v));
    ui.toast(`安全边界 · ${v.toFixed(2)} M · 悬停 1h ≈ 地球 ${dil >= 100 ? dil.toFixed(0) : dil.toFixed(2)}h`);
  }
}

function renderOne() {
  if (exporting) return;
  // 视口在初始化瞬间可能为 0(嵌入式窗格),aspect 失效则用当前窗口修正
  if (!(camera.aspect > 0.01) || !isFinite(camera.aspect)) {
    camera.aspect = innerWidth / Math.max(innerHeight, 1) || 1;
    camera.updateProjectionMatrix();
  }
  if (!tour.active) {
    if (state.mode === 'cine') cine.update(simTime);
    else if (state.mode === 'fly') flight.update(loopDt, flyMinR());
    else controls.update();
  }
  camera.updateMatrixWorld();
  engine.updateCamera(camera);
  // 长曝光时启用亚像素抖动:帧累积顺带完成时域超采样(冻结模式保持确定性)
  frameOpts.jitter = state.longExposure && !state.freeze;
  engine.renderFrame(simTime, state.view, frameOpts);
  // 光子轨迹叠加(合成 pass 已输出到画布,直接叠加渲染,不清屏)
  if (geolab.enabled) {
    const r = engine.renderer;
    r.autoClear = false;
    geolab.renderWith(r, camera);
    r.autoClear = true;
  }
}

function loop(now = performance.now()) {
  scheduleLoop();
  if (exporting) return;
  checkCanvasSize();

  // 帧率限制(令牌桶):平均速率 = min(刷新率, 上限);跳过帧不推进时间,动画速度不变
  if (state.fpsCap > 0) {
    const iv = 1000 / state.fpsCap;
    frameCredit = Math.min(frameCredit + (now - lastTick), 2 * iv);
    if (frameCredit < iv) return; // 本 tick 跳过渲染
    frameCredit -= iv;
  }
  lastTick = now;

  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
  last = now;
  loopDt = dt;
  if (!state.freeze && !state.still) simTime += dt;

  if (tour.active) tour.update(dt);
  ach.tick(dt, {
    r: camera.position.length(), mode: state.mode,
    le: state.longExposure, leFrames: state.exposureFrames, fly: state.mode === 'fly',
  });
  if (annotations.visible && frame % 2 === 0) {
    annotations.update(camera, {
      spin: state.params.spin,
      diskIn: state.params.diskInner, diskOut: state.params.diskOuter,
    });
  }

  // rAF 间隔信号:GPU 满载表现为掉帧(间隔超出 vsync 周期),CPU cost 测不到这部分
  const iv = now - lastRafNow;
  lastRafNow = now;
  if (iv > 1 && iv < 1000) {
    ivEma = ivEma === 0 ? iv : ivEma * 0.9 + iv * 0.1;
    // vsync 基线封顶 8.5ms:GPU 满载时所有帧都超时,ratchet 会一路追到 iv、把掉帧信号
    // (ivEma−vsyncMin) 归零;封顶后 60/120/165Hz 屏幕的 GPU 超支都能被正确看到
    vsyncMin = Math.min(8.5, Math.max(4, vsyncMin * 1.02), iv);
  }
  // 自适应分辨率必须在渲染**之前**:resize 会清空画布,若渲染后才改尺寸,合成器会在下一帧
  // 绘制前采样到空画布 → 用户看到黑屏闪烁。先 adapt 再 renderOne,同帧立即以新尺寸重绘。
  // (有限流时锁定原生分辨率;长曝光时不动分辨率——resize 会清空累积缓冲导致画面跳变)
  if (state.fpsCap === 0 && !state.longExposure && !document.hidden) engine.adapt(lastCost, ivEma, vsyncMin);

  const t0 = performance.now();
  renderOne();
  lastCost = performance.now() - t0;
  costEma = costEma * 0.92 + lastCost * 0.08;
  fps = fps * 0.93 + (1 / Math.max(dt, 1e-4)) * 0.07;
  frame++;

  if (frame === 1) onFirstFrame();
  if (frame % 10 === 0) {
    ui.updateStats({
      fps, ms: costEma, w: engine.W, h: engine.H,
      steps: QUALITIES[state.quality].steps,
      quality: state.quality, mode: state.mode, view: state.view, le: state.longExposure,
      leFrames: state.exposureFrames,
    });
  }
  if (frame % 15 === 0) {
    // 电影循环里 FOV 每帧都在呼吸:让面板滑块跟着动(只更新 UI 显示,不写 state.params)。
    // 动画中的 FOV 不能进存档——否则用户改别的参数时会把"电影某一帧的 FOV"存进去;
    // 真正退出循环时 syncFovFromCamera 会把当时的 FOV 交还给参数。
    if (state.mode === 'cine') {
      const ae = document.activeElement;
      if (!(ae && ae.closest && ae.closest('#panel'))) {
        ui.setParamUI('fov', +camera.fov.toFixed(1));
      }
    }
    ui.updatePhysics({
      r: camera.position.length(), fov: camera.fov,
      tmax: state.params.diskTemperature,
    });
  }

  if (state.still && frame >= STILL_SETTLE) {
    stopLoop();
  }
}

function onFirstFrame() {
  ui.hideOverlay();
  if (window.gargantua) window.gargantua.ready = true;
  window.__GARGANTUA_READY__ = true;
  ach.unlock('first');
  console.log(
    `[GARGANTUA] ready in ${(performance.now() - T0).toFixed(0)}ms · ` +
    `WebGL2=${engine.isWebGL2} HDR=${engine.hdrFloat} · 内部分辨率 ${engine.W}×${engine.H} · ` +
    `质量 ${state.quality} · ${PARAM_COUNT} 参数 · 移动端=${IS_MOBILE}`);
  ui.toast('GARGANTUA 就绪 · Space 暂停循环 · P 打开参数面板');
  guide.maybeAutoStart(state); // 首访功能引导(自动化/隐藏 HUD/带参场景豁免;?guide=1 强制)
}

scheduleLoop();

// ---------------- Resize / Retina ----------------
let rzTimer = null;
function doResize() {
  if (exporting) return;
  camera.aspect = innerWidth / Math.max(innerHeight, 1);
  camera.updateProjectionMatrix();
  engine.resize();
}
window.addEventListener('resize', () => {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(doResize, 120);
});
// 嵌入式窗格 / 旋转 / 缩放导致的画布尺寸变化(不触发 window.resize)
new ResizeObserver(() => {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(doResize, 80);
}).observe(canvas);

// 隐藏页面中 RO/rAF 回调被挂起 → 循环内直接轮询画布尺寸兜底
let lastCW = 0, lastCH = 0;
function checkCanvasSize() {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if ((cw !== lastCW || ch !== lastCH) && cw > 0 && ch > 0) {
    lastCW = cw; lastCH = ch;
    doResize();
  }
}

// ---------------- WebGL 错误恢复 ----------------
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('[GARGANTUA] webglcontextlost');
  ui.showOverlay('渲染上下文丢失,等待自动恢复…', { spinner: true });
});
canvas.addEventListener('webglcontextrestored', () => {
  console.warn('[GARGANTUA] webglcontextrestored');
  engine.rebuild();
  for (const [k, v] of Object.entries(state.params)) engine.setParam(k, v);
  engine.setSeed(state.seed);
  ui.hideOverlay();
  ui.toast('WebGL 上下文已恢复');
});
window.addEventListener('error', (e) => {
  if (!(window.gargantua && window.gargantua.ready)) fatal('启动错误:' + (e.message || '未知'));
});

// ---------------- still 模式截图流 ----------------
async function snapFlow() {
  // 隐藏标签页中定时器被节流,不等待主循环;直接显式渲染(隐藏安全)
  await new Promise(r => setTimeout(r, 400));
  // 4K/8K:离屏原生重渲染(URL 自动化同样生效)
  if (state.exportSize !== 'screen') {
    const res = await exportImage(state.snapName, state.exportSize);
    window.__GARGANTUA_SHOT__ = res.url || null;
    window.__GARGANTUA_SHOT_BYTES__ = res.bytes || 0;
    window.__GARGANTUA_SHOT_MODE__ = state.exportSize;
    window.__GARGANTUA_SNAP_DONE__ = true;
    return;
  }
  await capture.renderFrames(state.snapFrames + 8);
  const url = canvas.toDataURL('image/png');
  window.__GARGANTUA_SHOT__ = url;
  const a = document.createElement('a');
  a.href = url;
  a.download = state.snapName;
  a.click();
  window.__GARGANTUA_SNAP_DONE__ = true;
  console.log(`[GARGANTUA] snapshot saved: ${state.snapName} (${(url.length / 1024).toFixed(0)} KB base64)`);
}
if (state.snapName) snapFlow();

// ---------------- 自动化 API ----------------
window.gargantua = {
  version: '2.3.0',
  startGuide: () => guide.start(),
  ready: false,
  info() {
    return {
      ready: this.ready, webgl2: engine.isWebGL2, hdr: engine.hdrFloat,
      fps: +fps.toFixed(1), frameCostMs: +costEma.toFixed(2),
      internalRes: [engine.W, engine.H], cssRes: [canvas.clientWidth, canvas.clientHeight],
      quality: state.quality, mode: state.mode, view: state.view, fpsCap: state.fpsCap,
      exportSize: state.exportSize,
      longExposure: state.longExposure, exposureFrames: state.exposureFrames,
      volDisk: state.volDisk,
      annotations: state.annotations, eht: state.eht, watermark: state.watermark,
      filmGrade: state.filmGrade, refColor: state.refColor, flyBoundary: state.flyBoundary,
      geoArmed: state.geoArmed, tour: tour.active, tourStation: tour.station,
      achievements: ach.count + '/' + ach.total,
      steps: QUALITIES[state.quality].steps, mobile: IS_MOBILE,
      seed: state.seed, time: +simTime.toFixed(3), params: { ...state.params },
      camPos: camera.position.toArray().map(v => +v.toFixed(2)), fov: +camera.fov.toFixed(1),
    };
  },
  setParam(k, v) { setParam(k, parseFloat(v)); return this.getParams()[k]; },
  setParams(obj) { for (const [k, v] of Object.entries(obj)) setParam(k, parseFloat(v)); return { ...state.params }; },
  getParams: () => ({ ...state.params }),
  setView(v) { setView(v); return state.view; },
  setQuality(q) { setQuality(q); return state.quality; },
  setFpsCap(v) { setFpsCap(v | 0); return state.fpsCap; },
  setExportSize(id) { setExportSize(id); return state.exportSize; },
  setLongExposure(on) { setLongExposure(!!on); return state.longExposure; },
  setExposureFrames(n) { setExposureFrames(+n); return state.exposureFrames; },
  setVolDisk(on) { setVolDisk(!!on); return state.volDisk; },
  setFlyBoundary(v) { setFlyBoundary(+v, { commit: true }); return state.flyBoundary; },
  setAnnotations(on) { setAnnotations(!!on); return state.annotations; },
  setEHT(on) { setEHT(!!on); return state.eht; },
  setFilmGrade(on) { setFilmGrade(!!on); return state.filmGrade; },
  setRefColor(on) { setRefColor(!!on); return state.refColor; },
  setWatermark(on) { setWatermark(!!on); return state.watermark; },
  setTour(on) { setTour(!!on); return tour.active; },
  setPhoto(on) { setPhoto(!!on); return state.photo; },
  setGeoArm(on) { setGeoArmed(!!on); return state.geoArmed; },
  launchPhoton(ndcX = 0, ndcY = 0) {
    if (exporting) return null;
    camera.updateMatrixWorld();
    const r = geolab.launchFromCamera(ndcX, ndcY, {
      spin: state.params.spin, rs: 2, diskOut: state.params.diskOuter,
      lensing: state.params.lensing,
    });
    ach.track('fan');
    return r;
  },
  share: () => buildShareURL(state, camera),
  applyShareCode: (s) => { applyShareCode(s); return state.params; },
  // 测试钩子:立即执行一次物理标注投影并返回关键属性
  _annoTest() {
    annotations.visible = true;
    annotations.update(camera, {
      spin: state.params.spin,
      diskIn: state.params.diskInner, diskOut: state.params.diskOuter,
    });
    return {
      shadowRx: document.getElementById('an-shadow')?.getAttribute('rx'),
      horizonRx: document.getElementById('an-horizon')?.getAttribute('rx'),
      iscoPathLen: (document.getElementById('an-isco')?.getAttribute('d') || '').length,
      labels: [1, 2, 3, 4].map(i => document.getElementById('an-lshadow,lhorizon,lisco,ldisk'.split(',')[i - 1])?.textContent?.slice(0, 18)),
    };
  },
  setPreset(i) { gotoPreset(i); return i; },
  // 任意机位(供截图/自动化;polar/az 为角度,r 以 M 计)
  setCamera(opts = {}) {
    const r = Math.max(3.4, Math.min(90, +opts.r || camera.position.length()));
    const polar = (opts.polar ?? 83) * Math.PI / 180;
    const az = (opts.az ?? 0) * Math.PI / 180;
    setMode('orbit');
    camera.position.set(
      r * Math.sin(polar) * Math.sin(az),
      r * Math.cos(polar),
      r * Math.sin(polar) * Math.cos(az));
    if (opts.fov != null) {
      camera.fov = Math.max(25, Math.min(110, +opts.fov));
      camera.updateProjectionMatrix();
      syncFovFromCamera();
    }
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    return { r, polar: +(polar * 180 / Math.PI).toFixed(1), az: +(az * 180 / Math.PI).toFixed(1), fov: +camera.fov.toFixed(1) };
  },
  setCine(on) { setMode(on ? 'cine' : 'orbit'); return state.mode; },
  setSeed(s) { state.seed = s | 0; engine.setSeed(state.seed); persist(state); return state.seed; },
  setMusic(on) { if (on !== audio.enabled) toggleMusic(); return audio.enabled; },
  resetParams,
  resetView: () => gotoPreset(0, true),
  renderFrames: (n) => capture.renderFrames(n | 0),
  renderOne: () => renderOne(),
  // 同步基准:渲染 n 帧后 gl.finish(),返回 {msPerFrame, res}(隐藏标签页可用)
  benchmark(n) {
    const cnt = Math.max(1, n | 0);
    const gl = engine.renderer.getContext();
    const t0 = performance.now();
    for (let i = 0; i < cnt; i++) renderOne();
    gl.finish();
    const ms = (performance.now() - t0) / cnt;
    return { msPerFrame: +ms.toFixed(3), fps: +(1000 / ms).toFixed(1), res: [engine.W, engine.H], steps: engine.uRT.uSteps.value };
  },
  // 截图:按当前「导出分辨率」设置执行;4K/8K 返回 Promise<{width,height,bytes,ms,url}>
  screenshot: (name) => exportImage(name),
  exportImage: (name, sizeId) => exportImage(name, sizeId),
  screenshotDataUrl: () => capture.screenshotDataUrl(),
  PARAM_KEYS: Object.keys(DEFAULTS),
  DEBUG_VIEWS: [...DEBUG_VIEWS],
  PRESETS: PRESETS.map(p => p.name),
  FILM_LOOKS: FILM_LOOKS.map(l => l.id),
};
window.__GARGANTUA_READY__ = false;
