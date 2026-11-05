// GARGANTUA — 吸积盘有机细节纹理(本地程序化生成,无外部资产)
// 目的:打破程序噪声在盘面上的重复感(借鉴参考项目用 organic 纹理的思路,
// 但纹理完全由本项目生成,可无缝平铺、固定种子、离线可用)。
import * as THREE from 'three';

// 整数哈希 → [0,1)(可平铺噪声的格子值)
function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 可平铺 value noise:格点索引对 per 取模 → 纹理在 [0,per) 域内首尾相接
function vnoise(x, y, per) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const m = (i) => ((i % per) + per) % per;
  const a = hash2(m(xi), m(yi));
  const b = hash2(m(xi + 1), m(yi));
  const c = hash2(m(xi), m(yi + 1));
  const d = hash2(m(xi + 1), m(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// 可平铺 fbm:第 o 层频率 2^o,格点周期 per·2^o
function fbm(x, y, per, oct) {
  let s = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    const f = 1 << o;
    s += amp * vnoise(x * f, y * f, per * f);
    norm += amp;
    amp *= 0.5;
  }
  return s / norm;
}

// 烘焙:域扭曲的 ridged FBM → 细丝网络(环状星云/气体云的纤维结构)
// per=16:纹理域内 16 个基础噪声单元;5 层八度,最细约 2px/格
export function bakeDiskTexture(size = 512, per = 8) {
  const t0 = performance.now();
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * per;
      const v = (y / size) * per;
      // 域扭曲(扭曲场本身也可平铺)
      const wx = u + 1.7 * (fbm(u + 3.1, v + 7.7, per, 3) - 0.5);
      const wy = v + 1.7 * (fbm(u + 9.2, v + 1.3, per, 3) - 0.5);
      // 主层:ridged fbm —— 1-|2n-1| 在 n=0.5 处形成细亮脊,相乘后是纤维网络
      let val = 0, amp = 0.55, norm = 0, f = 1;
      for (let o = 0; o < 5; o++) {
        const n = vnoise(wx * f, wy * f, per * f);
        const rid = 1 - Math.abs(2 * n - 1);
        val += amp * rid * rid;
        norm += amp;
        amp *= 0.62;
        f *= 2;
      }
      val /= norm;
      // 次级层:低频斑块调制(大尺度起伏,避免均匀)
      const patch = fbm(u * 0.5 + 11.0, v * 0.5 + 5.0, Math.max(2, per >> 1), 3);
      val *= 0.40 + 1.05 * patch;
      // 稀疏化:压掉背景,只保留脊线附近的气体(参考尘埃带的暗缝感)
      val = Math.max(0, val * 1.45 - 0.22);
      val = Math.min(1, Math.pow(val, 1.25));
      const r = Math.round(val * 255);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = r;
      data[i + 2] = r;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return { tex, ms: performance.now() - t0 };
}
