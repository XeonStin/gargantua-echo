// GARGANTUA — 摄影模式:胶片风格预设 / 构图辅助线 / 导出水印
// 预设只是后期参数配方(setParam 应用,随时可 R 复位);构图线是纯 CSS 叠加。
export const FILM_LOOKS = [
  { id: 'default',      label: '默认',        params: {} },
  { id: 'imax',         label: 'IMAX 暖',     params: { exposure: 1.32, vignette: 0.38, grain: 0.05, aberration: 0.2, bloom: 0.85, bloomThreshold: 0.9 } },
  { id: 'interstellar', label: '星际冷',      params: { exposure: 0.95, vignette: 0.66, grain: 0.12, aberration: 0.45, bloom: 0.55, bloomThreshold: 1.1 } },
  { id: 'kodak',        label: '柯达 5219',   params: { exposure: 1.10, vignette: 0.55, grain: 0.20, aberration: 0.90, bloom: 0.70, bloomThreshold: 1.0 } },
  { id: 'doc',          label: '纪实干净',    params: { exposure: 1.05, vignette: 0.18, grain: 0.0,  aberration: 0.0, bloom: 0.60, bloomThreshold: 1.0 } },
];

export const GUIDES = [
  { id: 'off',    label: '无' },
  { id: 'thirds', label: '三分线' },
  { id: 'golden', label: '黄金比例' },
  { id: 'cross',  label: '中心十字' },
];

// 导出水印文本(等效 EXIF)
export function buildWatermark(p, extra = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const bits = [
    'GARGANTUA-ECHO',
    `a/M ${(+p.spin).toFixed(3)}`,
    `T ${Math.round(p.diskTemperature)}K`,
    `r_in ${(+p.diskInner).toFixed(1)}M`,
    `FOV ${(+p.fov).toFixed(0)}°`,
  ];
  if (extra.size) bits.push(extra.size);
  if (extra.frames && extra.frames > 1) bits.push(`${extra.accumMode === 'le' ? 'LE' : 'TAA'} ${extra.frames}f`);
  bits.push(date);
  return bits.join(' · ');
}
