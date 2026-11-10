// GARGANTUA — 坠入之旅:参考 NASA Goddard 超算黑洞可视化(Schnittman & Buonanno)
// 真实测地线版:相机沿 Schwarzschild 束缚轨道积分——初速只略微偏离黑洞中心,
// 被引力俘获后,角动量缓慢耗散(模拟气体阻力/引力波),螺旋绕转逐圈衰减,最终坠入视界。
// 视线始终朝向速度方向(用户设定);不真正穿越视界(渲染器只在 r>r_s 物理有效),
// 黑场 = 信号中断的叙事表达。
//
// 轨道方程(坐标时,G=c=M=1,r_s=2):
//   dr/dt = s·(1−2/r)·√(E²−V(r,L)),  dφ/dt = (1−2/r)·L/(E·r²)
//   V(r,L) = (1−2/r)(1+L²/r²)
// 耗散:dL/dt = −kL·L/r²,dE/dt = −kE·E/r³(数值调参:kL=0.008 → 75s 内 4.3 圈,
// 近点序列 7.6→6.9→6.6→6.2→5.8→5.3→4.7→坠入,见 TESTREPORT §27)。

const D2R = Math.PI / 180;
const INC = 20 * D2R;          // 轨道面相对盘面倾角:决定穿盘节奏(每圈两次,短暂白屏)
const K_L = 0.008, K_E = 0.00016; // 耗散系数(调参值,勿随意改——圈数/坠入时机由它决定)
const T_SCALE = 6.2;           // 坐标时间(M)→ 墙钟秒
const E0 = 0.97, L0 = 4.0;     // 束缚轨道(比抛物线略慢 → 天然"被俘获"),L 临界约 3.7
const R_START = 20;            // 启程半径
const R_FADE = 2.55;           // 黑场起点
const R_END = 2.10;            // 收尾半径(贴视界,渲染物理有效区边缘)
const T_END = 95;              // 保险丝:无论轨迹如何,95s 必收尾

// 事件字幕:按轨迹事件(穿盘/半径阈值)触发,与实际飞行同步
const CAPTIONS = [
  {
    name: '坠入 · 启程', prog: '捕获',
    text: '从 20 个史瓦西半径外飞向黑洞——速度只偏离中心一点点。正是这点微小的偏移,让引力没有直接吞下你,而是将你俘获成一场缓缓衰减的螺旋。全程视线朝向飞行的方向。运镜参考 NASA Goddard 超算模拟。',
  },
  {
    name: '坠入 · 穿越吸积盘', prog: '穿盘',
    text: '穿过气体盘!一瞬间整个视野都是灼热等离子体——现实里没有任何探测器能活着经历这一切。',
  },
  {
    name: '坠入 · 螺旋绕行', prog: '绕行',
    text: '每绕一圈都更低、更快——测地线正把你拧进引力井。盘面上下翻转着掠过,阴影边缘的光子环近在咫尺。',
  },
  {
    name: '坠入 · 最后的圈', prog: '坠落',
    text: '轨道再也托不住你了。在远方观察者看来,你正越来越慢、越来越红,永远冻结在视界上;但在你自己的表上,穿过它只需片刻。',
  },
  {
    name: '终 · 越过事件视界', prog: '尾声',
    text: '——信号到此为止。视界之内一切光路都指向奇点,没有任何东西能再回到宇宙。致敬 NASA Goddard 黑洞可视化模拟(Schnittman & Buonanno)。',
  },
];

// 分段缓动(与全项目同款)
const sst = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class PlungeTour {
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.opts = opts; // { getDisk, onCaption(i, st), onFade(on), onDone(finished) }
    this.active = false;
    this.TOTAL = 4;
    this._look = { x: 0, y: 0, z: 0 }; // 复用视线目标(主循环零分配)
    this._vel = { x: 0, y: 0, z: 0 };
    this._reset();
  }

  _reset() {
    this._t = 0;      // 自身时钟(墙钟秒,渲染帧 dt 累加)
    this._r = R_START;
    this._phi = 0.15; // 起始方位(略过节点线,起步在盘面下方一点)
    this._E = E0;
    this._L = L0;
    this._s = -1;     // 径向方向:-1 向内 / +1 向外(近点/远点折返)
    this._stage = -1; // 已触发字幕
    this._faded = false;
    this._passages = 0; // 节点穿越计数(穿盘字幕用)
  }

  start() {
    this.active = true;
    this._reset();
    this.opts.onCaption?.(-1, null); // 清空字幕卡
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this._faded) this.opts.onFade?.(false);
  }

  // 测试/自动化钩子:按 1/60 步进快进到目标墙钟秒(轨道状态真实积分推进,
  // 字幕/黑场/收尾事件照常触发)。仅自动化使用。
  seek(sec) {
    if (!this.active) return 0;
    const target = Math.max(0, +sec || 0);
    let guard = 0;
    while (this._t < target && this.active && guard++ < 20000) this.update(1 / 60);
    return +this._t.toFixed(2);
  }

  // 每渲染帧推进(由 renderOne 驱动):积分坐标时测地线 + 事件字幕
  update(dtWall) {
    if (!this.active) return;
    const dt = Math.max(dtWall, 0);
    this._t += dt;
    if (this._t > T_END) {
      this.active = false;
      this.opts.onDone?.(true);
      return;
    }

    const dtM = dt * T_SCALE; // 本帧坐标时间步长(M)
    // 自适应子步:限制单步角/径向增量,绕行段高速掠过时不失真
    const w = Math.abs((1 - 2 / this._r) * this._L / (this._r * this._r));
    const n = Math.max(1, Math.min(48, Math.ceil(w * dtM / 0.03)));
    const h = dtM / n;
    for (let i = 0; i < n; i++) {
      let sq = this._E * this._E - (1 - 2 / this._r) * (1 + this._L * this._L / (this._r * this._r));
      if (sq <= 1e-9) { this._s = -this._s; sq = 0; } // 近点/远点折返
      const v = Math.sqrt(sq);
      const k1r = this._s * (1 - 2 / this._r) * v;
      const k1p = (1 - 2 / this._r) * this._L / (this._r * this._r);
      const rm = Math.max(this._r + k1r * h * 0.5, 1.5);
      let sqm = this._E * this._E - (1 - 2 / rm) * (1 + this._L * this._L / (rm * rm));
      if (sqm <= 0) sqm = 0;
      const k2r = this._s * (1 - 2 / rm) * Math.sqrt(sqm);
      const k2p = (1 - 2 / rm) * this._L / (rm * rm);
      this._r += k2r * h;
      this._phi += k2p * h;
      // 耗散(坐标时):角动量/能量缓降 → 螺旋逐圈衰减
      this._L -= K_L * this._L / (this._r * this._r) * h;
      this._E -= K_E * this._E / (this._r * this._r * this._r) * h;
      if (this._r <= R_END) break;
    }

    // ---- 轨道面 → 世界坐标(盘面 = xz,轨道面绕 X 轴倾斜 INC) ----
    const r = this._r, sp = Math.sin(this._phi), cp = Math.cos(this._phi);
    const px = r * cp, py = -r * sp * Math.sin(INC), pz = r * sp * Math.cos(INC);
    // 速度方向(解析):dr/dt 与 dφ/dt 合成,用于"视线朝向速度"
    let sq2 = this._E * this._E - (1 - 2 / r) * (1 + this._L * this._L / (r * r));
    if (sq2 < 0) sq2 = 0;
    const drdt = this._s * (1 - 2 / r) * Math.sqrt(sq2);
    const dphidt = (1 - 2 / r) * this._L / (r * r);
    const vx = drdt * cp - r * dphidt * sp;
    const vy = -(drdt * sp + r * dphidt * cp) * Math.sin(INC);
    const vz = (drdt * sp + r * dphidt * cp) * Math.cos(INC);

    this.camera.position.set(px, py, pz);
    const L3 = this._look, V3 = this._vel;
    V3.x = vx; V3.y = vy; V3.z = vz;
    const vl = Math.hypot(V3.x, V3.y, V3.z) || 1;
    // 视线 = 位置 + 单位速度 ×5(远处目标点,lookAt 平稳)
    L3.x = px + (V3.x / vl) * 5;
    L3.y = py + (V3.y / vl) * 5;
    L3.z = pz + (V3.z / vl) * 5;
    this.camera.lookAt(L3.x, L3.y, L3.z);

    // ---- 事件字幕 / 黑场 / 收尾 ----
    const node = Math.floor(this._phi / Math.PI);
    if (node > this._passages) {
      this._passages = node;
      const disk = this.opts.getDisk?.() || { inner: 4.91, outer: 16.5 };
      if (this._stage < 1 && r < (disk.outer ?? 16.5) * 0.95 && r > (disk.inner ?? 4.91) * 0.55) {
        this._fire(1); // 穿越吸积盘
      }
    }
    if (this._stage < 2 && r < 6) this._fire(2);          // 螺旋绕行
    if (this._stage < 3 && r < 3.05) this._fire(3);       // 最后的圈
    if (this._stage < 4 && r < R_FADE) {                  // 终章 + 黑场
      this._fire(4);
      this._faded = true;
      this.opts.onFade?.(true);
    }
    if (r <= R_END) {
      this.active = false;
      this.opts.onDone?.(true);
    }
  }

  _fire(i) {
    if (i <= this._stage) return;
    this._stage = i;
    this.opts.onCaption?.(i, CAPTIONS[i]);
  }
}
