// GARGANTUA — 真实星空:亮星星表 → equirect HDR 纹理烘焙
// 烘焙一次 ~40ms / 8MB 显存;运行时只是一次纹理采样,比程序化三层恒星更便宜。
// 银道面(程序化 FBM)在真实模式下对齐真实银极,星表与银河带自洽。
import * as THREE from 'three';
import { BRIGHT_STARS, NAMED_STARS } from '../assets/data/bright-stars.js';

// 真实银极(IAU J2000):RA 192.85948°, Dec +27.12825° → 单位向量(赤道系,y=赤纬轴)
export const GAL_POLE_REAL = new THREE.Vector3(
  Math.cos(27.12825 * Math.PI / 180) * Math.cos(192.85948 * Math.PI / 180),
  Math.sin(27.12825 * Math.PI / 180),
  Math.cos(27.12825 * Math.PI / 180) * Math.sin(192.85948 * Math.PI / 180),
).normalize();

// B−V 色指数 → 色温(Ballesteros 公式) → RGB(与引擎黑体 LUT 同一族公式)
function bvToRGB(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const tt = Math.min(30000, Math.max(800, t)) * 0.01;
  const r = tt <= 66 ? 1 : clamp01(1.2929 * Math.pow(tt - 60, -0.1332));
  const g = tt <= 66 ? clamp01(0.3901 * Math.log(tt) - 0.6318)
                     : clamp01(1.1299 * Math.pow(tt - 60, -0.0755));
  const b = tt >= 66 ? 1 : (tt <= 19 ? 0 : clamp01(0.5432 * Math.log(tt - 10) - 1.1962));
  const sat = (x) => x + (x * x * (3 - 2 * x) - x) * 0.6;
  return [sat(r), sat(g), sat(b)];
}

// float32 → half(float16)位模式(Uint16)
function toHalf(v) {
  const f32 = new Float32Array(1);
  const i32 = new Int32Array(f32.buffer);
  f32[0] = v;
  const x = i32[0];
  const sign = (x >> 16) & 0x8000;
  let exp = (x >> 23) & 0xff;
  let man = x & 0x7fffff;
  if (exp === 255) return sign | 0x7c00 | (man ? 1 : 0); // Inf/NaN
  exp = exp - 127 + 15;
  if (exp >= 31) return sign | 0x7c00;        // 溢出 → Inf
  if (exp <= 0) {                              // 亚正规/零
    if (exp < -10) return sign;
    man = (man | 0x800000) >> (1 - exp);
    return sign | (man >> 13);
  }
  return sign | (exp << 10) | (man >> 13);
}

// 确定性 PRNG(mulberry32)
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 2048, H = 1024;

// 烘焙:星表星(高斯 PSF)+ 程序化暗星补密度 → RGBA16F DataTexture
export function bakeStarsTexture(seed = 7) {
  const t0 = performance.now();
  const acc = new Float32Array(W * H * 4);
  const splat = (ra, dec, mag, bv) => {
    const x = ((ra / 360 + 0.5) * W) % W;
    const row = (0.5 - dec / 180) * H;
    if (row < 1 || row > H - 2) return;
    const y = Math.round(row);
    const I = 3.0 * Math.pow(10, -0.35 * (mag - 1));
    const rad = Math.min(6.5, Math.max(1.0, 0.9 + (5.2 - mag) * 0.55));
    const [cr, cg, cb] = bvToRGB(bv);
    const R = Math.ceil(rad * 2.2);
    for (let dy = -R; dy <= R; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = ((Math.round(x) + dx) % W + W) % W;
        const d2 = (dx * dx + dy * dy) / (rad * rad);
        const wgt = Math.exp(-d2 * 1.6);
        if (wgt < 0.004) continue;
        const i = (yy * W + xx) * 4;
        acc[i] += I * wgt * cr;
        acc[i + 1] += I * wgt * cg;
        acc[i + 2] += I * wgt * cb;
      }
    }
  };
  // 1) 星表
  for (const [ra, dec, mag, bv] of BRIGHT_STARS) splat(ra, dec, mag, bv);
  // 2) 程序化暗星补密度(mag 4.8-6.5,跟随 seed)
  const rnd = mulberry32(seed ^ 0x5f3759df);
  const GA = 2.39996323; // 黄金角均匀撒方向
  for (let i = 0; i < 7000; i++) {
    const y = rnd() * 2 - 1;
    const th = i * GA + rnd() * 0.7;
    const dec = Math.asin(y) * 180 / Math.PI;
    const ra = (((th / (2 * Math.PI)) % 1) + 1) % 1 * 360;
    const mag = 4.8 + rnd() * 1.7;
    splat(ra, dec, mag, 0.3 + rnd() * 0.9);
  }
  // 3) float → half 打包
  const data = new Uint16Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    data[j] = toHalf(Math.min(30, acc[j]));
    data[j + 1] = toHalf(Math.min(30, acc[j + 1]));
    data[j + 2] = toHalf(Math.min(30, acc[j + 2]));
    data[j + 3] = toHalf(1);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, ms: performance.now() - t0, count: BRIGHT_STARS.length, named: NAMED_STARS };
}
