// GARGANTUA — 坠入之旅:参考 NASA 戈达德超算黑洞可视化(Schnittman & Buonanno)的脚本化游览
// 四幕:远景绕转一周 → 穿越吸积盘(短暂白屏) → 贴盘俯冲 → 坠向事件视界(黑场谢幕)。
// 相机轨迹是纯参数曲线(自身时钟按每渲染帧 dt 累加),确定性、无外部状态依赖;
// 黑场代表"越过视界"——渲染器只在视界外物理有效,真正的穿越以信号中断呈现。

// 分段缓动(与全项目同款 smoothstep 形)
const sst = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 幕间时间点(秒)。T_END 时自然收尾
const T_B = 26, T_C = 37, T_D = 58, T_FADE = 69.5, T_END = 76;
const D2R = Math.PI / 180;

// 字幕(与时间点一一对应;prog 直接给展示文案)
const CAPTIONS = [
  {
    t: 0, name: '坠入 · 第一幕 远景绕转', prog: '第 1 幕 / 共 4 幕',
    text: '旅程从约 35 个史瓦西半径外开始。先绕黑洞一周看清全貌——盘面上方那道「拱影」是盘背面被引力透镜弯过来的光。运镜参考 NASA 戈达德超算的黑洞可视化模拟。',
  },
  {
    t: T_B, name: '坠入 · 第二幕 穿越吸积盘', prog: '第 2 幕 / 共 4 幕',
    text: '低头俯冲,一头扎进气体盘。接下来的一瞬间整个视野都会被灼热等离子体淹没——现实里没有任何探测器能活着穿过它。',
  },
  {
    t: T_C, name: '坠入 · 第三幕 贴盘俯冲', prog: '第 3 幕 / 共 4 幕',
    text: '钻出盘面,贴着气体滑向黑洞。阴影边缘那圈细亮环是光子环——在它附近,光能绕黑洞转上好几圈才逃出去,或者永远出不去。',
  },
  {
    t: T_D, name: '坠入 · 第四幕 坠向视界', prog: '第 4 幕 / 共 4 幕',
    text: '最后冲刺。注意右下角的时间膨胀:在远方观察者看来,你正越来越慢、越来越红,永远冻结在视界上;但在你自己的表上,几分钟内就会安静地穿过它。',
  },
  {
    t: T_FADE, name: '终 · 越过事件视界', prog: '尾声',
    text: '最后的回头——身后的宇宙被引力压缩成一圈越来越暗的光环。信号到此为止:视界之内一切光路都指向奇点,没有任何东西能再回到宇宙。致敬 NASA Goddard 黑洞可视化模拟(Schnittman & Buonanno)。',
  },
];

// 转身看天空:终幕前段把视线从黑洞平滑转向径向外——NASA 模拟的标志性
// "回头"镜头(身后宇宙的最后一瞥),T_TURN 起 4 秒完成
const T_TURN = 65;

export class PlungeTour {
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.opts = opts; // { getDisk, onCaption(i, st), onFade(on), onDone(finished) }
    this.active = false;
    this.TOTAL = 4;
    this._t = 0;      // 自身时钟(渲染帧 dt 累加;冻结/导出期间无人推进)
    this._stage = -1; // 已触发的字幕序号
    this._faded = false;
    this._look = { x: 0, y: 0, z: 0 }; // 复用的视线目标点(主循环零分配)
  }

  start() {
    this.active = true;
    this._t = 0;
    this._stage = -1;
    this._faded = false;
    this.opts.onCaption?.(-1, null); // 清空字幕卡
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this._faded) this.opts.onFade?.(false);
  }

  // 每渲染帧推进(由 renderOne 驱动,与 cine/fly 同一驱动链)
  update(dt) {
    if (!this.active) return;
    this._t += Math.max(dt, 0);
    const t = this._t;

    // 字幕/黑场/收尾(纯时间触发,不依赖几何)
    while (this._stage + 1 < CAPTIONS.length && t >= CAPTIONS[this._stage + 1].t) {
      this._stage++;
      const st = CAPTIONS[this._stage];
      this.opts.onCaption?.(this._stage, st);
      if (st.t >= T_FADE && !this._faded) {
        this._faded = true;
        this.opts.onFade?.(true);
      }
    }
    if (t >= T_END) {
      this.active = false;
      this.opts.onDone?.(true);
      return;
    }

    // ---- 参数轨迹(四幕) ----
    const disk = this.opts.getDisk?.() || { inner: 4.91, outer: 16.5 };
    const inner = Math.max(2.2, disk.inner), outer = Math.max(inner + 2, disk.outer);

    let r, pol, om; // 半径 M / 极角 rad / 角速度 rad/s(绕转方向恒定)
    if (t < T_B) {
      // 第一幕:远景绕转一周(整圆),轻微盘旋下降
      const u = t / T_B;
      r = 36 - 4 * u;
      pol = 76 * D2R - 4 * D2R * u;
      om = 2 * Math.PI / T_B;
    } else if (t < T_C) {
      // 第二幕:俯冲穿盘。极角加速越过 90°(穿面点设计在盘内 0.95×outer 以内,
      // 白屏约 0.8s;盘参数被用户改过时按 inner/outer 自适应)
      const u = (t - T_B) / (T_C - T_B);
      const rX = Math.min(Math.max(inner * 2.2, 10), Math.max(11, outer - 1.5));
      r = 32 + (rX - 32) * Math.pow(u, 1.15);
      pol = (72 + 24 * Math.pow(u, 1.6)) * D2R; // 90° 在 u≈0.84,r≈0.82·(32-rX)+rX
      om = 0.20;
    } else if (t < T_D) {
      // 第三幕:钻出盘面,贴盘滑向黑洞
      const u = (t - T_C) / (T_D - T_C);
      const rX = Math.min(Math.max(inner * 2.2, 10), Math.max(11, outer - 1.5));
      r = rX + (8.5 - rX) * Math.pow(u, 1.1);
      pol = (96 - 20 * sst(0, 0.5, u)) * D2R;
      om = 0.17;
    } else {
      // 第四幕:加速坠向视界(止步于 2.05M = 渲染物理有效区的边缘)
      const u = (t - T_D) / (T_END - T_D);
      r = 8.5 - (8.5 - 2.05) * Math.pow(u, 1.55);
      pol = (76 - 26 * u) * D2R;
      om = 0.17 - 0.09 * u;
    }

    // 方位角:第一幕整圆,其后匀速慢转(ω 只在幕边界轻微变化,视觉连续)
    const az = -0.4 + 2 * Math.PI * Math.min(t / T_B, 1) + (t > T_B ? 0.20 * (t - T_B) : 0);

    const sp = Math.sin(pol);
    const px = this.camera.position;
    px.set(r * sp * Math.sin(az), r * Math.cos(pol), r * sp * Math.cos(az));
    // 视线:全程看向黑洞;终幕 T_TURN 起 4 秒转身背对黑洞,回头看身后的宇宙
    // (目标点从原点线性过渡到径向外 2× 位置 = 视线从 -r̂ 转到 +r̂)
    const k = sst(T_TURN, T_TURN + 4, t);
    if (k > 0) {
      const L = this._look;
      L.x = px.x * 2 * k; L.y = px.y * 2 * k; L.z = px.z * 2 * k;
      this.camera.lookAt(L.x, L.y, L.z);
    } else {
      this.camera.lookAt(0, 0, 0);
    }
  }
}
