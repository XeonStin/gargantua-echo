// GARGANTUA — Schwarzschild / Kerr null-geodesic raytracer (fullscreen fragment shader)
// 几何单位:G = c = 1,r_s = uRs(默认 2),M = uRs/2。吸积盘位于赤道面(世界 y = 0)。
//
// 两条积分路径(同一份公共辅助代码,材质 defines 切换):
//  ① RT_FRAG       Schwarzschild:速度 Verlet,a = -(3/2)·r_s·h²·x/r⁵(h = |x×v| 守恒),
//     精确再现 GR 轨道方程 u'' + u = (3/2)·r_s·u²。自旋 = 0 时默认走这条(最快)。
//  ② RT_FRAG_KERR  Kerr:Kerr-Schild 笛卡尔坐标哈密顿积分 H = ½g^{μν}p_μp_ν,
//     g^{μν} = η^{μν} − f·k^μk^ν(f = 2Mr³/(r⁴+a²Z²)),RK2 中点法 + 自适应步长。
//     坐标旋转 (X,Y,Z)_ks = (x, −z, y)_world(绕 x 轴 +90°,右手系),自旋轴 = KS +Z = 世界 +y。
//     参考系拖曳、光子环不对称、ISCO 内移均由积分自然涌现。
//
// 视界捕获 / 光子环 / 多次盘穿越 / 引力透镜均由积分自然涌现,无任何贴图或代理几何。

export const RT_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// ============================ 公共部分(两条路径共享) ============================
const COMMON = /* glsl */`
precision highp float;

varying vec2 vUv;

uniform vec3  uCamPos;
uniform mat3  uCamBasis;   // 列: right, up, back(+Z)
uniform vec2  uRes;
uniform float uTanFov;
uniform float uTime;

uniform float uRs;         // Schwarzschild 半径(默认 2 M,M = uRs/2)
uniform float uLensing;    // 弯曲强度倍率(1 = 物理)

uniform float uDiskIn;     // 盘内半径
uniform float uDiskOut;    // 盘外半径
uniform float uDiskSoft;   // 厚度/不透明软硬
uniform float uDiskBright;
uniform float uDiskTemp;   // 内缘峰值温度 K
uniform float uDiskSpeed;
uniform float uTurb;       // 湍流强度
uniform float uTurbScale;  // 湍流尺度

uniform float uDopBeam;    // 多普勒增亮指数倍率
uniform float uDopColor;   // 多普勒色移混合
uniform float uGravShift;  // 引力红移量

uniform float uStarDensity;
uniform float uStarBright;
uniform float uMilkyWay;

uniform vec3  uSeedOff;    // 星空/银河种子偏移
uniform int   uSteps;      // 最大积分步数
uniform int   uDebug;      // 0-9 调试视图
uniform vec2  uJitter;     // 亚像素抖动(纹素单位,长曝光时域超采样)

uniform float uSpin;       // Kerr 自旋 a/M ∈ [0, 0.998]
uniform float uJet;        // 相对论喷流强度(0 = 关)
uniform float uVolDisk;    // 体积吸积盘开关(0 = 无穷薄穿越,1 = 体积积分)
uniform sampler2D uBB;     // 黑体色 LUT(256×1,800K-30000K)
uniform vec3   uGalPole;   // 银道面法向(程序化银河取向)
uniform sampler2D uDiskTex; // 吸积盘有机细节纹理(本地烘焙,可平铺)
uniform float uFilm;       // 电影色调开关(0/1):盘面双色带 + 合成胶片曲线
uniform float uRefColor;   // 参考配色开关(0/1):内缘白热 + 外缘橙褐

const int   MAX_STEPS = 384;
const float PI = 3.14159265;

// ---------------- hash & noise ----------------
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm4(vec3 p) {
  float s = 0.0;
  float a = 0.52;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.13 + vec3(11.3, 7.7, 5.1);
    a *= 0.5;
  }
  return s;
}
// 低八度变体(均值与 fbm4 对齐,供噪声细节不敏感处使用,省 ALU)
float fbm3(vec3 p) {
  float s = 0.52 * vnoise(p);
  p = p * 2.13 + vec3(11.3, 7.7, 5.1);
  s += 0.26 * vnoise(p);
  s += 0.13 * vnoise(p * 2.13 + vec3(11.3, 7.7, 5.1));
  return s * 1.071;
}
vec3 rotY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}

// ---------------- 黑体辐射色(256 项 LUT,engine 启动时按同一公式生成) ----------------
vec3 blackbody(float kelvin) {
  float t = (clamp(kelvin, 800.0, 30000.0) - 800.0) / 29200.0;
  return texture2D(uBB, vec2(t, 0.5)).rgb;
}

// ---------------- 调试色带 ----------------
vec3 heatRamp(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(vec3(0.05, 0.02, 0.18), vec3(0.45, 0.10, 0.55), smoothstep(0.0, 0.35, x));
  c = mix(c, vec3(0.95, 0.40, 0.15), smoothstep(0.35, 0.70, x));
  c = mix(c, vec3(1.00, 0.95, 0.75), smoothstep(0.70, 1.00, x));
  return c;
}

// ---------------- 程序化星空 ----------------
vec3 starLayer(vec3 rd, float scale, float prob, float gain, float rad) {
  vec3 p = rd * scale;
  vec3 id = floor(p);
  vec3 h = hash33(id);
  if (h.x > prob) return vec3(0.0);
  vec3 f = p - id - 0.5;
  vec3 sp = (hash33(id + 41.7) - 0.5) * 0.60; // 星心远离单元边界,防截断方块
  float d = length(f - sp);
  float mag = pow(hash13(id + 7.31), 9.0);
  float rr = rad * (0.5 + mag * 1.8);
  float core = exp(-d * d / max(rr * rr, 1e-6));
  float glow = exp(-d * 14.0) * 0.10;
  float tw = 0.84 + 0.16 * sin(uTime * (1.5 + h.y * 6.0) + h.z * 6.2831);
  vec3 col = blackbody(mix(3200.0, 12500.0, h.z * h.z));
  return col * (core + glow) * (0.25 + mag * 15.0) * gain * tw;
}

vec3 galaxy(vec3 rd) {
  vec3 gn = normalize(uGalPole);
  float mu = abs(dot(rd, gn));
  float band = exp(-mu * mu * 26.0);
  float wide = exp(-mu * 7.0) * 0.35;
  float cl  = fbm4(rd * 3.1 + uSeedOff);
  float cl2 = fbm3(rd * 8.3 - uSeedOff * 1.7);
  float dust = smoothstep(0.42, 0.80, fbm3(rd * 5.7 + vec3(4.2))) * band;
  vec3 e1 = normalize(cross(gn, vec3(0.0, 0.0, 1.0)));
  vec3 e2 = cross(gn, e1);
  vec3 coreDir = normalize(e1 * 0.82 + e2 * 0.44);
  float core = exp(-2.8 * acos(clamp(dot(rd, coreDir), -1.0, 1.0)));
  vec3 tint = mix(vec3(0.60, 0.72, 1.0), vec3(1.0, 0.83, 0.66), clamp(cl * 1.4 - 0.15, 0.0, 1.0));
  float I = (wide + band * (0.22 + 0.9 * cl * cl)) * (0.55 + 0.45 * cl2);
  I += core * (0.35 + 0.65 * cl) * band;
  I *= (1.0 - dust * 0.85);
  return tint * I * uMilkyWay * 0.5;
}

vec3 skyColor(vec3 rd) {
  vec3 c = vec3(0.0);
  c += starLayer(rd, 26.0, min(0.16 * uStarDensity, 0.9), 1.15 * uStarBright, 0.055);
  c += starLayer(rd, 74.0, min(0.30 * uStarDensity, 0.9), 0.55 * uStarBright, 0.045);
  c += starLayer(rd, 185.0, min(0.34 * uStarDensity, 0.9), 0.30 * uStarBright, 0.040);
  c += galaxy(rd);
  c += vec3(0.0012, 0.0014, 0.0021); // 深空底光,防死黑
  return c;
}

// ---------------- 吸积盘 ----------------
// 全局调试输出(主循环首条显著穿越时记录)
float g_gDop = 1.0;
float g_gGrav = 1.0;
float g_T = 0.0;

// 盘半径用 Boyer-Lindquist r(Kerr 赤道面 r_bl² = R⊥² − a²;自旋 0 时退化为普通距离)
float diskRadius(vec3 hp) {
  float aL = uSpin * uRs * 0.5;
  return sqrt(max(dot(hp.xz, hp.xz) - aL * aL, 0.01));
}

// 盘半厚:内缘膨松、外缘收成薄刃(做的是参考项目的观感;真实薄盘 H∝r^{9/8},
// 这里刻意反向——艺术取舍,不影响测地线积分)
float diskHalfHeight(float r) {
  float rg = clamp((r - uDiskIn) / max(uDiskOut - uDiskIn, 0.001), 0.0, 1.0);
  // 楔形剖面延伸到 2H → 全厚 = 4H;内缘约 21% 半径,外缘 ~1%
  // (参考项目 discThickness=0.1 @ discRadius=3.2,约 6%;此前我们内缘厚达 80%)
  return (0.090 + 0.30 * uDiskSoft) * mix(1.55, 0.42, pow(rg, 0.65));
}

vec4 diskShade(vec3 hp, vec3 vdir, float tNow, float fine) {
  float r = diskRadius(hp);

  // --- 边缘先算(廉价),盘外提前退出,省去噪声开销 ---
  float edgeIn  = smoothstep(uDiskIn * 0.86, uDiskIn * 1.30, r);
  float edgeOut = 1.0 - smoothstep(uDiskOut * 0.58, uDiskOut, r); // 外缘长尾(参考:非对称包络)
  float edge = edgeIn * edgeOut;
  if (edge < 0.004) return vec4(0.0);

  // --- 垂直剖面:楔形(参考项目 GasDisc 的 saturate(1-|y|/T) 配方) ---
  // 此前 |y|<H 内密度全满 → 垂直方向像一块硬板;现在边缘有明确轮廓
  // 盘面不是理想平面:厚度和中面都被慢变噪声扰动 → 近水平视角的切线边缘不是一条直亮线
  float wv = vnoise(hp * 0.32 + vec3(3.1, 5.7, 1.9));
  float HH = diskHalfHeight(r) * (0.55 + 0.95 * wv);
  float yw = hp.y - (wv - 0.5) * HH * 1.5;
  // 高斯垂直剖面(不再用有限支撑的楔形):没有硬边界,掠射时的上下边缘自然淡出
  float vprof = exp(-0.5 * pow(abs(yw) / max(HH, 1e-3), 2.0));
  // 比气体更厚、更平滑的垂直光晕(参考项目的 bloomFactor):给暗尘带垫一层暖光
  // 在采样截止半径前平滑归零——否则近水平视角下会出现一条硬边亮线
  float haloY = abs(yw) / max(HH, 1e-3);
  // 长尾光晕(参考 bloomFactor 的 1/y²):在气体边界外用平滑外发光过渡,避免硬切
  // 宽光晕(3H 尺度):气体边界之外仍有可观发射,掠射时上下边缘是渐隐而不是硬切
  float halo = exp(-haloY / 3.0) * (1.0 - smoothstep(4.0, 5.0, haloY));
  if (vprof < 0.004 && halo < 0.004) return vec4(0.0);

  // 归一化径向坐标(0=内缘, 1=外缘)
  float rg01 = clamp((r - uDiskIn) / max(uDiskOut - uDiskIn, 0.001), 0.0, 1.0);
  float rimT = 1.0 - rg01; // 1 = 紧贴内缘

  // --- 湍流:刚性旋转 + 有界差速剪切(双相位混合防无限剪切) ---
  float MM = uRs * 0.5;
  float t = tNow;
  float Omega;
  if (uSpin > 0.001) {
    // Kerr 顺行开普勒角速度 Ω = M^½ / (r^{3/2} + a·M^{3/2})
    Omega = sqrt(MM) / (pow(r, 1.5) + uSpin * MM * sqrt(MM)) * uDiskSpeed;
  } else {
    Omega = pow(r, -1.5) * uDiskSpeed;
  }
  float rMid = sqrt(max(uDiskIn * uDiskOut, 1.0));
  float OmegaRef = pow(rMid, -1.5) * uDiskSpeed;
  float P = 7.0;
  float uu = t * 0.04;
  float f1 = fract(uu);
  float f2 = fract(uu + 0.5);
  float wA = 1.0 - abs(f1 * 2.0 - 1.0);
  // 差速剪切基准取盘外缘角速度(而非中点):diff ≥ 0 → 内外圈剪切方向永远与轨道同向,
  // 只有速率差(内快外慢)。此前以中点为基准,外圈 diff<0 导致视觉上"反向旋转"
  float OmegaOuter;
  if (uSpin > 0.001) {
    OmegaOuter = sqrt(MM) / (pow(uDiskOut, 1.5) + uSpin * MM * sqrt(MM)) * uDiskSpeed;
  } else {
    OmegaOuter = pow(uDiskOut, -1.5) * uDiskSpeed;
  }
  float diff = max(Omega - OmegaOuter, 0.0) * 2.0; // 放大差速剪切,强化丝缕(刚体部分保持真实速率)
  vec3 pr = rotY(hp, -OmegaRef * t);
  vec3 pA = rotY(pr, -diff * f1 * P);
  vec3 pB = rotY(pr, -diff * f2 * P);

  // --- 丝状气体层:大尺度各向异性柱坐标 + 域扭曲 + 乘积八度 ---
  // (尺度必须够大:此前直接用 pd(=位置×2.2)采噪声,特征尺寸 ~0.45M,
  //  体积积分把细颗粒平均成"雾";改成未缩放坐标 ×0.42 后丝缕才立得起来)
  vec3 pu = mix(pB, pA, wA);
  float puR = length(pu.xz);
  vec2 rh = pu.xz / max(puR, 1e-4);
  vec2 thv = vec2(-rh.y, rh.x);
  // 切向 ×0.50 → 沿弧拉长;垂直 ×4.2 → 盘面上下有细层理
  // 湍流尺度:默认 3.0 → 因子精确归 1.0,q 与旧配方逐位一致;其余值缩放丝缕频率。
  // 直角坐标 3D 噪声:等值面是团块,不会形成放射状辐条
  vec3 q = pu * 3.20 * (uTurbScale * 0.33333334);
  // 双尺度域扭曲:慢变让丝缕整体弯折,快变打散"直毛发"式的规则径向纹
  float dw = vnoise(q * 0.42 + vec3(11.3, 4.7, 8.1));
  q += vec3(dw * 1.3 - 0.65, dw * 2.4 - 1.2, dw * 1.0 - 0.5);

  float fil = 1.0;
  fil *= vnoise(q) * 0.5 + 0.5;                 q = q * 2.03 + vec3(7.7, 5.1, 3.3);
  fil *= vnoise(q) * 0.5 + 0.5;                 q = q * 2.03 + vec3(5.1, 3.3, 7.7);
  fil *= vnoise(q) * 0.5 + 0.5;                 q = q * 2.03 + vec3(3.3, 7.7, 5.1);
  fil *= vnoise(q) * 0.5 + 0.5;                 q = q * 2.03 + vec3(9.1, 1.7, 6.3);
  fil *= vnoise(q) * 0.5 + 0.5;                 q = q * 2.03 + vec3(1.7, 6.3, 9.1);
  fil *= vnoise(q) * 0.5 + 0.5;
  fil = pow(fil, 0.34); // 6 层乘积归一化
  // 窄阈值 → 等值面薄壳:气体只存在于噪声场的 iso-surface 上,
  // 掠射积分时不会把所有结构平均成一团雾,而是保留一根根丝
  float filN = smoothstep(0.50, 0.56, fil);

  // 表层/薄盘专用:再叠一层高频细节。单次求值,不受体积步进的采样间距限制,
  // 近景(相机离盘面 <1M)时也能看到 1-2px 级的絮状纹理。
  float fineMul = 1.0;
  if (fine > 0.5) {
    vec3 fq = vec3(puR * 24.0, pu.y * 11.0, dot(pu.xz, thv) * 17.0) + vec3(dw * 3.0);
    float f1 = vnoise(fq) * 0.5 + 0.5;
    float f2 = vnoise(fq * 2.13 + vec3(4.7, 8.3, 1.9)) * 0.5 + 0.5;
    fineMul = mix(0.20, 1.75, smoothstep(0.30, 0.78, f1 * f2));
  }

  // --- 有机细节纹理:按 (θ, r) 采样;θ 用整数重复 + RepeatWrapping → 无接缝 ---
  // 参考配方:pow(,2)*4 对比增强;这里同时作用在密度与发光上 → 外盘被打散成稀疏尘带
  float th01 = atan(pr.z, pr.x) * 0.15915494 + 0.5;
  float warpR = rg01 + 0.05 * (vnoise(vec3(th01 * 9.0, 2.0, 5.0)) - 0.5);
  float detail = texture2D(uDiskTex, vec2(warpR * 2.2, th01 * 1.6 + dw * 0.10)).r;
  float det = clamp(pow(detail, 1.4) * 2.2, 0.10, 1.8);

  // ---- 参考项目的薄片盘模型:覆盖率 × 尘埃色 + 垂直光晕 ----
  // 不再做等值面体积积分;coverage 在盘面处解析求值,射线步进只负责累积。
  float rgR = clamp(1.0 - rg01, 0.0, 1.0);                 // 1 = 内缘
  float radialDensity = mix(1.0, 0.48, pow(clamp(rg01, 0.0, 1.0), 0.6)); // 内密外疏
  // 覆盖:径向陡降 × 垂直锥 × 稀疏尘埃(6 层八度)× 有机纹理
  float cov = pow(rgR, 1.35) * vprof * filN * det * radialDensity
            * (0.55 + 0.45 * clamp(uTurb, 0.0, 1.0)) * fineMul;
  if (cov < 0.002) return vec4(0.0);
  float alpha = clamp(cov * (1.0 + 2.0 * uDiskSoft) * 3.0, 0.0, 1.0);

  // --- 轨道速度(LNRF 局部静止观者测得;Bardeen 公式,自旋 0 时退化为 √(M/(r−2M))) ---
  // 推迟到 cov 通过之后:被尘埃带剔除的样本不再白算 sqrt/pow/inversesqrt
  float rt = r / MM;                                     // r̃ = r/M
  float dlt = max(rt * rt - 2.0 * rt + uSpin * uSpin, 1e-4); // Δ̃
  float vOrb = (rt * rt - 2.0 * uSpin * sqrt(max(rt, 0.0)) + uSpin * uSpin)
             / (sqrt(dlt) * (pow(rt, 1.5) + uSpin));
  float beta = min(abs(vOrb), 0.985);
  vec3 tangent = vec3(-hp.z, 0.0, hp.x) / max(length(hp.xz), 1e-4); // 顺行(绕 +y)
  float gamma = inversesqrt(max(1.0 - beta * beta, 1e-3));
  vec3 nhat = -vdir; // 光子朝向相机方向的单位矢量
  float gDop = 1.0 / (gamma * (1.0 - beta * dot(tangent, nhat)));
  gDop = clamp(gDop, 0.25, 4.0);
  float gGrav = pow(clamp(sqrt(max(1.0 - uRs / r, 0.0)), 0.02, 1.0), uGravShift);
  float gTot = gDop * gGrav;

  // 温度/多普勒(物理色)
  float T = uDiskTemp * pow(uDiskIn / r, 0.75);
  float dopBright = pow(gDop, 2.8 * uDopBeam) * pow(gGrav, 2.0);
  vec3 tint = blackbody(T * mix(1.0, gTot, clamp(uDopColor, 0.0, 1.0)));
  if (uRefColor > 0.5) {
    tint = mix(vec3(1.70, 0.50, 0.10), vec3(1.0), pow(rgR, 0.5));
  }
  if (uFilm > 0.5) {
    tint *= mix(vec3(1.0), vec3(1.22, 0.92, 0.72), pow(clamp(1.0 - rimT, 0.0, 1.0), 1.6) * 0.75);
  }

  // 内缘白热(dustGlow)+ 垂直光晕(bloomFactor),按覆盖率在两者间过渡
  float dustGlow = 1.0 / (rg01 * rg01 * 120.0 + 0.02);
  float vGlow = 1.0 / (yw * yw * 45.0 + 0.01);
  vec3 dustCol = tint * dustGlow * 0.55;
  vec3 glowCol = tint * pow(vGlow, 1.15) * 0.12;
  vec3 emit = mix(dustCol, glowCol, clamp(1.0 - cov * 1.6, 0.0, 1.0)) * cov;
  emit *= uDiskBright * dopBright;
  // 外盘连续发光(随半径渐暗):参考项目的外圈不是纯黑,而是暗褐色余辉
  emit += tint * pow(rgR, 1.6) * 0.34 * uDiskBright * dopBright * (0.35 + 0.65 * cov);
  // 盘面上下柔和外光晕(不吃 coverage,给出厚度渐隐)
  emit += tint * halo * edge * 0.10 * uDiskBright * dopBright;
  emit *= mix(1.0, 2.20, uVolDisk);

  g_gDop = gDop;
  g_gGrav = gGrav;
  g_T = T;
  return vec4(emit, alpha);
}

// ---------------- 相对论喷流(自旋轴 = 世界 +y,蓝白同步辐射色) ----------------
// 结(knot)结构参考真实喷流的螺旋不稳定性,但用域扭曲打破噪声晶格的等距重复,
// 角向用旋转坐标采样(无 atan 接缝)。
vec3 jetEmit(vec3 wp, float tNow) {
  float ay = abs(wp.y);
  float rc = length(wp.xz);
  float jrad = 1.2 + 0.055 * ay;  // 准直锥:半径随高度缓慢张开
  float ax = rc / jrad;
  if (ay < 2.0 || ay > 70.0 || ax > 1.0) return vec3(0.0);
  // 螺旋旋转 (x,z) 后直接在笛卡尔坐标采噪声:角向天然连续无缝
  float helix = ay * 0.22 - tNow * 1.6;
  float ch = cos(helix), sh = sin(helix);
  vec2 xz = vec2(ch * wp.x + sh * wp.z, -sh * wp.x + ch * wp.z);
  // 域扭曲:慢变噪声扰动纵向坐标 → 结的间距/相位不再等距
  float warp = vnoise(vec3(xz * 0.12, ay * 0.09 + tNow * 0.07));
  float n = fbm3(vec3(xz * 0.55, ay * 0.16 - tNow * 1.1 + warp * 4.6));
  // 结的亮度沿程不均匀调制(慢变,打破"每颗一样亮")
  float knotAmp = 0.40 + 0.60 * vnoise(vec3(ay * 0.06 + tNow * 0.05, xz.x * 0.13, xz.y * 0.13 + 7.3));
  float shell = (1.0 - ax) * (1.0 - ax);
  float spine = exp(-ax * ax * 9.0);            // 明亮内脊
  float fall = exp(-ay * 0.032) * smoothstep(2.0, 5.0, ay);
  float em = uJet * fall * (shell * 0.5 + spine * 0.9) * smoothstep(0.10, 0.72, n) * knotAmp * 1.3;
  return vec3(0.48, 0.64, 1.0) * em;
}
`;

// ============================ ① Schwarzschild 速度 Verlet ============================
const SCHW_MAIN = /* glsl */`
void main() {
  vec2 ndc = vUv * 2.0 - 1.0 + uJitter * 2.0 / uRes;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uCamBasis * vec3(ndc.x * uTanFov * aspect, ndc.y * uTanFov, -1.0));
  vec3 ro = uCamPos;

  bool skyOnly = (uDebug == 9);

  vec3 pos = ro;
  vec3 vel = rd;
  float h2; {
    vec3 h = cross(ro, rd);
    h2 = dot(h, h);
  }
  float escR = max(uDiskOut + 16.0, 46.0);

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float stepsUsed = 0.0;
  int hitType = 0; // 0 步数耗尽 1 视界 2 逃逸 3 盘不透明
  float crossings = 0.0;
  float primaryW = 0.0;
  float dbgDop = 1.0;
  float dbgGrav = 1.0;
  float dbgT = 0.0;
  g_gDop = 1.0; g_gGrav = 1.0; g_T = 0.0;
  float pixPh = hash13(vec3(gl_FragCoord.xy, 2.3)); // 体积盘子采样相位(逐像素常数,提升出循环)
  float hMax = (0.090 + 0.30 * uDiskSoft) * 1.55 * 1.5; // 全盘最大半厚(内缘, wv=1;子采样快速预检用)

  // 初始加速度(弯曲常数每像素提出循环)
  float k = -1.5 * uRs * uLensing * h2;
  float r2 = dot(pos, pos);
  float r = sqrt(r2);
  vec3 acc = (k / max(r2 * r2 * r, 1e-6)) * pos;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) { hitType = 0; break; }
    if (r < uRs * 1.02) { hitType = 1; break; }
    if (r2 > escR * escR && dot(pos, vel) > 0.0) { hitType = 2; break; }

    // 自适应步长:视界附近致密;盘外远场弯曲可忽略 → 步长放大
    // (物理形状不变:弱场区 Verlet 误差 ~dt²·a 仍远小于 1M;盘面穿越检测与步长无关)
    float dt = clamp(0.16 * (r - uRs * 0.9), 0.028, 3.2)
             * (1.0 + 3.0 * smoothstep(uDiskOut, uDiskOut + 14.0, r));
    float hhStep = 0.0;
    if (uVolDisk > 0.5) hhStep = diskHalfHeight(r); // 本步标称半厚(门控/壳层跳过/细分共用,每步一次)
    bool densified = false;
    if (uVolDisk > 0.5 && r < uDiskOut + 4.0) {
      // 薄层门控(半径相关):子采样有贡献要求 |sp.y| < 5.75×HH ≤ 8.625×dHH(r)
      // (5×HH 采样截止 + 0.75×HH 中面噪声偏移,HH ≤ 1.5×dHH),门限取 8.7×dHH(r)+1.0。
      // 外缘薄盘门限(≈1.7)远低于内缘(≈3.5)——掠过外盘上方的光线不再白吃加密步长;
      // lookahead 取 0.6 步长:未加密段终点必然仍高于门限(更高于板顶),绝不跨板。
      float gate = 8.7 * hhStep + 1.0;
      float ay = abs(pos.y);
      if (ay < gate || ay - gate < abs(vel.y) * dt * 0.6) {
        densified = true;
        dt *= 0.40; // 体积盘模式:盘区加密采样(十轮由 0.28 放宽,4 子采样仍解析薄层,亮度按 ev∝segLen 自守恒)
        // 贴近盘面时按当地半厚再加密:外缘薄刃不再被大体积元一口吞掉
        // (十轮:上限 hh→1.6hh,细分步长仍 ≤ 薄层特征厚度的 1/3)
        if (r > uDiskIn * 0.8 && ay < hhStep * 3.0) dt = min(dt, max(0.06, hhStep * 1.6));
      }
    }
    float halfDt2 = 0.5 * dt * dt;

    vec3 npos = pos + vel * dt + acc * halfDt2;
    float nr2 = dot(npos, npos);
    float nr = sqrt(nr2);
    vec3 nacc = (k / max(nr2 * nr2 * nr, 1e-6)) * npos;
    vec3 nvel = vel + (acc + nacc) * (0.5 * dt);

    // 喷流(发射型路径积分,段中点采样)
    if (uJet > 0.001 && trans > 0.004) {
      vec3 mid = mix(pos, npos, 0.5);
      col += trans * jetEmit(mid, uTime) * dt * 0.3;
    }

    if (!skyOnly && trans > 0.004) {
      if (uVolDisk > 0.5) {
        // 体积吸积盘:段内 4 子采样 + 逐像素相位抖动(否则等步长采样会出竖条纹)
        vec3 mid = mix(pos, npos, 0.5);
        float mr = diskRadius(mid);
        // 壳层跳过:段不穿越中面、且整体位于贡献截止之外 → 整段零贡献,免 4 次子采样。
        // 阈值分段保证保守:加密段(Δr ≤ 1.28M,dHH 梯度有界)用 10×dHH(r) ≥ 7.5×dHH(sr);
        // 非加密粗段(Δr 可达 12M)必须用全局上界 10×hMax ≥ 7.5×max(dHH)。
        // |y| 沿段线性 → 无符号翻转时 |y| ≥ 端点最小值。
        bool crossY = (pos.y * npos.y < 0.0);
        float yNear = min(abs(pos.y), abs(npos.y));
        float yCut = densified ? (10.0 * hhStep) : (10.0 * hMax);
        if (mr > uDiskIn * 0.82 - 2.0 && mr < uDiskOut + 2.0 &&
            (crossY || yNear < yCut)) {
          float segLen = length(npos - pos);
          vec3 vDir = normalize(nvel); // 提出子采样循环
          float ev = segLen * 0.125;   // 段积分权重(与子采样数同源,提出循环)
          for (int s = 0; s < 4; s++) {
            vec3 sp = mix(pos, npos, (float(s) + pixPh) * 0.25);
            float sr = diskRadius(sp);
            if (sr < uDiskIn * 0.82 || sr > uDiskOut) continue;
            if (abs(sp.y) >= 5.0 * hMax) continue; // 远在薄层外:免 diskHalfHeight 求值
            float sH = diskHalfHeight(sr); // 半厚(内厚外薄,与 diskShade 同源)
            if (abs(sp.y) >= sH * 5.0) continue;
            vec4 dsk = diskShade(sp, vDir, uTime, 0.0);
            // 吸收系数单独加大:让盘在视线进入后的前一小段就变不透明,
            // 否则掠射时会积完整条 15M 路径,细结构全被平均
            float av = clamp(dsk.a * ev, 0.0, 1.0);
            col += trans * dsk.rgb * ev;   // 发射与吸收解耦:密度→0 时光晕仍能淡出
            trans *= 1.0 - av;
            if (primaryW < 0.5 && av > 0.08) {
              primaryW = 1.0; dbgDop = g_gDop; dbgGrav = g_gGrav; dbgT = g_T;
            }
            if (trans < 0.004) break;
          }
          crossings += 1.0;
          if (trans < 0.004) {
            pos = npos; vel = nvel; acc = nacc; r2 = nr2; r = nr;
            stepsUsed += 1.0;
            hitType = 3; break;
          }
        }
      } else if (pos.y * npos.y < 0.0) {
        // 薄盘穿越(y 符号翻转 → 插值求交点)
        float ft = pos.y / (pos.y - npos.y);
        vec3 hp = mix(pos, npos, ft);
        float hr = diskRadius(hp);
        if (hr > uDiskIn * 0.82 && hr < uDiskOut) {
          vec4 dsk = diskShade(hp, normalize(nvel), uTime, 1.0);
          col += trans * dsk.rgb * dsk.a;
          trans *= 1.0 - dsk.a;
          crossings += 1.0;
          if (primaryW < 0.5 && dsk.a > 0.22) {
            primaryW = 1.0;
            dbgDop = g_gDop;
            dbgGrav = g_gGrav;
            dbgT = g_T;
          }
          if (trans < 0.004) { pos = npos; vel = nvel; hitType = 3; break; }
        }
      }
    }

    pos = npos; vel = nvel; acc = nacc;
    r2 = nr2; r = nr;
    stepsUsed += 1.0;
  }

  // 逃逸 → 程序化天空(含引力透镜后的星场);
  // 步数耗尽的近临界光线也用当前方向采天空:比留纯黑更接近高步数积分的结果
  if (trans > 0.004 && (hitType == 2 || hitType == 0)) {
    col += trans * skyColor(normalize(vel));
  }

  // ---------------- 调试视图 ----------------
  if (uDebug == 3) {
    col = heatRamp(stepsUsed / float(uSteps));
  } else if (uDebug == 4) {
    col = hitType == 1 ? vec3(0.92, 0.15, 0.10)
        : hitType == 2 ? vec3(0.15, 0.32, 0.92)
        : hitType == 3 ? vec3(0.95, 0.72, 0.10)
        : vec3(0.60, 0.10, 0.92);
  } else if (uDebug == 5) {
    col = heatRamp((dbgDop - 0.4) / 1.6) * (primaryW > 0.5 ? 1.0 : 0.06);
  } else if (uDebug == 6) {
    col = heatRamp((dbgGrav - 0.3) / 0.7) * (primaryW > 0.5 ? 1.0 : 0.06);
  } else if (uDebug == 7) {
    col = primaryW > 0.5 ? blackbody(dbgT) * clamp(dbgT / 9000.0, 0.25, 1.6) : vec3(0.02);
  } else if (uDebug == 8) {
    col = heatRamp(crossings / 4.0);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// ============================ ② Kerr / Kerr-Schild 哈密顿积分 ============================
// H = ½ g^{μν} p_μ p_ν,g^{μν} = η^{μν} − f k^μ k^ν(签名 (−,+,+,+)),
// f = 2Mr³/(r⁴+a²Z²),k_μ = (1, (rX+aY)/(r²+a²), (rY−aX)/(r²+a²), Z/r),r 由
// r⁴ − (R²−a²)r² − a²Z² = 0 给出(KS 采用 BL 半径)。dx^μ/dλ = ∂H/∂p_μ,
// dp_μ/dλ = ½(∂_μ f)G² + f·G·∂_μ G,G = k^ν p_ν(η 部分为 0:光子满足 H=0)。
const KERR_MAIN = /* glsl */`
// r(X) 与度规标量场:f = 2Mr³/(r⁴+a²Z²) · uLensing
void ksMetric(vec3 X, float M, float aL, out float rOut, out float fOut) {
  float R2 = dot(X, X);
  float inner = R2 - aL * aL;
  float s = 0.5 * (inner + sqrt(inner * inner + 4.0 * aL * aL * X.z * X.z)); // r²
  float r = sqrt(max(s, 1e-6));
  float D = max(s * s + aL * aL * X.z * X.z, 1e-4);
  rOut = r;
  fOut = 2.0 * M * s * r / D * uLensing;
}

// 哈密顿正则方程右端(RK2 中点法用)
void ksDeriv(vec3 X, vec3 p, float pt, float M, float aL,
             out vec3 dX, out vec3 dp, out float dtL, out float rOut) {
  float R2 = dot(X, X);
  float inner = R2 - aL * aL;
  float sq = sqrt(max(inner * inner + 4.0 * aL * aL * X.z * X.z, 0.0));
  float s = 0.5 * (inner + sq);       // r²
  float r = sqrt(max(s, 1e-6));
  float den = max(sq, 1e-4);          // = 2s − R² + a²(环奇异性处防护)
  float D = max(s * s + aL * aL * X.z * X.z, 1e-4);
  float f = 2.0 * M * s * r / D * uLensing;
  rOut = r;

  // ∂r/∂X(drd)= (X·s, Y·s, Z·(s+a²)) / (den·r)
  vec3 drd = vec3(X.x * s, X.y * s, X.z * (s + aL)) / (den * r);

  // k 矢量及其梯度
  float E1 = 1.0 / (s + aL * aL);
  float u = r * X.x + aL * X.y;
  float v = r * X.y - aL * X.x;
  vec3 k = vec3(u * E1, v * E1, X.z / r);
  float kr = 2.0 * r * E1 * E1;
  vec3 dKx = (drd * X.x + vec3(r, aL, 0.0)) * E1 - u * kr * drd;
  vec3 dKy = (drd * X.y + vec3(-aL, r, 0.0)) * E1 - v * kr * drd;
  vec3 dKz = vec3(0.0, 0.0, 1.0 / r) - (X.z / (r * r)) * drd;

  // G = k^ν p_ν = −p_t + k⃗·p⃗
  float G = -pt + dot(k, p);
  // ∂_j G = Σ_i p_i ∂_j k_i
  vec3 dG = p * mat3(dKx, dKy, dKz);

  // ∂f/∂X(∂f/∂r 保有 Z 不变;∂f/∂Z 保有 r 不变)
  float dfdr = 2.0 * M * s * (3.0 * D - 4.0 * s * s) / (D * D) * uLensing;
  float dfdz = -4.0 * M * aL * aL * X.z * r * s / (D * D) * uLensing;
  vec3 dfd = dfdr * drd + vec3(0.0, 0.0, dfdz);

  dX = p - f * k * G;          // dx^i/dλ
  dtL = -pt + f * G;           // dx^0/dλ(坐标时间,盘相位用)
  dp = 0.5 * dfd * (G * G) + f * G * dG;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0 + uJitter * 2.0 / uRes;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uCamBasis * vec3(ndc.x * uTanFov * aspect, ndc.y * uTanFov, -1.0));
  vec3 ro = uCamPos;

  bool skyOnly = (uDebug == 9);

  float M = uRs * 0.5;
  float aL = uSpin * M;                                  // 长度量纲 a
  float rH = M * (1.0 + sqrt(max(1.0 - uSpin * uSpin, 0.0))); // 视界 r+
  float escR = max(uDiskOut + 16.0, 46.0);

  // 世界 → KS:(X,Y,Z) = (x, −z, y)(绕 x 轴 +90° 右手旋转,自旋轴 = KS +Z)
  vec3 X = vec3(ro.x, -ro.z, ro.y);
  vec3 dks = vec3(rd.x, -rd.z, rd.y);

  // 初始协变动量:空间方向 d,解零性条件得 β = P^t
  float r0, f0;
  ksMetric(X, M, aL, r0, f0);
  float kd;
  vec3 k0;
  {
    float R2 = dot(X, X);
    float inner = R2 - aL * aL;
    float s0 = 0.5 * (inner + sqrt(inner * inner + 4.0 * aL * aL * X.z * X.z));
    float E1 = 1.0 / (s0 + aL * aL);
    k0 = vec3((r0 * X.x + aL * X.y) * E1, (r0 * X.y - aL * X.x) * E1, X.z / r0);
    kd = dot(k0, dks);
  }
  float S = sqrt(max(1.0 - f0 * (1.0 - kd * kd), 0.0)); // 能层内强制共转的物理极限
  float beta0 = (f0 * kd + S) / max(1.0 - f0, 1e-3);    // P^t(未来指向,>0)
  float pt = (f0 - 1.0) * beta0 + f0 * kd;              // p_t(<0,守恒)
  vec3 p = dks + k0 * (f0 * (beta0 + kd));              // p_i = d_i + f k_i(β + k·d)

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float stepsUsed = 0.0;
  int hitType = 0;
  float crossings = 0.0;
  float primaryW = 0.0;
  float dbgDop = 1.0;
  float dbgGrav = 1.0;
  float dbgT = 0.0;
  g_gDop = 1.0; g_gGrav = 1.0; g_T = 0.0;
  float pixPh = hash13(vec3(gl_FragCoord.xy, 2.3)); // 体积盘子采样相位(逐像素常数,提升出循环)
  float hMax = (0.090 + 0.30 * uDiskSoft) * 1.55 * 1.5; // 全盘最大半厚(内缘, wv=1;子采样快速预检用)

  vec3 dX1 = vec3(0.0), dp1 = vec3(0.0), dX2 = vec3(0.0), dp2 = vec3(0.0);
  float dtL1 = 0.0, dtL2 = 0.0, r = r0;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) { hitType = 0; break; }
    ksDeriv(X, p, pt, M, aL, dX1, dp1, dtL1, r);
    if (r < rH * 1.01) { hitType = 1; break; }
    if (r > escR && dot(X, dX1) > 0.0) { hitType = 2; break; }

    // 自适应步长(λ 与坐标距离同量级:|dX| ≈ E ≈ 1)
    float dt = clamp(0.16 * (r - rH * 0.9), 0.028, 3.2)
             * (1.0 + 3.0 * smoothstep(uDiskOut, uDiskOut + 14.0, r));
    float hhStep = 0.0;
    if (uVolDisk > 0.5) hhStep = diskHalfHeight(r); // 本步标称半厚(门控/壳层跳过/细分共用,每步一次)
    bool densified = false;
    if (uVolDisk > 0.5 && r < uDiskOut + 4.0) {
      // 薄层门控(与 Verlet 路径同源,半径相关):|世界 y|=|X.z|,世界 y 向速度 = KS 的 dX1.z。
      float gate = 8.7 * hhStep + 1.0;
      float ay = abs(X.z);
      if (ay < gate || ay - gate < abs(dX1.z) * dt * 0.6) {
        densified = true;
        dt *= 0.40; // 体积盘模式:盘区加密采样(十轮由 0.28 放宽,与 Verlet 路径同源)
        if (r > uDiskIn * 0.8 && ay < hhStep * 3.0) { // KS 坐标里世界 y = X.z
          dt = min(dt, max(0.06, hhStep * 1.6));
        }
      }
    }
    float hdt = 0.5 * dt;

    // RK2 中点法
    vec3 Xm = X + dX1 * hdt;
    vec3 pm = p + dp1 * hdt;
    ksDeriv(Xm, pm, pt, M, aL, dX2, dp2, dtL2, r);
    vec3 nX = X + dX2 * dt;
    vec3 np = p + dp2 * dt;

    // 段中点 → 世界坐标(喷流/体积盘/调试全部在世界系完成)
    vec3 midW = vec3(mix(X.x, nX.x, 0.5), mix(X.z, nX.z, 0.5), -mix(X.y, nX.y, 0.5));
    float segLen = length(nX - X);

    // 喷流(发射型路径积分)
    if (uJet > 0.001 && trans > 0.004) {
      col += trans * jetEmit(midW, uTime) * segLen * 0.3;
    }

    if (!skyOnly && trans > 0.004) {
      if (uVolDisk > 0.5) {
        // 体积吸积盘:段内 4 子采样 + 逐像素相位抖动(否则等步长采样会出竖条纹)
        float mr = diskRadius(midW);
        // 壳层跳过(与 Verlet 路径同源,阈值分段保证保守):|世界 y|=|X.z|
        bool crossY = (X.z * nX.z < 0.0);
        float yNear = min(abs(X.z), abs(nX.z));
        float yCut = densified ? (10.0 * hhStep) : (10.0 * hMax);
        if (mr > uDiskIn * 0.82 - 2.0 && mr < uDiskOut + 2.0 &&
            (crossY || yNear < yCut)) {
          vec3 vW = normalize(vec3(dX2.x, dX2.z, -dX2.y));
          float ev = segLen * 0.125; // 段积分权重(与子采样数同源,提出循环)
          for (int s = 0; s < 4; s++) {
            vec3 spKS = mix(X, nX, (float(s) + pixPh) * 0.25);
            vec3 spW = vec3(spKS.x, spKS.z, -spKS.y);
            float sr = diskRadius(spW);
            if (sr < uDiskIn * 0.82 || sr > uDiskOut) continue;
            if (abs(spW.y) >= 5.0 * hMax) continue; // 远在薄层外:免 diskHalfHeight 求值
            float sH = diskHalfHeight(sr);
            if (abs(spW.y) >= sH * 5.0) continue;
            vec4 dsk = diskShade(spW, vW, uTime, 0.0);
            float av = clamp(dsk.a * ev, 0.0, 1.0);
            col += trans * dsk.rgb * ev;
            trans *= 1.0 - av;
            if (primaryW < 0.5 && av > 0.08) {
              primaryW = 1.0; dbgDop = g_gDop; dbgGrav = g_gGrav; dbgT = g_T;
            }
            if (trans < 0.004) break;
          }
          crossings += 1.0;
          if (trans < 0.004) {
            X = nX; p = np;
            stepsUsed += 1.0;
            hitType = 3; break;
          }
        }
      } else if (X.z * nX.z < 0.0) {
        // 薄盘穿越:KS Z 符号翻转 = 世界 y=0 面
        float ft = X.z / (X.z - nX.z);
        vec3 hpW = vec3(mix(X.x, nX.x, ft), mix(X.z, nX.z, ft), -mix(X.y, nX.y, ft));
        float hr = diskRadius(hpW);
        if (hr > uDiskIn * 0.82 && hr < uDiskOut) {
          vec3 vW = normalize(vec3(dX2.x, dX2.z, -dX2.y));
          vec4 dsk = diskShade(hpW, vW, uTime, 1.0);
          col += trans * dsk.rgb * dsk.a;
          trans *= 1.0 - dsk.a;
          crossings += 1.0;
          if (primaryW < 0.5 && dsk.a > 0.22) {
            primaryW = 1.0;
            dbgDop = g_gDop;
            dbgGrav = g_gGrav;
            dbgT = g_T;
          }
          if (trans < 0.004) { X = nX; p = np; hitType = 3; break; }
        }
      }
    }

    X = nX; p = np;
    stepsUsed += 1.0;
  }

  // 逃逸/步数耗尽 → 天空(渐近方向 ≈ 求一次终点导数)
  if (trans > 0.004 && (hitType == 2 || hitType == 0)) {
    vec3 dXe, dpe; float dtLe, re;
    ksDeriv(X, p, pt, M, aL, dXe, dpe, dtLe, re);
    vec3 dirW = normalize(vec3(dXe.x, dXe.z, -dXe.y));
    col += trans * skyColor(dirW);
  }

  // ---------------- 调试视图 ----------------
  if (uDebug == 3) {
    col = heatRamp(stepsUsed / float(uSteps));
  } else if (uDebug == 4) {
    col = hitType == 1 ? vec3(0.92, 0.15, 0.10)
        : hitType == 2 ? vec3(0.15, 0.32, 0.92)
        : hitType == 3 ? vec3(0.95, 0.72, 0.10)
        : vec3(0.60, 0.10, 0.92);
  } else if (uDebug == 5) {
    col = heatRamp((dbgDop - 0.4) / 1.6) * (primaryW > 0.5 ? 1.0 : 0.06);
  } else if (uDebug == 6) {
    col = heatRamp((dbgGrav - 0.3) / 0.7) * (primaryW > 0.5 ? 1.0 : 0.06);
  } else if (uDebug == 7) {
    col = primaryW > 0.5 ? blackbody(dbgT) * clamp(dbgT / 9000.0, 0.25, 1.6) : vec3(0.02);
  } else if (uDebug == 8) {
    col = heatRamp(crossings / 4.0);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export const RT_FRAG = COMMON + SCHW_MAIN;
export const RT_FRAG_KERR = COMMON + KERR_MAIN;
