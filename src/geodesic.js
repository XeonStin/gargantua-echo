// GARGANTUA — 测地线弹弓:点击画面发射光子扇,CPU 端用与着色器同源的
// Kerr-Schild 哈密顿方程(RK2)积分,把每颗光子的真实弯曲轨迹画成叠加线。
// 教学意义:亲眼看到光线如何被弯曲、绕行光子球、被捕获或逃逸(多像)。
import * as THREE from 'three';

const sst = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 单光子积分(KS 坐标)。返回世界坐标轨迹点数组与状态。
function integratePhoton(roW, rdW, { spin, rs, escR, diskOut, lensing = 1, maxSteps = 2600, recEvery = 2 }) {
  const M = rs * 0.5;
  const aL = spin * M;
  const aL2 = aL * aL;
  const rH = M * (1 + Math.sqrt(Math.max(1 - spin * spin, 0)));

  // 世界 → KS:(X,Y,Z) = (x, −z, y)
  const X = new THREE.Vector3(roW.x, -roW.z, roW.y);
  const d0 = new THREE.Vector3(rdW.x, -rdW.z, rdW.y);
  const k = new THREE.Vector3();
  // 度规标量场与 k 矢量(显式按位置求值,k 写入闭包供导数使用)。
  // 结果写入复用的 out 对象:积分每步调用 3 次,避免每光子上万次小对象分配触发 GC。
  const m = { r: 0, s: 0, f: 0, den: 0 };
  const metric = (P) => {
    const R2 = P.lengthSq();
    const inner = R2 - aL2;
    const sq = Math.sqrt(Math.max(inner * inner + 4 * aL2 * P.z * P.z, 0));
    const s = 0.5 * (inner + sq);
    const r = Math.sqrt(Math.max(s, 1e-6));
    const den = Math.max(sq, 1e-4);
    const D = Math.max(s * s + aL2 * P.z * P.z, 1e-4);
    m.r = r; m.s = s; m.den = den;
    m.f = 2 * M * s * r / D * lensing;
    k.set((r * P.x + aL * P.y) / (s + aL2), (r * P.y - aL * P.x) / (s + aL2), P.z / r);
  };

  // 初始协变动量:p_i = d_i + f·k_i(β + k·d),β 解自零性条件
  metric(X);
  const kd = k.dot(d0);
  const S = Math.sqrt(Math.max(1 - m.f * (1 - kd * kd), 0));
  const beta = (m.f * kd + S) / Math.max(1 - m.f, 1e-3);
  const pt = (m.f - 1) * beta + m.f * kd;
  const p = d0.clone().addScaledVector(k, m.f * (beta + kd));

  // 斜率缓存
  const mkO = () => ({ dX: new THREE.Vector3(), dp: new THREE.Vector3(), dtL: 0, r: 0,
    drd: new THREE.Vector3(), dKx: new THREE.Vector3(), dKy: new THREE.Vector3(), dKz: new THREE.Vector3(),
    t1: new THREE.Vector3() });
  const o = mkO(), o2 = mkO();

  const deriv = (Xp, p, out) => {
    metric(Xp);
    const r = m.r, s = m.s, f = m.f, den = m.den;
    const X = Xp;
    const G = -pt + k.dot(p);
    // ∂r/∂X = (X·s, Y·s, Z·(s+a²)) / (den·r)
    out.drd.set(X.x * s, X.y * s, X.z * (s + aL)).divideScalar(den * r);
    const E1 = 1 / (s + aL2);
    const u = r * X.x + aL * X.y;
    const v = r * X.y - aL * X.x;
    const kr = 2 * r * E1 * E1;
    out.dKx.copy(out.t1.set(r, aL, 0)).addScaledVector(out.drd, X.x).multiplyScalar(E1).addScaledVector(out.drd, -u * kr);
    out.dKy.copy(out.t1.set(-aL, r, 0)).addScaledVector(out.drd, X.y).multiplyScalar(E1).addScaledVector(out.drd, -v * kr);
    out.dKz.set(0, 0, 1 / r).addScaledVector(out.drd, -X.z / (r * r));
    // ∂_j G = Σ_i p_i ∂_j k_i
    const dGx = p.x * out.dKx.x + p.y * out.dKy.x + p.z * out.dKz.x;
    const dGy = p.x * out.dKx.y + p.y * out.dKy.y + p.z * out.dKz.y;
    const dGz = p.x * out.dKx.z + p.y * out.dKy.z + p.z * out.dKz.z;
    // ∂f/∂X = (∂f/∂r)·∂r/∂X + (∂f/∂Z)|r·ẑ
    const D = s * s + aL2 * X.z * X.z;
    const dfdr = 2 * M * s * (3 * D - 4 * s * s) / (D * D) * lensing;
    const dfdz = -4 * M * aL2 * X.z * r * s / (D * D) * lensing;
    out.dX.set(p.x - f * k.x * G, p.y - f * k.y * G, p.z - f * k.z * G);
    out.dp.set(
      0.5 * dfdr * out.drd.x * G * G + f * G * dGx,
      0.5 * dfdr * out.drd.y * G * G + f * G * dGy,
      0.5 * (dfdr * out.drd.z + dfdz) * G * G + f * G * dGz);
    out.dtL = -pt + f * G;
    out.r = r;
  };

  const pts = [];
  const rec = () => pts.push(X.x, X.z, -X.y); // KS → 世界:(x, z, −y)
  rec();
  let status = 'maxed';
  const Xm = new THREE.Vector3(), pm = new THREE.Vector3();
  for (let i = 0; i < maxSteps; i++) {
    deriv(X, p, o);
    const r = o.r;
    if (r < rH * 1.02) { status = 'captured'; break; }
    if (r > escR && X.dot(o.dX) > 0) { status = 'escaped'; break; }
    const dt = Math.min(3.2, Math.max(0.03, 0.16 * (r - rH * 0.9)))
      * (1 + 3 * sst(diskOut, diskOut + 14, r));
    Xm.copy(X).addScaledVector(o.dX, dt * 0.5);
    pm.copy(p).addScaledVector(o.dp, dt * 0.5);
    deriv(Xm, pm, o2);
    X.addScaledVector(o2.dX, dt);
    p.addScaledVector(o2.dp, dt);
    if (i % recEvery === 0) rec();
  }
  rec();
  return { pts, status };
}

export class GeodesicLab {
  constructor(camera) {
    this.camera = camera;
    this.scene = new THREE.Scene();
    this._fans = []; // 最多保留 3 组,便于对照不同发射点/机位的光子轨迹
    this.launchCount = 0;
    this.lastStatus = null;
    this._cA = new THREE.Color(1.0, 0.92, 0.75);   // 近相机:暖白
    this._cB = new THREE.Color(0.55, 0.75, 1.0);   // 中段/逃逸:冰蓝
    this._cC = new THREE.Color(0.95, 0.35, 0.25);  // 捕获端:红
    this._ca = new THREE.Color();
    this._cb = new THREE.Color();
  }

  get enabled() { return this._fans.length > 0; }

  clear() {
    for (const f of this._fans) {
      this.scene.remove(f);
      f.geometry.dispose();
      f.material.dispose();
    }
    this._fans.length = 0;
  }

  // 从相机经屏幕点 (ndcX, ndcY) 发射一圈光子扇
  launchFromCamera(ndcX, ndcY, { count = 21, spreadDeg = 0.9, spin = 0, rs = 2, diskOut = 22, lensing = 1 } = {}) {
    const cam = this.camera;
    const tanF = Math.tan(cam.fov * Math.PI / 360);
    // cam.aspect 失效(初始化瞬间视口为 0)时兜底
    const aspect = (isFinite(cam.aspect) && cam.aspect > 0.01)
      ? cam.aspect : (window.innerWidth / Math.max(window.innerHeight, 1) || 1);
    const basis = new THREE.Matrix3().setFromMatrix4(cam.matrixWorld);
    const rd = new THREE.Vector3(ndcX * tanF * aspect, ndcY * tanF, -1).applyMatrix3(basis).normalize();
    const ro = cam.position.clone();
    const e1 = new THREE.Vector3().crossVectors(rd, Math.abs(rd.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const e2 = new THREE.Vector3().crossVectors(rd, e1).normalize();
    const spread = spreadDeg * Math.PI / 180;
    const escR = Math.max(diskOut + 16, 46);
    const positions = [];
    const colors = [];
    const statuses = { captured: 0, escaped: 0, maxed: 0 };
    for (let j = 0; j < count; j++) {
      const ang = count > 1 ? (j / (count - 1)) * Math.PI * 2 : 0;
      const off = count > 1 ? spread : 0;
      const rdJ = rd.clone()
        .addScaledVector(e1, Math.tan(off) * Math.cos(ang))
        .addScaledVector(e2, Math.tan(off) * Math.sin(ang))
        .normalize();
      const { pts, status } = integratePhoton(ro, rdJ, { spin, rs, escR, diskOut, lensing });
      statuses[status] = (statuses[status] || 0) + 1;
      const n = pts.length / 3;
      const captured = status === 'captured';
      for (let i = 0; i < n - 1; i++) {
        const t0 = i / (n - 1), t1 = (i + 1) / (n - 1);
        positions.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5]);
        this._ca.copy(this._cA).lerp(captured ? this._cC : this._cB, t0);
        this._cb.copy(this._cA).lerp(captured ? this._cC : this._cB, t1);
        colors.push(this._ca.r, this._ca.g, this._ca.b, this._cb.r, this._cb.g, this._cb.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    // 保留最近 3 组:发射后拖拽观察旧轨迹时,旧扇不会因为下一次发射而消失
    this._fans.push(lines);
    this.scene.add(lines);
    while (this._fans.length > 3) {
      const old = this._fans.shift();
      this.scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
    // 越旧越淡(最新 0.85 / 次新 0.5 / 最旧 0.28),避免多组叠加糊成一片
    const op = [0.28, 0.5, 0.85];
    for (let i = 0; i < this._fans.length; i++) {
      this._fans[i].material.opacity = op[Math.max(0, op.length - this._fans.length + i)];
    }
    this.launchCount++;
    this.lastStatus = statuses;
    return { count, statuses, fans: this._fans.length };
  }

  // 合成 pass 之后叠加渲染(同画布,不清屏)
  renderWith(renderer, camera) {
    if (this._fans.length) renderer.render(this.scene, camera);
  }
}
