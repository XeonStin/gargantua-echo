// GARGANTUA — 物理标注:把阴影/光子环/ISCO/视界的理论位置投影到屏幕上(SVG 叠加)
// 光子 b = |x×v| 守恒:阴影边界 b_c = √27·M ≈ 5.196M → sinψ = b_c/d
import { iscoRadius, horizonRadius } from './engine.js';

export class Annotations {
  constructor() {
    this._visible = false;
    this._vec = null;
    this._v = null;
    this._build();
  }

  _build() {
    const host = document.getElementById('anno');
    if (!host) return;
    host.innerHTML = `
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <circle id="an-shadow" fill="none" vector-effect="non-scaling-stroke"/>
        <circle id="an-horizon" fill="none" vector-effect="non-scaling-stroke" stroke-dasharray="4 3"/>
        <path id="an-isco" fill="none" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="anno-labels">
        <div class="anno-label" id="an-lshadow"></div>
        <div class="anno-label" id="an-lhorizon"></div>
        <div class="anno-label" id="an-lisco"></div>
        <div class="anno-label" id="an-ldisk"></div>
      </div>`;
    this.el = host;
    this.shadowC = host.querySelector('#an-shadow');
    this.horizonC = host.querySelector('#an-horizon');
    this.iscoP = host.querySelector('#an-isco');
    this.lShadow = host.querySelector('#an-lshadow');
    this.lHorizon = host.querySelector('#an-lhorizon');
    this.lIsco = host.querySelector('#an-lisco');
    this.lDisk = host.querySelector('#an-ldisk');
  }

  set visible(v) {
    this._visible = !!v;
    if (this.el) this.el.classList.toggle('on', !!v);
  }
  get visible() { return this._visible; }

  // 每帧调用。圆的方向半径 ψ 换算到屏幕:rx_pct = tanψ/(tanF·aspect)·50,ry_pct = tanψ/tanF·50
  update(cam, { spin = 0, rs = 2, diskIn = 4.2, diskOut = 22 } = {}) {
    if (!this.el || !this._visible) return;
    // 静止画面跳过重建:相机位置/朝向/FOV/纵横比与盘参数都没变时,投影结果完全一致。
    // TAA 静止观察是常态,重建是 97 段 path 字符串 + 十余次 DOM 写;飞行模式拖拽环视
    // 只转不移,位置不变,必须连四元数一起比对才不漏更新。
    if (!this._lp) this._lp = new cam.position.constructor();
    if (this._hasSig &&
        this._lp.distanceToSquared(cam.position) < 1e-10 &&
        Math.abs(this._lqx - cam.quaternion.x) < 1e-6 &&
        Math.abs(this._lqy - cam.quaternion.y) < 1e-6 &&
        Math.abs(this._lqz - cam.quaternion.z) < 1e-6 &&
        Math.abs(this._lqw - cam.quaternion.w) < 1e-6 &&
        this._lfov === cam.fov && this._lasp === cam.aspect &&
        this._lspin === spin && this._ldin === diskIn && this._ldout === diskOut) return;
    this._hasSig = true;
    this._lp.copy(cam.position);
    this._lqx = cam.quaternion.x; this._lqy = cam.quaternion.y;
    this._lqz = cam.quaternion.z; this._lqw = cam.quaternion.w;
    this._lfov = cam.fov; this._lasp = cam.aspect;
    this._lspin = spin; this._ldin = diskIn; this._ldout = diskOut;
    // 主循环在 renderOne 之前调本函数:位置/四元数刚被 cine/fly/controls 更新,
    // 但 matrixWorld(Inverse) 还是上一帧渲染的旧矩阵 → 投影滞后 1-2 帧。
    // 这里就地刷新(仅运动时走到,静止被上方跳过;每 2 帧一次 4×4 求逆可忽略)。
    cam.updateMatrixWorld();
    if (!this._vec) {
      this._vec = new cam.position.constructor();
      this._v = new cam.position.constructor();
    }
    const M = rs / 2;
    const d = cam.position.length();
    const tanF = Math.tan(cam.fov * Math.PI / 360);
    // cam.aspect 在初始化瞬间可能为 0(嵌入式窗格),兜底用窗口尺寸
    const aspect = (isFinite(cam.aspect) && cam.aspect > 0.01)
      ? cam.aspect : (window.innerWidth / Math.max(window.innerHeight, 1) || 1);

    // 黑洞中心(原点)投到屏幕
    this._vec.copy(cam.position).multiplyScalar(-1)
      .applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    const cxPct = (this._vec.x / this._vec.w) * 50 + 50;
    const cyPct = 50 - (this._vec.y / this._vec.w) * 50;
    const circle = (elm, psi) => {
      const t = Math.tan(psi) / tanF;
      elm.setAttribute('cx', cxPct.toFixed(2));
      elm.setAttribute('cy', cyPct.toFixed(2));
      elm.setAttribute('rx', (t / aspect * 50).toFixed(3));
      elm.setAttribute('ry', (t * 50).toFixed(3));
    };

    // 阴影/光子环:b = √27·M(与积分器同口径:b = |x×v|)
    const bc = Math.sqrt(27) * M;
    circle(this.shadowC, Math.asin(Math.min(1, bc / Math.max(d, bc * 1.0001))));

    // 视界球剪影:sinα = r+/d(虚线)
    const rH = horizonRadius(spin, rs);
    circle(this.horizonC, Math.asin(Math.min(1, rH / Math.max(d, rH * 1.0001))));

    // ISCO 圆(赤道面) → 投影折线
    const ri = iscoRadius(spin, rs);
    let path = '';
    let pen = false;
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      this._v.set(ri * Math.cos(a), 0, ri * Math.sin(a))
        .applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
      if (this._v.w <= 0.001) { pen = false; continue; }
      const x = (this._v.x / this._v.w) * 50 + 50;
      const y = 50 - (this._v.y / this._v.w) * 50;
      path += (pen ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
      pen = true;
    }
    this.iscoP.setAttribute('d', path.trim());

    // 标签
    const g = Math.sqrt(Math.max(0, 1 - rs / d));
    this.lShadow.textContent = `阴影 / 光子环 b_c = √27·M ≈ ${bc.toFixed(2)} M` +
      (spin > 0.001 ? '(Schwarzschild 口径近似;Kerr 高自旋为 D 形)' : '');
    this.lHorizon.textContent = `事件视界 r+ = ${rH.toFixed(2)} M${spin > 0.001 ? '(Kerr)' : ''}`;
    this.lIsco.textContent = `ISCO r = ${ri.toFixed(2)} M`;
    this.lDisk.textContent = `吸积盘 ${diskIn.toFixed(1)}–${diskOut.toFixed(1)} M · g(∞) = ${g.toFixed(2)}`;
  }
}
