// GARGANTUA — 自由飞行模式:第一人称驾驶靠近黑洞
// WASD 移动 · R/F 升降 · Q/E 滚转 · 拖拽环视 · 滚轮调速
// 与 OrbitControls 完全独立:进入时接管相机位姿,退出时把视角交还给轨道模式。
import * as THREE from 'three';

export class Flight {
  constructor(camera, canvas, events = {}) {
    this.camera = camera;
    this.canvas = canvas;
    this.events = events; // { onWarn(msg), onSpeed(mul) }
    this.active = false;
    this.keys = new Set();
    this.vel = new THREE.Vector3();
    this.speedMul = 1.0;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.locked = false;    // 不再使用 pointer lock:拖拽才转视角,鼠标空闲时可点 UI
    this._drag = null;      // 拖拽环视
    this._warned = false;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this._eul = new THREE.Euler(0, 0, 0, 'YXZ');

    this._onKey = (e) => {
      if (!this.active) return;
      if (e.type === 'keydown') this.keys.add(e.code);
      else this.keys.delete(e.code);
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);

    // 拖拽环视:鼠标按下并移动才转视角(pointer lock 会让鼠标消失、无法点按钮)
    this._onPointerDown = (e) => {
      if (!this.active) return;
      this._drag = { x: e.clientX, y: e.clientY };
    };
    this._onPointerMove = (e) => {
      if (!this.active || !this._drag) return;
      this._look((e.clientX - this._drag.x) * 1.6, (e.clientY - this._drag.y) * 1.6);
      this._drag = { x: e.clientX, y: e.clientY };
    };
    this._onPointerUp = () => { this._drag = null; };
    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    this._onWheel = (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.speedMul = Math.min(8, Math.max(0.15, this.speedMul * (e.deltaY > 0 ? 0.85 : 1.18)));
      this.events.onSpeed?.(this.speedMul);
    };
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _look(dx, dy) {
    this.yaw -= dx * 0.0032;
    this.pitch = Math.min(1.45, Math.max(-1.45, this.pitch - dy * 0.0032));
  }

  enter() {
    this.active = true;
    this.vel.set(0, 0, 0);
    this.keys.clear();
    this._warned = false;
    this.camera.quaternion.normalize();
    this._eul.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this._eul.y;
    this.pitch = this._eul.x;
    this.roll = this._eul.z;
    this._applyRotation();
    this.speedMul = 1.0;
  }

  leave() {
    this.active = false;
    this.keys.clear();
    this.vel.set(0, 0, 0);
    this._drag = null;
  }

  _applyRotation() {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, this.roll);
  }

  // 每帧推进;返回当前 r(供 HUD 时间膨胀显示)
  update(dt, minR) {
    if (!this.active) return this.camera.position.length();
    const K = this.keys;
    // 基础速度随距离增长但封顶(否则远飞时"距离↑→速度↑"正反馈,几帧就冲出上百 M)
    const spd = (5 + 0.3 * Math.min(this.camera.position.length(), 60)) * this.speedMul;
    const q = this.camera.quaternion;
    this._fwd.set(0, 0, -1).applyQuaternion(q);
    this._right.set(1, 0, 0).applyQuaternion(q);
    const acc = this._acc.set(0, 0, 0);
    if (K.has('KeyW')) acc.add(this._fwd);
    if (K.has('KeyS')) acc.sub(this._fwd);
    if (K.has('KeyD')) acc.add(this._right);
    if (K.has('KeyA')) acc.sub(this._right);
    if (K.has('KeyR')) acc.y += 1;
    if (K.has('KeyF')) acc.y -= 1;
    if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(spd * 6.5);
    // Q/E 滚转(按角速度积分,与帧率无关;环绕 ±π)
    if (K.has('KeyQ')) this.roll += 1.5 * dt;
    if (K.has('KeyE')) this.roll -= 1.5 * dt;
    if (Math.abs(this.roll) > Math.PI) {
      const TAU = Math.PI * 2;
      this.roll = ((this.roll + Math.PI) % TAU + TAU) % TAU - Math.PI;
    }
    // 固定子步积分(≤1/60s):帧率无关;主循环卡顿时 dt 可达 0.1s,
    // 单步积分会削阻尼+放大位移导致"瞬移",子步后速度/位移与真实时间一致
    const steps = Math.max(1, Math.min(6, Math.ceil(dt / (1 / 60))));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel.addScaledVector(acc, h);
      this.vel.multiplyScalar(Math.exp(-h * 5.5)); // 阻尼
      this.camera.position.addScaledVector(this.vel, h);
    }
    // 速度上限兜底(理论终端 ≈ spd·6.5/5.5,远场封顶后约 27·speedMul)
    const vmax = 30 * this.speedMul;
    if (this.vel.length() > vmax) this.vel.setLength(vmax);
    // 不得进入视界:软推回 + 一次性告警(minR 由 main 按当前自旋计算)
    const p = this.camera.position;
    const r = p.length();
    if (r < minR) {
      p.multiplyScalar(minR / Math.max(r, 1e-4));
      this.vel.multiplyScalar(0.2);
      if (!this._warned) {
        this._warned = true;
        this.events.onWarn?.(`已抵达安全边界 r = ${minR.toFixed(2)} M — 再往前就是视界内部(设置面板可调边界)`);
      }
    } else if (r > minR + 2) {
      this._warned = false;
    }
    this._applyRotation();
    return p.length();
  }
}
