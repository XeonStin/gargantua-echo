// GARGANTUA — 导览模式:7 站自动之旅,每站飞行到对应视角/参数并配中文字幕
// 拖拽可随时打断飞行(字幕仍在);「下一站」继续。完成全部站点触发成就。
const DEG = Math.PI / 180;

export const TOUR_STATIONS = [
  {
    name: '1 · 欢迎来到 Gargantua-Echo',
    text: '这不是贴图,也不是建模——你看到的每一束光都在实时求解史瓦西时空的零测地线。' +
          '中央的黑影是「阴影」,边缘那圈细亮环是光子环。拖动画面环视,滚轮推近。',
    cam: { r: 26, polar: 83, az: -35, fov: 55 }, params: {},
  },
  {
    name: '2 · 光子环与阴影',
    text: '在 r = 3M 的「光子球」上,光可以绕黑洞转圈。刚好擦过光子球再逃出来的光,勾出了阴影的边界:' +
          'b_c = √27·M ≈ 5.196M。阴影直径比视界大一倍多——弯曲的时空替黑洞"撑大"了影子。',
    cam: { r: 13.5, polar: 84, az: 10, fov: 42 }, params: {},
  },
  {
    name: '3 · 吸积盘与 ISCO',
    text: '发光的盘是吸积盘:6M 以内(ISCO,最内稳定圆轨道)不存在稳定圆轨道,盘从此处向外延伸。' +
          '温度随半径下降(T ∝ r^-3/4),内缘最热最亮。把「峰值温度」调高试试——盘会变蓝。',
    cam: { r: 15, polar: 76, az: 45, fov: 55 },
    params: { diskTemperature: 8200, turbulence: 0.75 },
  },
  {
    name: '4 · 多普勒增亮',
    text: '盘以近光速旋转:朝你而来的一侧被相对论多普勒增亮并蓝移,远离的一侧变暗变红。' +
          '这就是画面左右不对称的原因——黑洞没有"正脸照"。',
    cam: { r: 12, polar: 87, az: 200, fov: 50 },
    params: { dopplerBeaming: 1.6, dopplerColor: 1.0 },
  },
  {
    name: '5 · 引力透镜',
    text: '盘的"背后"在画面里弯到了上下方——那不是两个盘,是同一张盘的光绕过黑洞进入你的眼睛。' +
          '背景星空也被拉成弧。把「透镜强度」调到 0 再调回 1,感受时空弯曲的份量。',
    cam: { r: 14, polar: 70, az: 120, fov: 60 },
    params: { dopplerBeaming: 1.0, dopplerColor: 0.85 },
  },
  {
    name: '6 · 长曝光与 TAA',
    text: '现在开启了长曝光(帧累积):镜头运动把星光和光子环拉成弧形光轨,噪声被时间平均——' +
          '黑洞也可以"拍星轨"。设置里的累积模式可切到 TAA:静止时累积亚像素样本抗锯齿,' +
          '一移动视角就丢弃历史,不会拖影。',
    cam: { r: 18, polar: 55, az: 300, fov: 55 },
    params: {}, le: { on: true, frames: 24, mode: 'le' },
  },
  {
    name: '7 · 时间膨胀',
    text: '右下角的 g(∞) 是引力时间膨胀:离黑洞越近,你的 1 小时 = 远处观察者的更多小时。' +
          '《星际穿越》米勒星球上的"一小时七年"就是这个公式的极端版。导览结束——去设置面板里玩吧!',
    cam: { r: 8.5, polar: 80, az: 330, fov: 60 },
    params: { diskTemperature: 6400, turbulence: 0.6 }, le: { on: false, mode: 'taa' },
  },
];

const AUTO_ADVANCE = 15;   // 秒/站(可被用户打断)
const TWEEN_TIME = 3.2;    // 相机飞行时长

export class Tour {
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.opts = opts; // { onStation(i, st), onStop(i), onComplete() }
    this.active = false;
    this.station = 0;
    this._tween = null;   // {t0, from:{pos,fov}, to:{pos,fov}}
    this._auto = 0;       // 自动推进计时
    this._paused = false; // 用户拖拽后暂停自动推进
    this._visited = new Set();
    this._pos = new (camera.position.constructor)();
  }

  get progress() { return this._visited.size; }
  get TOTAL() { return TOUR_STATIONS.length; }

  start(from = 0) {
    this.active = true;
    this._paused = false;
    this.goto(from | 0);
  }

  stop() {
    this.active = false;
    this._tween = null;
    this.opts.onStop?.(this.station);
  }

  goto(i) {
    if (!this.active) return;
    const n = TOUR_STATIONS.length;
    this.station = ((i % n) + n) % n;
    this._visited.add(this.station);
    const st = TOUR_STATIONS[this.station];
    // 参数
    for (const [k, v] of Object.entries(st.params || {})) this.opts.onParam?.(k, v);
    if (st.le) this.opts.onLongExposure?.(st.le.on, st.le.frames, st.le.mode);
    // 相机飞行
    const pol = st.cam.polar * DEG, az = st.cam.az * DEG;
    this._pos.set(
      st.cam.r * Math.sin(pol) * Math.sin(az),
      st.cam.r * Math.cos(pol),
      st.cam.r * Math.sin(pol) * Math.cos(az));
    this._tween = {
      t: 0,
      fromPos: this.camera.position.clone(),
      fromFov: this.camera.fov,
      toPos: this._pos.clone(),
      toFov: st.cam.fov,
    };
    this._auto = 0;
    this.opts.onStation?.(this.station, st);
  }

  next() { this._paused = false; this.goto(this.station + 1); }
  prev() { this._paused = false; this.goto(this.station - 1); }
  // 用户拖拽:打断当前飞行与自动推进(字幕保留)
  interrupt() { this._tween = null; this._paused = true; }

  update(dt) {
    if (!this.active) return false;
    if (this._tween) {
      this._tween.t += dt / TWEEN_TIME;
      const u = Math.min(1, this._tween.t);
      const e = u * u * (3 - 2 * u);
      this.camera.position.lerpVectors(this._tween.fromPos, this._tween.toPos, e);
      this.camera.fov = this._tween.fromFov + (this._tween.toFov - this._tween.fromFov) * e;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(0, 0, 0);
      if (u >= 1) this._tween = null;
    } else if (!this._paused) {
      this._auto += dt;
      if (this._auto >= AUTO_ADVANCE) {
        if (this._visited.size >= TOUR_STATIONS.length) {
          this.opts.onComplete?.();
          this.stop();
        } else {
          this.next();
        }
      }
    }
    return true;
  }
}
