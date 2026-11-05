// GARGANTUA — 状态:24 项参数 / 画质 / 视图 / URL 自动化接口 / localStorage 持久化

export const DEFAULTS = {
  fov: 57.5,               // 视场角 (度) — 相机参数,不是着色器 uniform
  diskInner: 4.91,       // 吸积盘内半径 (M,= a=0.318 的 ISCO)
  diskOuter: 16.5,       // 吸积盘外半径 (M)
  diskThickness: 0.31,   // 盘厚度/不透明软硬
  diskBrightness: 1.0,   // 盘亮度
  diskTemperature: 6400, // 内缘峰值温度 (K)
  diskSpeed: 1.0,        // 开普勒自转速率
  turbulence: 0.6,       // 湍流强度
  turbulenceScale: 3.0,  // 湍流尺度
  dopplerBeaming: 1.0,   // 多普勒增亮
  dopplerColor: 0.5,     // 多普勒色移
  gravRedshift: 1.0,     // 引力红移
  lensing: 1.0,          // 透镜强度
  spin: 0.318,           // Kerr 自旋 a/M(0 = Schwarzschild;>0 走 Kerr-Schild 积分)
  jetPower: 0,           // 相对论喷流强度(0 = 关)
  starDensity: 1.0,      // 恒星密度
  starBrightness: 1.0,   // 恒星亮度
  milkyWay: 1.0,         // 银河亮度
  bloom: 0.04,           // 泛光强度
  bloomThreshold: 0.0,   // 泛光阈值
  exposure: 0.53,        // 曝光
  vignette: 0.48,        // 暗角
  grain: 0.045,          // 胶片颗粒
  aberration: 0.3,       // 色散
};
export const PARAM_COUNT = Object.keys(DEFAULTS).length; // = 24

export const PARAM_META = [
  // 相机
  { key: 'fov',              label: '视场角 FOV', group: '相机',   min: 25,   max: 110, step: 1 },
  // 吸积盘
  { key: 'diskInner',        label: '盘内半径',   group: '吸积盘', min: 2.0,  max: 9.0,  step: 0.05 },
  { key: 'diskOuter',        label: '盘外半径',   group: '吸积盘', min: 10.0, max: 40.0, step: 0.5 },
  { key: 'diskThickness',    label: '盘厚软硬',   group: '吸积盘', min: 0.05, max: 1.5,  step: 0.01 },
  { key: 'diskBrightness',   label: '盘亮度',     group: '吸积盘', min: 0.0,  max: 4.0,  step: 0.02 },
  { key: 'diskTemperature',  label: '峰值温度 K', group: '吸积盘', min: 3000, max: 15000, step: 50 },
  { key: 'diskSpeed',        label: '自转速率',   group: '吸积盘', min: 0.0,  max: 3.0,  step: 0.02 },
  { key: 'turbulence',       label: '湍流强度',   group: '吸积盘', min: 0.0,  max: 1.0,  step: 0.01 },
  { key: 'turbulenceScale',  label: '湍流尺度',   group: '吸积盘', min: 0.5,  max: 6.0,  step: 0.05 },
  // 相对论
  { key: 'spin',             label: '自旋 a/M',   group: '相对论', min: 0.0,  max: 0.998, step: 0.002 },
  { key: 'jetPower',         label: '相对论喷流', group: '相对论', min: 0.0,  max: 2.0,  step: 0.02 },
  { key: 'dopplerBeaming',   label: '多普勒增亮', group: '相对论', min: 0.0,  max: 2.0,  step: 0.02 },
  { key: 'dopplerColor',     label: '多普勒色移', group: '相对论', min: 0.0,  max: 1.0,  step: 0.01 },
  { key: 'gravRedshift',     label: '引力红移',   group: '相对论', min: 0.0,  max: 1.0,  step: 0.01 },
  { key: 'lensing',          label: '透镜强度',   group: '相对论', min: 0.0,  max: 1.0,  step: 0.01 },
  // 星空
  { key: 'starDensity',      label: '恒星密度',   group: '星空',   min: 0.0,  max: 2.0,  step: 0.02 },
  { key: 'starBrightness',   label: '恒星亮度',   group: '星空',   min: 0.0,  max: 3.0,  step: 0.02 },
  { key: 'milkyWay',         label: '银河亮度',   group: '星空',   min: 0.0,  max: 2.0,  step: 0.02 },
  // 后期
  { key: 'bloom',            label: '泛光强度',   group: '后期',   min: 0.0,  max: 2.0,  step: 0.02 },
  { key: 'bloomThreshold',   label: '泛光阈值',   group: '后期',   min: 0.0,  max: 3.0,  step: 0.02 },
  { key: 'exposure',         label: '曝光',       group: '后期',   min: 0.2,  max: 3.0,  step: 0.01 },
  { key: 'vignette',         label: '暗角',       group: '后期',   min: 0.0,  max: 1.5,  step: 0.02 },
  { key: 'grain',            label: '胶片颗粒',   group: '后期',   min: 0.0,  max: 0.5,  step: 0.005 },
  { key: 'aberration',       label: '色散',       group: '后期',   min: 0.0,  max: 3.0,  step: 0.02 },
];

// 画质档:prCap = DPR 上限,steps = 积分步数,bloomLevels = Bloom 金字塔层数,
// volSub = 体积盘子采样数(4 全 / 2 低档 / 1 极限,ev 补偿自守恒),resFloor = 动态分辨率下限,
// densify/subCap/farMul = 低档积分粗化(加密系数/贴板细分上限/远场倍率,默认路径不受影响),
// adaptLo/Hi = 动态分辨率目标带 ms(低档伺服 ~30fps,其余伺服 60fps)
export const QUALITIES = {
  low:       { label: '低',   prCap: 1.0, steps: 96,  bloomLevels: 3, volSub: 2, resFloor: 0.8,
               densify: 0.55, subCap: 2.2, farMul: 5.0, adaptLo: 20, adaptHi: 26 },
  standard:  { label: '标准', prCap: 1.5, steps: 128, bloomLevels: 4, volSub: 4, resFloor: 0.45 },
  high:      { label: '高',   prCap: 2.0, steps: 192, bloomLevels: 5, volSub: 4, resFloor: 0.45 },
  cinematic: { label: '电影', prCap: 2.0, steps: 320, bloomLevels: 6, volSub: 4, resFloor: 0.45 },
  safemode:  { label: '安全', prCap: 1.0, steps: 96,  bloomLevels: 3, volSub: 4, resFloor: 0.45 },
};

// 动态分辨率下限的用户可调范围(面板「最低分辨率」滑条/URL ?minscale=/API setMinScale)
// 未显式设置时(state.minScale === null)跟随画质档的 resFloor
export const RES_SCALE = { min: 0.2, max: 1.0, step: 0.05 };

export function effectiveResFloor(state) {
  if (typeof state.minScale === 'number' && isFinite(state.minScale)) {
    return Math.min(RES_SCALE.max, Math.max(RES_SCALE.min, state.minScale));
  }
  return (QUALITIES[state.quality] || QUALITIES.high).resFloor ?? 0.45;
}

export const DEBUG_VIEWS = [
  '合成输出', '原始 HDR', '泛光缓冲', '积分步数', '命中分类',
  '多普勒因子', '引力红移', '盘面温度', '盘面穿越', '纯星空',
];

export const FPS_CAPS = [0, 30, 60, 90, 120, 144, 165]; // 0 = 不限
export const LE_FRAMES = { min: 2, max: 64, def: 8 };   // 长曝光累积帧数
export const EXPORT_SIZES = [
  { id: 'screen', label: '屏幕', w: 0,    h: 0 },
  { id: '4k',     label: '4K',   w: 3840, h: 2160 },
  { id: '8k',     label: '8K',   w: 7680, h: 4320 },
];

const LS_KEY = 'gargantua53f.v1';

// 按 PARAM_META 把任意来源(存档/URL/分享码)的参数值夹回合法区间
export function clampParamValue(key, v) {
  const m = PARAM_META.find(x => x.key === key);
  if (!m || typeof v !== 'number' || !isFinite(v)) return undefined;
  return Math.min(m.max, Math.max(m.min, v));
}

// ---------------- URL 解析 ----------------
export function parseURL() {
  const q = new URLSearchParams(location.search);
  const num = (k) => { const v = q.get(k); return v === null || v === '' || isNaN(parseFloat(v)) ? undefined : parseFloat(v); };
  const bool = (k) => { const v = q.get(k); return v === null ? undefined : v !== '0' && v !== 'false'; };
  const enumv = (k, list) => { const v = q.get(k); return v !== null && list.includes(v) ? v : undefined; };

  const s = {
    quality: enumv('quality', Object.keys(QUALITIES).filter(k => k !== 'safemode')),
    preset: num('preset') !== undefined ? Math.min(3, Math.max(0, num('preset') | 0)) : undefined,
    view: num('view') !== undefined ? Math.min(9, Math.max(0, num('view') | 0)) : undefined,
    mode: enumv('mode', ['cine', 'orbit', 'fly']),
    cine: bool('cine'),
    music: bool('music'),
    hud: bool('hud'),
    panel: bool('panel'),
    freeze: bool('freeze'),
    still: bool('still'),
    safemode: bool('safemode'),
    reset: bool('reset'),
    seed: num('seed') !== undefined ? (num('seed') | 0) : undefined,
    fps: num('fps') !== undefined ? (num('fps') | 0) : undefined,
    le: bool('le'),
    lef: num('lef') !== undefined ? (num('lef') | 0) : undefined,
    exp: enumv('exp', EXPORT_SIZES.map(s => s.id)),
    vol: bool('vol'),
    anno: bool('anno'),
    eht: bool('eht'),
    film: bool('film'),
    refcolor: bool('refcolor'),
    minscale: num('minscale'),
    flyb: num('flyb'),
    tour: bool('tour'),
    guide: bool('guide'),
    s: q.get('s') || undefined,
    t: num('t'),
    snapName: q.get('snap') || undefined,
    snapFrames: num('frames') !== undefined ? Math.max(1, num('frames') | 0) : undefined,
    params: {},
  };
  // ?p=key=val,key2=val2 或 ?key=val 直通(仅已知参数键)
  const rawP = q.get('p') || '';
  rawP.split(',').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k in DEFAULTS && v !== undefined && !isNaN(parseFloat(v))) s.params[k] = parseFloat(v);
  });
  for (const k of Object.keys(DEFAULTS)) {
    const v = q.get(k);
    if (v !== null && !isNaN(parseFloat(v))) s.params[k] = parseFloat(v);
  }
  return s;
}

// ---------------- localStorage ----------------
export function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.v !== 1) return null;
    return o;
  } catch { return null; }
}

let saveTimer = null;
export function persist(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        v: 1, params: state.params,
        // safemode 是降级路径而非用户选择,不落盘;否则存档会"卡"在安全模式
        quality: state.quality === 'safemode' ? 'high' : state.quality,
        seed: state.seed,
        fpsCap: state.fpsCap, longExposure: state.longExposure, exposureFrames: state.exposureFrames,
        exportSize: state.exportSize,
        volDisk: state.volDisk,
        annotations: state.annotations, eht: state.eht, watermark: state.watermark,
        filmGrade: state.filmGrade, refColor: state.refColor, flyBoundary: state.flyBoundary,
        minScale: state.minScale,
      }));
    } catch { /* 隐私模式等场景忽略 */ }
  }, 350);
}

// ---------------- 汇总初始状态 ----------------
export function initState() {
  const url = parseURL();
  const state = {
    params: { ...DEFAULTS },
    quality: 'cinematic',
    seed: 7,
    fpsCap: 0,        // 帧率上限(0 = 不限)
    longExposure: false, // 长曝光(帧累积)
    exposureFrames: 11,
    exportSize: 'screen', // 截图/导出分辨率:screen | 4k | 8k
    volDisk: true,       // 体积吸积盘(默认开)
    annotations: false,  // 物理标注叠加
    filmGrade: true,     // 电影色调(胶片曲线 + 盘面双色带),默认开
    refColor: true,      // 参考配色(内缘白热 + 外缘橙褐),默认开
    flyBoundary: 2.7,    // 自由飞行安全边界(M;2.01 = 贴视界极限,时间膨胀 ~14×)
    minScale: null,       // 动态分辨率下限倍率(null = 跟随画质档 resFloor)
    eht: false,          // EHT 对比模式
    watermark: false,    // 摄影模式:导出水印
    photo: false,        // 摄影模式叠加层(会话级,不持久化)
    geoArmed: false,     // 光子弹弓待发(会话级)
    tour: false,         // ?tour=1 启动导览(会话级)
    share: null,         // ?s= 分享码(会话级)
    view: 0,
    preset: null,     // ?preset= 初始视角预设(回归修复:此前解析了但从未应用)
    cine: true,       // 默认电影镜头循环
    mode: 'cine',
    music: false,
    hud: true,
    panel: false,
    freeze: false,
    still: false,
    safemode: false,
    snapName: null,
    snapFrames: 10,
    t0: null,
  };

  if (!url.reset) {
    const saved = loadPersisted();
    if (saved) {
      if (saved.params) for (const k of Object.keys(DEFAULTS)) {
        const cv = clampParamValue(k, saved.params[k]);
        if (cv !== undefined) state.params[k] = cv; // 坏存档/越界值一律夹回合法区间
      }
      if (saved.quality && saved.quality !== 'safemode' && QUALITIES[saved.quality]) state.quality = saved.quality;
      if (typeof saved.seed === 'number') state.seed = saved.seed;
      if (typeof saved.fpsCap === 'number' && FPS_CAPS.includes(saved.fpsCap)) state.fpsCap = saved.fpsCap;
      if (typeof saved.longExposure === 'boolean') state.longExposure = saved.longExposure;
      if (typeof saved.exposureFrames === 'number') {
        state.exposureFrames = Math.min(LE_FRAMES.max, Math.max(LE_FRAMES.min, saved.exposureFrames | 0));
      }
      if (EXPORT_SIZES.some(s => s.id === saved.exportSize)) state.exportSize = saved.exportSize;
      if (typeof saved.volDisk === 'boolean') state.volDisk = saved.volDisk;
      if (typeof saved.annotations === 'boolean') state.annotations = saved.annotations;
      if (typeof saved.eht === 'boolean') state.eht = saved.eht;
      if (typeof saved.watermark === 'boolean') state.watermark = saved.watermark;
      if (typeof saved.filmGrade === 'boolean') state.filmGrade = saved.filmGrade;
      if (typeof saved.refColor === 'boolean') state.refColor = saved.refColor;
      if (typeof saved.flyBoundary === 'number' && saved.flyBoundary >= 2.01 && saved.flyBoundary <= 3.0) {
        state.flyBoundary = saved.flyBoundary;
      }
      if (typeof saved.minScale === 'number' && saved.minScale >= RES_SCALE.min && saved.minScale <= RES_SCALE.max) {
        state.minScale = saved.minScale;
      }
    }
  }

  // URL 覆盖(优先级最高)
  if (url.quality) state.quality = url.quality;
  if (url.seed !== undefined) state.seed = url.seed;
  if (url.fps !== undefined && FPS_CAPS.includes(url.fps)) state.fpsCap = url.fps;
  if (url.le !== undefined) state.longExposure = url.le;
  if (url.lef !== undefined) state.exposureFrames = Math.min(LE_FRAMES.max, Math.max(LE_FRAMES.min, url.lef));
  if (url.exp) state.exportSize = url.exp;
  if (url.vol !== undefined) state.volDisk = url.vol;
  if (url.anno !== undefined) state.annotations = url.anno;
  if (url.eht !== undefined) state.eht = url.eht;
  if (url.film !== undefined) state.filmGrade = url.film;
  if (url.refcolor !== undefined) state.refColor = url.refcolor;
  // 0 或负值 = 自动(跟随画质档),与 UI「自动」按钮语义一致
  if (url.minscale !== undefined) {
    state.minScale = url.minscale <= 0 ? null
      : Math.min(RES_SCALE.max, Math.max(RES_SCALE.min, url.minscale));
  }
  if (url.flyb !== undefined) state.flyBoundary = Math.min(3.0, Math.max(2.01, url.flyb));
  if (url.tour !== undefined) state.tour = url.tour;
  if (url.s) state.share = url.s;
  for (const [k, v] of Object.entries(url.params)) {
    const cv = clampParamValue(k, v);
    if (cv !== undefined) state.params[k] = cv;
  }
  if (url.view !== undefined) state.view = url.view;
  if (url.preset !== undefined) state.preset = url.preset;
  if (url.cine !== undefined) state.cine = url.cine;
  if (url.mode !== undefined) { state.mode = url.mode; state.cine = url.mode === 'cine'; }
  else state.mode = state.cine ? 'cine' : 'orbit';
  if (url.music !== undefined) state.music = url.music;
  if (url.hud !== undefined) state.hud = url.hud;
  if (url.panel !== undefined) state.panel = url.panel;
  if (url.freeze !== undefined) state.freeze = url.freeze;
  if (url.still !== undefined) state.still = url.still;
  if (url.safemode !== undefined) state.safemode = url.safemode;
  if (url.snapName) { state.snapName = url.snapName; state.snapFrames = url.snapFrames ?? 10; state.still = true; }
  if (url.t !== undefined) state.t0 = url.t;
  if (state.safemode) state.quality = 'safemode';

  return state;
}
