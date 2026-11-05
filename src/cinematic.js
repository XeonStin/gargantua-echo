// GARGANTUA — 视角预设与电影镜头循环
const DEG = Math.PI / 180;

export const PRESETS = [
  { name: '远景全景', r: 26.0, polar: 83.0, az: -35.0, fov: 55 },
  { name: '赤道临界', r: 12.5, polar: 87.5, az: 25.0, fov: 52 },
  { name: '极区俯瞰', r: 19.0, polar: 22.0, az: 0.0,  fov: 60 },
  { name: '近界掠行', r: 7.8,  polar: 99.0, az: 150.0, fov: 68 },
];

export function applyPreset(i, camera, controls) {
  const p = PRESETS[i % PRESETS.length];
  const pol = p.polar * DEG, az = p.az * DEG;
  camera.position.set(
    p.r * Math.sin(pol) * Math.sin(az),
    p.r * Math.cos(pol),
    p.r * Math.sin(pol) * Math.cos(az));
  camera.fov = p.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0, 0);
  if (controls) { controls.target.set(0, 0, 0); controls.update(); }
}

// 解析轨迹:方位角匀速旋转 + 半径呼吸 + 极角摆动 + FOV 微呼吸,无缝循环
export class Cinematic {
  constructor(camera, controls, getDisk) {
    this.camera = camera;
    this.controls = controls;
    this.getDisk = getDisk; // () => { outer, thick }(盘面尺寸变了,避让半径要跟着变)
    this.duration = 96; // 秒 / 循环
    this._lastFov = 0;
  }
  update(t) {
    const u = ((t / this.duration) % 1 + 1) % 1;
    const az = 0.6 + u * Math.PI * 2;
    const r0 = 17.5 + 8.5 * Math.sin(u * Math.PI * 4 + 0.7);
    let polDeg = 78 + 20 * Math.sin(u * Math.PI * 6);
    polDeg = Math.min(101, Math.max(38, polDeg));
    const fov = 55 + 7 * Math.sin(u * Math.PI * 2);
    const pol = polDeg * DEG;
    // 盘面避让:原轨迹在极角 ~90°、r≈9-10M 时会从吸积盘内部穿过——
    // 视线起点进入体积盘,近场积分量暴涨 + 自适应频繁切分辨率 → "一卡一卡"。
    // 接近中面时把半径平滑抬到盘外缘之外(仍保留掠盘视角,只是不再穿盘)。
    const disk = this.getDisk ? this.getDisk() : { outer: 16.5, thick: 0.31 };
    const clearance = 1.0 + 1.2 * Math.max(0.05, disk.thick ?? 0.31);
    const y0 = r0 * Math.cos(pol);
    const tt = Math.min(1, Math.max(0, (Math.abs(y0) - clearance) / (clearance * 1.4)));
    const k = 1 - tt * tt * (3 - 2 * tt); // 1 = 贴中面, 0 = 远离
    const rSafe = Math.max(r0, (disk.outer ?? 16.5) + 3.0);
    const r = r0 + (rSafe - r0) * k;
    this.camera.position.set(
      r * Math.sin(pol) * Math.sin(az),
      r * Math.cos(pol),
      r * Math.sin(pol) * Math.cos(az));
    if (Math.abs(fov - this._lastFov) > 0.02) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this._lastFov = fov;
    }
    this.camera.lookAt(0, 0, 0);
  }
}
