// GARGANTUA — 渲染引擎:全屏三角形 + 主光线追踪 pass + Bloom 金字塔 + 合成 pass
import * as THREE from 'three';
import { RT_VERT, RT_FRAG, RT_FRAG_KERR } from './shaders/raytracer.js';
import { POST_VERT, PREFILTER_FRAG, DOWN_FRAG, UP_FRAG, COMPOSITE_FRAG } from './shaders/post.js';
import { QUALITIES, RES_SCALE } from './state.js';
import { bakeDiskTexture } from './disktex.js';

// 黑体色查找表(与 raytracer.js 旧内联公式逐位一致,含饱和度提升)
function blackbodyJS(kelvin) {
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const t = Math.min(30000, Math.max(800, kelvin)) * 0.01;
  const r = t <= 66 ? 1 : clamp01(1.2929 * Math.pow(t - 60, -0.1332));
  const g = t <= 66 ? clamp01(0.3901 * Math.log(t) - 0.6318)
                    : clamp01(1.1299 * Math.pow(t - 60, -0.0755));
  const b = t >= 66 ? 1 : (t <= 19 ? 0 : clamp01(0.5432 * Math.log(t - 10) - 1.1962));
  const sat = (x) => x * x * (3 - 2 * x);
  return [r + (sat(r) - r) * 0.6, g + (sat(g) - g) * 0.6, b + (sat(b) - b) * 0.6];
}

// Kerr 顺行 ISCO 半径(Bardeen-Press-Teukolsky,单位 = M)
export function iscoRadius(spin, rs = 2) {
  const a = Math.min(Math.abs(spin), 0.998);
  const Z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const Z2 = Math.sqrt(3 * a * a + Z1 * Z1);
  return (rs / 2) * (3 + Z2 - Math.sqrt(Math.max((3 - Z1) * (3 + Z1 + 2 * Z2), 0)));
}

// Kerr 视界 r+ = M(1 + √(1−a²))
export function horizonRadius(spin, rs = 2) {
  const a = Math.min(Math.abs(spin), 0.998);
  return (rs / 2) * (1 + Math.sqrt(Math.max(1 - a * a, 0)));
}

// 长曝光累积着色器:输出当前帧 RGB + 权重 alpha,混合由固定管线完成
const ACCUM_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uWeight;
void main() {
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb, uWeight);
}
`;

function makeRT(w, h, forceLDR = false) {
  const rt = new THREE.WebGLRenderTarget(Math.max(w, 4), Math.max(h, 4), {
    // 无 EXT_color_buffer_float 的罕见环境降级到 8 位目标(丢 HDR 精度,但可渲染)
    type: forceLDR ? THREE.UnsignedByteType : THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

// 导出用 LDR 目标:合成 pass 已完成 ACES + 伽马,8 位足够,读取后直接编码 PNG
function makeLDRRT(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // 伽马在合成着色器内自己做
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = true;
    this.renderer.setPixelRatio(1);
    this.isWebGL2 = this.renderer.capabilities.isWebGL2;
    this.hdrFloat = !!this.renderer.extensions.get('EXT_color_buffer_float');

    // 黑体色 LUT(256×1 RGBA8):着色器 blackbody() 一次采样替代多次 log/pow
    {
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        const [r, g, b] = blackbodyJS(800 + (i / 255) * 29200);
        data[i * 4] = r * 255; data[i * 4 + 1] = g * 255; data[i * 4 + 2] = b * 255; data[i * 4 + 3] = 255;
      }
      this.bbTex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
      this.bbTex.minFilter = THREE.LinearFilter;
      this.bbTex.magFilter = THREE.LinearFilter;
      this.bbTex.wrapS = THREE.ClampToEdgeWrapping;
      this.bbTex.needsUpdate = true;
    }
    // 吸积盘有机细节纹理(本地烘焙,固定种子保证确定性)
    {
      const res = bakeDiskTexture(512, 16);
      this.diskTex = res.tex;
      this.diskTexMs = res.ms;
    }

    // 全屏三角形
    this.fsScene = new THREE.Scene();
    this.fsCam = new THREE.Camera();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(geo, null);
    this.mesh.frustumCulled = false;
    this.fsScene.add(this.mesh);

    this.quality = 'high';
    this.resScale = 1.0;   // 自适应动态分辨率(上限由质量档决定)
    this.resFloorOverride = null; // 用户指定的下限倍率(null = 跟随画质档 resFloor)
    this.W = 2; this.H = 2;

    this.buildMaterials();
    this.buildTargets();
  }

  buildMaterials() {
    this.uRT = {
      uCamPos:   { value: new THREE.Vector3(0, 1, 26) },
      uCamBasis: { value: new THREE.Matrix3() },
      uRes:      { value: new THREE.Vector2(2, 2) },
      uTanFov:   { value: Math.tan(THREE.MathUtils.degToRad(55) * 0.5) },
      uTime:     { value: 0 },
      uRs:       { value: 2.0 },
      uLensing:  { value: 1.0 },
      uDiskIn:   { value: 4.2 },
      uDiskOut:  { value: 22.0 },
      uDiskSoft: { value: 0.5 },
      uDiskBright: { value: 1.2 },
      uDiskTemp: { value: 7500 },
      uDiskSpeed: { value: 1.0 },
      uTurb:     { value: 0.6 },
      uTurbScale: { value: 2.2 },
      uDopBeam:  { value: 1.0 },
      uDopColor: { value: 0.85 },
      uGravShift: { value: 1.0 },
      uStarDensity: { value: 1.0 },
      uStarBright: { value: 1.0 },
      uMilkyWay: { value: 1.0 },
      uSeedOff:  { value: new THREE.Vector3(5.1, 3.7, 8.2) },
      uSteps:    { value: 192 },
      uDebug:    { value: 0 },
      uJitter:   { value: new THREE.Vector2(0, 0) }, // 亚像素抖动(长曝光时域超采样,纹素单位)
      uSpin:     { value: 0 },                       // Kerr 自旋 a/M
      uJet:      { value: 0 },                       // 相对论喷流强度
      uVolDisk:  { value: 0 },                       // 体积吸积盘开关
      uVolSub:   { value: 4 },                       // 体积盘子采样数(4 全 / 2 低档 / 1 极限)
      uDensify:  { value: 0.40 },                    // 盘区加密步长系数(默认 0.40 / 低档 0.55)
      uSubCap:   { value: 1.6 },                     // 贴板细分上限(×当地半厚)
      uFarMul:   { value: 3.0 },                     // 远场大步长倍率
      uGalPole:  { value: new THREE.Vector3(0.32, 0.86, 0.39) }, // 银道面法向
      uBB:       { value: null },
      uDiskTex:  { value: null },
      uFilm:     { value: 1 },
      uRefColor: { value: 0 },
    };
    this.uPre = { uTex: { value: null }, uThreshold: { value: 1.0 } };
    this.uDown = { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } };
    this.uUp = { uTex: { value: null }, uPrev: { value: null }, uTexel: { value: new THREE.Vector2() } };
    this.uAccum = { uTex: { value: null }, uWeight: { value: 1.0 } };
    this.uComp = {
      uScene: { value: null }, uBloom: { value: null },
      uBloomStr: { value: 0.75 }, uExposure: { value: 1.15 },
      uVignette: { value: 0.5 }, uGrain: { value: 0.1 }, uAberr: { value: 0.6 },
      uRes: { value: new THREE.Vector2(2, 2) }, uTime: { value: 0 }, uDebug: { value: 0 },
      uEHT: { value: 0 },
      uFilm: { value: 1 },
    };
    const opts = { vertexShader: POST_VERT, depthTest: false, depthWrite: false };
    this.matRT = new THREE.ShaderMaterial({ ...opts, fragmentShader: RT_FRAG, uniforms: this.uRT });
    // Kerr 路径:同一份 uniforms,独立 program(保证自旋 0 快速路径的寄存器占用不受影响)
    this.matRTKerr = new THREE.ShaderMaterial({ ...opts, fragmentShader: RT_FRAG_KERR, uniforms: this.uRT });
    this.uRT.uBB.value = this.bbTex;
    this.uRT.uDiskTex.value = this.diskTex;
    this.matPre = new THREE.ShaderMaterial({ ...opts, fragmentShader: PREFILTER_FRAG, uniforms: this.uPre });
    this.matDown = new THREE.ShaderMaterial({ ...opts, fragmentShader: DOWN_FRAG, uniforms: this.uDown });
    this.matUp = new THREE.ShaderMaterial({ ...opts, fragmentShader: UP_FRAG, uniforms: this.uUp });
    this.matComp = new THREE.ShaderMaterial({ ...opts, fragmentShader: COMPOSITE_FRAG, uniforms: this.uComp });
    // 长曝光累积:RGB = 当前帧, alpha = 混合权重;CustomBlending 完成 accum·(1-w) + frame·w
    this.matAccum = new THREE.ShaderMaterial({
      ...opts,
      fragmentShader: ACCUM_FRAG,
      uniforms: this.uAccum,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.le = false;
    this.accumFrames = 8;
    this._accumFresh = true;
  }

  buildTargets(withAccum = true) {
    this.disposeTargets();
    const w = this.W, h = this.H;
    const ldr = !this.hdrFloat; // 无浮点渲染目标扩展时整条管线降级 8 位
    this.sceneRT = makeRT(w, h, ldr);
    // 高分辨率导出且未开长曝光时省掉一整块累积缓冲(8K 可省 265 MB)
    this.accumRT = withAccum ? makeRT(w, h, ldr) : null;
    // Bloom 金字塔:L0 = 半分辨率
    const levels = QUALITIES[this.quality]?.bloomLevels ?? 5;
    this.downRT = []; this.upRT = [];
    for (let i = 0; i < levels; i++) {
      const bw = Math.max(4, (w >> (i + 1)));
      const bh = Math.max(4, (h >> (i + 1)));
      this.downRT.push(makeRT(bw, bh, ldr));
      this.upRT.push(makeRT(bw, bh, ldr));
    }
    this.uRT.uRes.value.set(w, h);
    this.uComp.uRes.value.set(w, h);
    this.clearAccum();
  }

  disposeTargets() {
    if (this.sceneRT) this.sceneRT.dispose();
    if (this.accumRT) this.accumRT.dispose();
    if (this.downRT) this.downRT.forEach(rt => rt.dispose());
    if (this.upRT) this.upRT.forEach(rt => rt.dispose());
  }

  clearAccum() {
    this._accumFresh = true; // 清空后首帧直接拷贝,避免从黑渐显
    if (!this.accumRT) return;
    const r = this.renderer;
    r.setRenderTarget(this.accumRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.setRenderTarget(null);
  }

  // 长曝光:开启/关闭(关闭即绕过累积 pass);累积帧数 N(权重 1/N)
  setLongExposure(on, frames) {
    this.le = !!on;
    this.accumFrames = Math.max(2, frames | 0);
    this.clearAccum();
  }

  setAccumFrames(n) {
    this.accumFrames = Math.max(2, n | 0);
  }

  setQuality(q) {
    this.quality = q;
    const def = QUALITIES[q] || QUALITIES.high;
    this.uRT.uSteps.value = def.steps;
    this.uRT.uVolSub.value = def.volSub ?? 4;
    this.uRT.uDensify.value = def.densify ?? 0.40;
    this.uRT.uSubCap.value = def.subCap ?? 1.6;
    this.uRT.uFarMul.value = def.farMul ?? 3.0;
    this.resScale = 1.0;
    // 自适应状态清零:_failScale/出带连击是"本档位"的教训,跨档泄漏会让新档位
    // 被旧档位的失败上限压住(如低档 0.8 失败过,切标准档后回升被卡在 0.78)
    this._ema = undefined; this._over = 0; this._under = 0; this._failScale = undefined;
    this._adaptCount = 0; // 重新静默 50 帧,给新档位稳定窗口
    this.resize();
  }

  resize() {
    const q = QUALITIES[this.quality] || QUALITIES.high;
    const dpr = Math.min(window.devicePixelRatio || 1, q.prCap);
    const cw = Math.max(2, this.canvas.clientWidth || window.innerWidth);
    const ch = Math.max(2, this.canvas.clientHeight || window.innerHeight);
    const w = Math.max(4, Math.round(cw * dpr * this.resScale));
    const h = Math.max(4, Math.round(ch * dpr * this.resScale));
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    this.buildTargets();
    // setSize 清空了画布:立即重绘一帧,不留空帧给合成器(否则窗口变化/切档/降采样时黑屏一闪)。
    // 启动阶段尚无成功渲染,跳过(首帧主循环会画)。
    if (this._lastRender) {
      this.renderFrame(this._lastRender.t, this._lastRender.view, this._lastRender.opts);
    }
  }

  // 动态分辨率下限:null = 跟随当前画质档;数值 = 用户面板/URL/API 指定的固定下限。
  // 调高到当前倍率之上时立即抬回(resize 会重绘),否则等 adapt 按帧耗自然回落。
  setResFloor(v) {
    this.resFloorOverride = (typeof v === 'number' && isFinite(v))
      ? Math.min(RES_SCALE.max, Math.max(RES_SCALE.min, v))
      : null;
    const floor = this.getResFloor();
    if (this.resScale < floor - 1e-6) {
      this.resScale = floor;
      this.resize();
    }
  }

  getResFloor() {
    const q = QUALITIES[this.quality] || QUALITIES.high;
    return this.resFloorOverride ?? q.resFloor ?? 0.45;
  }

  // 自适应动态分辨率:帧时间过高压低,宽松时缓慢回升(上限受质量档约束)。
  // frameMs 只是 CPU 提交代价(GPU 满载时测不到);intervalEma−vsyncMin 补充掉帧信号:
  // rAF 间隔超出 vsync 周期的部分 ≈ GPU 真实超支,取两者较大者作为有效帧耗。
  // 目标带按档位:默认 7.5–9ms(60Hz 与 120Hz 屏幕上「满帧 60fps」的 iv−vsync 信号同为
  // 16.7−8.5 ≈ 8.2,落在带内 → 稳定 60fps);低档 20–26ms 伺服 ~30fps(换分辨率清晰度)。
  // 防抖:决策窗口 90 帧 + 连续 2 个窗口出带才动作;回升不超过上次引发掉帧的档位
  // (_failScale,防 60Hz 上"60↔40fps"极限环),带内时缓慢上探放宽该上限。
  adapt(frameMs, intervalEma = 0, vsyncMin = 0) {
    const q = QUALITIES[this.quality] || QUALITIES.high;
    if (q === QUALITIES.safemode) return;
    const hi = q.adaptHi ?? 9.0, lo = q.adaptLo ?? 7.5;
    const eff = Math.max(frameMs, intervalEma - vsyncMin);
    this._ema = this._ema === undefined ? eff : this._ema * 0.94 + eff * 0.06;
    this._adaptCount = (this._adaptCount || 0) + 1;
    if (this._adaptCount < 50 || !this._lastAdapt) this._lastAdapt = performance.now();
    if (this._adaptCount % 90 !== 0) return;
    const floor = this.getResFloor();
    let s = this.resScale;
    if (this._ema > hi) { this._over = (this._over || 0) + 1; this._under = 0; }
    else if (this._ema < lo) { this._under = (this._under || 0) + 1; this._over = 0; }
    else { this._over = 0; this._under = 0; this._failScale = Math.min(1.0, (this._failScale || 1.0) * 1.01); }
    if (this._ema > hi && this._over >= 2 && s > floor) {
      this._failScale = Math.min(this._failScale || 1.0, s); // 记住引发掉帧的档位
      s = Math.max(floor, s * 0.90);
    } else if (this._ema < lo && this._under >= 2 && s < 1.0) {
      const cap = Math.min(1.0, (this._failScale || 1.0) * 0.97);
      if (s < cap) s = Math.min(cap, s * 1.05);
    }
    if (Math.abs(s - this.resScale) > 0.02) {
      this.resScale = s;
      this.resize(); // resize 内部立即重绘,不留空画布帧
    }
  }

  setSeed(seed) {
    this.uRT.uSeedOff.value.set(
      Math.sin(seed * 12.9898) * 4.37 + 5.0,
      Math.cos(seed * 7.233) * 4.11 + 5.0,
      Math.sin(seed * 3.171) * 4.53 + 5.0);
  }

  setParam(key, v) {
    const u = this.uRT;
    switch (key) {
      case 'lensing': u.uLensing.value = v; break;
      case 'spin': u.uSpin.value = v; break;
      case 'jetPower': u.uJet.value = v; break;
      case 'diskInner': u.uDiskIn.value = v; break;
      case 'diskOuter': u.uDiskOut.value = v; break;
      case 'diskThickness': u.uDiskSoft.value = v; break;
      case 'diskBrightness': u.uDiskBright.value = v; break;
      case 'diskTemperature': u.uDiskTemp.value = v; break;
      case 'diskSpeed': u.uDiskSpeed.value = v; break;
      case 'turbulence': u.uTurb.value = v; break;
      case 'turbulenceScale': u.uTurbScale.value = v; break;
      case 'dopplerBeaming': u.uDopBeam.value = v; break;
      case 'dopplerColor': u.uDopColor.value = v; break;
      case 'gravRedshift': u.uGravShift.value = Math.max(v, 0.001); break;
      case 'starDensity': u.uStarDensity.value = v; break;
      case 'starBrightness': u.uStarBright.value = v; break;
      case 'milkyWay': u.uMilkyWay.value = v; break;
      case 'bloom': this.uComp.uBloomStr.value = v; break;
      case 'bloomThreshold': this.uPre.uThreshold.value = this.hdrFloat ? v : Math.min(v, 0.8); break;
      case 'exposure': this.uComp.uExposure.value = v; break;
      case 'vignette': this.uComp.uVignette.value = v; break;
      case 'grain': this.uComp.uGrain.value = v; break;
      case 'aberration': this.uComp.uAberr.value = v; break;
    }
  }

  // 性能开关:体积吸积盘
  setVolDisk(on) {
    this.uRT.uVolDisk.value = on ? 1 : 0;
  }

  // EHT 对比模式(合成 pass 内完成,不加 pass)
  setEHT(on) {
    this.uComp.uEHT.value = on ? 1 : 0;
  }

  // 电影色调:盘面双色带(主 pass)+ 胶片曲线(合成 pass)
  setFilmGrade(on) {
    this.uRT.uFilm.value = on ? 1 : 0;
    this.uComp.uFilm.value = on ? 1 : 0;
  }

  setRefColor(on) {
    this.uRT.uRefColor.value = on ? 1 : 0;
  }

  // 自旋 > 0 走 Kerr-Schild 哈密顿 program,否则走速度 Verlet 快速 program
  rtMaterial() {
    return this.uRT.uSpin.value > 0.001 ? this.matRTKerr : this.matRT;
  }

  updateCamera(camera) {
    this.uRT.uCamPos.value.copy(camera.position);
    this.uRT.uCamBasis.value.setFromMatrix4(camera.matrixWorld);
    this.uRT.uTanFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  }

  pass(material, target, noClear = false) {
    this.mesh.material = material;
    this.renderer.setRenderTarget(target);
    if (noClear) this.renderer.autoClear = false; // 累积 pass 不得清空缓冲
    this.renderer.render(this.fsScene, this.fsCam);
    if (noClear) this.renderer.autoClear = true;
  }

  // 完整后期链:测地线积分 → (长曝光累积) → Bloom → 合成。target=null 输出到画布。
  _runPipeline(target, debugView) {
    // 1) 主 pass:测地线积分(自旋 0 = Verlet 快速路径,自旋 > 0 = Kerr-Schild 路径)
    this.pass(this.rtMaterial(), this.sceneRT);

    // 2) 长曝光帧累积:accum = accum·(1-w) + frame·w(首帧直接拷贝)
    const le = this.le && debugView === 0 && !!this.accumRT;
    if (le) {
      const w = this._accumFresh ? 1.0 : 1 / this.accumFrames;
      this._accumFresh = false;
      this.uAccum.uTex.value = this.sceneRT.texture;
      this.uAccum.uWeight.value = w;
      this.pass(this.matAccum, this.accumRT, true);
    }
    const srcRT = le ? this.accumRT : this.sceneRT;

    // 3) Bloom(调试直通视图跳过)
    const levels = this.downRT.length;
    const bloomOn = debugView === 0 && this.uComp.uBloomStr.value > 0.01 && levels >= 2;
    if (bloomOn) {
      this.uPre.uTex.value = srcRT.texture;
      this.pass(this.matPre, this.downRT[0]);
      for (let i = 1; i < levels; i++) {
        const src = this.downRT[i - 1];
        this.uDown.uTex.value = src.texture;
        this.uDown.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(this.matDown, this.downRT[i]);
      }
      for (let i = levels - 2; i >= 0; i--) {
        const upSrc = (i === levels - 2) ? this.downRT[levels - 1] : this.upRT[i + 1];
        this.uUp.uTex.value = upSrc.texture;
        this.uUp.uTexel.value.set(1 / upSrc.width, 1 / upSrc.height);
        this.uUp.uPrev.value = this.downRT[i].texture;
        this.pass(this.matUp, this.upRT[i]);
      }
      this.uComp.uBloom.value = this.upRT[0].texture;
    } else {
      this.uComp.uBloom.value = srcRT.texture;
    }

    // 4) 合成:ACES / 暗角 / 颗粒 / 色散
    this.uComp.uScene.value = srcRT.texture;
    this.pass(this.matComp, target);
  }

  renderFrame(timeSec, debugView = 0, opts = {}) {
    // 记录最近渲染参数供 resize 后立即重绘:复用同一对象,主循环路径零分配
    // (opts 只取 jitter 一个开关;调用方传的对象允许是复用的)
    if (!this._lastRender) this._lastRender = { t: 0, view: 0, opts: { jitter: false } };
    const lr = this._lastRender;
    lr.t = timeSec; lr.view = debugView;
    lr.opts.jitter = !!(opts && opts.jitter);
    this.uRT.uTime.value = timeSec;
    this.uRT.uDebug.value = debugView;
    this.uComp.uTime.value = timeSec;
    this.uComp.uDebug.value = debugView;
    this._setJitter(!!opts.jitter);
    this._runPipeline(null, debugView);
    this.renderer.setRenderTarget(null);
  }

  // 长曝光开启时每帧对光线做亚像素抖动 → 帧累积顺带变成超采样抗锯齿(TAA);
  // 抖动关闭(冻结/短路径)时归零,保证确定性截图逐字节一致
  _setJitter(on) {
    if (!on) { this.uRT.uJitter.value.set(0, 0); return; }
    this._jitIdx = ((this._jitIdx || 0) + 1) & 15;
    // Halton(2,3) 低差异序列 ×0.8 纹素
    const halton = (i, b) => {
      let f = 1, r = 0;
      while (i > 0) { f /= b; r += f * (i % b); i = (i / b) | 0; }
      return r;
    };
    this.uRT.uJitter.value.set(
      (halton(this._jitIdx + 1, 2) - 0.5) * 0.8,
      (halton(this._jitIdx + 1, 3) - 0.5) * 0.8);
  }

  // 离屏高分辨率导出:在目标尺寸重建整条管线,渲染后读回像素编码 PNG(不经过画布,无闪烁)。
  // 长曝光开启时按 frameDt 推进时间并累积 exposureFrames 帧,得到原生高分辨率光轨。
  async renderExport({ width, height, timeSec = 0, debugView = 0, frameDt = 1 / 60, watermark = null, onProgress = null } = {}) {
    const t0 = performance.now();
    const maxTex = this.renderer.capabilities.maxTextureSize;
    if (width > maxTex || height > maxTex) {
      throw new Error(`导出尺寸 ${width}×${height} 超过 GPU 纹理上限 ${maxTex}px`);
    }
    const oldW = this.W, oldH = this.H, oldScale = this.resScale;
    let ldr = null;
    try {
      this.resScale = 1.0;
      this.W = width; this.H = height;
      this._setJitter(false); // 导出路径无抖动:freeze 下确定性,且导出自带原生分辨率
      this.buildTargets(this.le); // 未开长曝光时不分配累积缓冲
      ldr = makeLDRRT(width, height);

      const frames = this.le ? Math.max(2, this.accumFrames) : 1;
      const step = this.le ? Math.max(0, frameDt) : 0;
      this.uRT.uDebug.value = debugView;
      this.uComp.uDebug.value = debugView;
      for (let i = 0; i < frames; i++) {
        const t = timeSec + i * step;
        this.uRT.uTime.value = t;
        this.uComp.uTime.value = t;
        this._runPipeline(ldr, debugView);
        if (onProgress) onProgress(i + 1, frames);
        // 可见页面分片让出主线程,避免长曝光导出时整页冻结;隐藏标签页的
        // setTimeout 会被强节流,故只在可见时让出
        if (!document.hidden && i % 4 === 3) await new Promise(r => setTimeout(r, 0));
      }

      const buf = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(ldr, 0, 0, width, height, buf);
      // WebGL 读回是自下而上 → 原地逐行交换翻转为自上而下(只借一行临时空间,
      // 峰值内存比"旧缓冲+新缓冲"两份全尺寸拷贝减半:8K 从 ~400MB 降到 ~135MB)
      const row = width * 4;
      const tmpRow = new Uint8Array(row);
      const half = height >> 1;
      for (let y = 0; y < half; y++) {
        const a = y * row, b = (height - 1 - y) * row;
        tmpRow.set(buf.subarray(a, a + row));
        buf.copyWithin(a, b, b + row);
        buf.set(tmpRow, b);
      }
      const c2 = document.createElement('canvas');
      c2.width = width; c2.height = height;
      // Uint8ClampedArray 直接作为同一 buffer 的视图,零拷贝
      const u8c = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length);
      const c2ctx = c2.getContext('2d');
      c2ctx.putImageData(new ImageData(u8c, width, height), 0, 0);
      // 摄影模式水印(等效 EXIF,画在左下角)
      if (watermark) {
        const fs = Math.max(12, Math.round(height * 0.016));
        c2ctx.font = `${fs}px ui-monospace, Consolas, monospace`;
        c2ctx.textBaseline = 'bottom';
        c2ctx.shadowColor = 'rgba(0,0,0,0.85)';
        c2ctx.shadowBlur = 4;
        c2ctx.fillStyle = 'rgba(255,255,255,0.82)';
        c2ctx.fillText(watermark, Math.round(height * 0.015), height - Math.round(height * 0.015));
      }
      const blob = await new Promise((resolve, reject) => {
        c2.toBlob(b => b ? resolve(b) : reject(new Error('PNG 编码失败(尺寸过大或内存不足)')), 'image/png');
      });
      return { blob, width, height, frames, ms: performance.now() - t0 };
    } finally {
      if (ldr) ldr.dispose();
      this.W = oldW; this.H = oldH; this.resScale = oldScale;
      this.buildTargets(true);
    }
  }

  rebuild() {
    // WebGL 上下文恢复后重建资源
    this.buildTargets();
  }

  dispose() {
    this.disposeTargets();
    [this.matRT, this.matRTKerr, this.matPre, this.matDown, this.matUp, this.matComp].forEach(m => m?.dispose());
    this.bbTex?.dispose();
    this.diskTex?.dispose();
    this.mesh.geometry.dispose();
    this.renderer.dispose();
  }
}
