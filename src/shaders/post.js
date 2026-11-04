// GARGANTUA — 后处理:HDR Bloom(亮通 + 下采样金字塔 + 上采样累加)与 ACES 合成
// (ACES 暗角 / 胶片颗粒 / 轻微径向色散 / 调试直通)

export const POST_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// 亮通提取(软阈值)
export const PREFILTER_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.5 + 1e-4;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

// 盒式下采样(4 tap @ ±0.5 纹素 → 双线性 2×2 均值,防深层混叠方块)
export const DOWN_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 0.5, -0.5)).rgb
         + texture2D(uTex, vUv + uTexel * vec2(-0.5,  0.5)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

// 帐篷上采样并与同尺寸下采样层累加
export const UP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;   // 更小一级(上采样源)
uniform sampler2D uPrev;  // 本尺寸下采样层(加回)
uniform vec2 uTexel;
void main() {
  vec3 s = texture2D(uTex, vUv + uTexel * vec2(-1.0,  0.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 1.0,  0.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 0.0, -1.0)).rgb
         + texture2D(uTex, vUv + uTexel * vec2( 0.0,  1.0)).rgb
         + 0.5 * ( texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
                 + texture2D(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb
                 + texture2D(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb
                 + texture2D(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb );
  s /= 6.0;
  s += texture2D(uPrev, vUv).rgb * 0.72; // 逐级衰减,防止金字塔累加爆白
  gl_FragColor = vec4(s, 1.0);
}
`;

// 最终合成:色散 → (+bloom) → 曝光 → ACES → 伽马 → 暗角 → 颗粒(可选 EHT 模式)
export const COMPOSITE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStr;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uAberr;
uniform vec2  uRes;
uniform float uTime;
uniform int   uDebug;
uniform float uEHT;    // EHT 对比模式:模拟事件视界望远镜的有限角分辨率
uniform float uFilm;   // 电影色调:胶片 S 曲线 + 通道 gamma 暖偏 + 暗部抬升

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec2 uv = vUv;

  // 调试视图 2+:直通显示(着色器输出即为显示色)
  if (uDebug >= 2) {
    vec3 c = (uDebug == 2) ? texture2D(uBloom, uv).rgb : texture2D(uScene, uv).rgb;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    return;
  }

  // 轻微径向色散(R/B 反向偏移)
  vec2 dc = uv - 0.5;
  vec2 off = dc * dot(dc, dc) * uAberr * 0.012;
  vec3 hdr;
  hdr.r = texture2D(uScene, uv + off).r;
  hdr.g = texture2D(uScene, uv).g;
  hdr.b = texture2D(uScene, uv - off).b;

  // 调试视图 1:原始 HDR 线性压缩显示
  if (uDebug == 1) {
    gl_FragColor = vec4(pow(clamp(hdr * 0.28, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    return;
  }

  hdr += texture2D(uBloom, uv).rgb * uBloomStr;
  hdr *= uExposure;

  vec3 col = pow(aces(hdr), vec3(1.0 / 2.2));

  if (uEHT > 0.5) {
    // —— EHT 模拟:把整幅画面压到"地球尺寸基线"的等效分辨率 ——
    // 13 tap 圆盘重模糊(半径 ≈ 画面高的 2.4%)→ 只剩环状结构,正如 M87* 的著名影像
    float rpx = uRes.y * 0.024;
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 13; i++) {
      float a = float(i) * 0.4833 * 6.2831;
      float rr = (i == 0) ? 0.0 : (i <= 4 ? 0.55 : 1.0);
      vec2 o = vec2(cos(a), sin(a)) * rpx * rr / uRes;
      acc += texture2D(uScene, uv + o).rgb;
      wsum += 1.0;
    }
    vec3 bl = acc / wsum * uExposure * 1.15;
    float lum = max(max(bl.r, bl.g), bl.b);
    // 亮度映射到 EHT 风格橙红(黑体 1000-5000K 感)
    vec3 eht = mix(vec3(0.10, 0.03, 0.01), vec3(1.00, 0.42, 0.10), clamp(lum * 1.6, 0.0, 1.0));
    eht = mix(eht, vec3(1.0, 0.88, 0.62), clamp(lum * lum * 2.2 - 0.7, 0.0, 1.0));
    eht *= smoothstep(0.015, 0.10, lum); // 底噪压黑
    float asp = max(uRes.x / uRes.y, 1.0);
    float vrad = length((uv - 0.5) * vec2(asp, 1.0 / asp));
    eht *= mix(1.0, smoothstep(0.9, 0.35, vrad), 0.7);
    float g = hash12(uv * uRes + vec2(fract(uTime * 0.617) * 251.0, fract(uTime * 0.473) * 373.0)) - 0.5;
    eht += g * (uGrain + 0.06) * (0.4 + 0.6 * (1.0 - clamp(lum, 0.0, 1.0)));
    gl_FragColor = vec4(clamp(eht, 0.0, 1.0), 1.0);
    return;
  }

  // 电影色调:胶片式曲线(参考项目配方的轻量版,避免暖偏过重)
  if (uFilm > 0.5) {
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.32); // 轻 S 对比:压暗背景、提亮中间调
    col = pow(col, vec3(1.08, 1.03, 1.0));                // 通道 gamma 暖偏(红抬最多)
    col = pow(col, vec3(0.94));                           // 暗部轻抬,深红外缘不糊
    col = clamp(col * 1.02, 0.0, 1.0);                    // 1% 提亮并夹紧
  }

  // 暗角(随宽高比修正)
  float asp = max(uRes.x / uRes.y, 1.0);
  float vrad = length((uv - 0.5) * vec2(asp, 1.0 / asp));
  col *= mix(1.0, smoothstep(0.88, 0.32, vrad), clamp(uVignette, 0.0, 1.5) * 0.85);

  // 胶片颗粒(暗部更强)
  float g = hash12(uv * uRes + vec2(fract(uTime * 0.617) * 251.0, fract(uTime * 0.473) * 373.0)) - 0.5;
  float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  col += g * uGrain * (0.35 + 0.65 * (1.0 - lum));

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
