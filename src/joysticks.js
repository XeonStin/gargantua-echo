// GARGANTUA — 移动端飞行双摇杆:左 = 俯仰/滚转,右 = 进退/偏航
// 浮动摇杆:按住哪半边屏幕,底座就出现在哪里;多点触控各管各的,松手归零。
// 层只在「触摸设备 + 飞行模式」启用(由 main 控制),盖住画布但不遮 HUD(z 序 8 < 10)。
const R = 52; // 摇杆最大行程(px)

export class TouchSticks {
  constructor(opts = {}) {
    this.opts = opts; // { onAxes({pitch, roll, yaw, thrust}) }
    this.enabled = false;
    this._l = null; this._r = null; // {id, x0, y0, dx, dy}
    this._build();
  }

  _build() {
    const layer = document.createElement('div');
    layer.id = 'joysticks';
    layer.innerHTML = `
      <div class="stick" id="stick-l"><div class="stick-base"></div><div class="stick-knob"></div></div>
      <div class="stick" id="stick-r"><div class="stick-base"></div><div class="stick-knob"></div></div>`;
    document.body.appendChild(layer);
    this.layer = layer;
    this._elL = layer.querySelector('#stick-l');
    this._elR = layer.querySelector('#stick-r');

    layer.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      const left = e.clientX < innerWidth / 2;
      const cur = left ? this._l : this._r;
      if (cur) return; // 该侧摇杆已被占用
      const s = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
      if (left) this._l = s; else this._r = s;
      try { layer.setPointerCapture(e.pointerId); } catch { /* 不支持也无碍 */ }
      this._show(left, s);
      e.preventDefault();
    });
    layer.addEventListener('pointermove', (e) => {
      const s = (this._l && this._l.id === e.pointerId) ? this._l
        : (this._r && this._r.id === e.pointerId) ? this._r : null;
      if (!s) return;
      let dx = e.clientX - s.x0, dy = e.clientY - s.y0;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      s.dx = dx; s.dy = dy;
      this._show(s === this._l, s);
      this._emit();
      e.preventDefault();
    });
    const up = (e) => {
      if (this._l && this._l.id === e.pointerId) { this._l = null; this._hide(this._elL); }
      if (this._r && this._r.id === e.pointerId) { this._r = null; this._hide(this._elR); }
      this._emit();
    };
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.layer.style.display = this.enabled ? 'block' : 'none';
    if (!this.enabled) {
      this._l = null; this._r = null;
      this._hide(this._elL); this._hide(this._elR);
    }
  }

  _show(left, s) {
    const el = left ? this._elL : this._elR;
    el.style.display = 'block';
    el.style.transform = `translate(${s.x0}px, ${s.y0}px)`;
    el.querySelector('.stick-knob').style.transform = `translate(${s.dx}px, ${s.dy}px)`;
  }

  _hide(el) {
    el.style.display = 'none';
    el.querySelector('.stick-knob').style.transform = 'translate(0px, 0px)';
  }

  // 归一化轴 [-1,1] → flight.axes。方向约定:
  // 左摇杆:上推抬头(pitch +)· 左右压坡滚转(推右 = 向右滚转,与 E 键同向)
  // 右摇杆:上推前进(thrust +)· 左右偏航(推右 = 右转,yaw −)
  _emit() {
    const l = this._l, r = this._r;
    this.opts.onAxes?.({
      pitch: l ? -(l.dy / R) : 0,
      roll: l ? -(l.dx / R) : 0,
      yaw: r ? -(r.dx / R) : 0,
      thrust: r ? -(r.dy / R) : 0,
    });
  }
}
