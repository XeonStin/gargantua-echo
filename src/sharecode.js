// GARGANTUA — 参数分享码:把参数/相机/画质/种子打包成短 base64url,挂到 ?s= 一键分享
// 飞行模式分享码:c = [x, y, z, fov, yaw, pitch, roll](7 元素,含 QE 滚转);
// 旧码 4 元素 [x, y, z, fov] 仍兼容,解码端按长度区分。
import * as THREE from 'three';

export function encodeShare({ params, quality, seed, longExposure, exposureFrames, accumMode, photoAdj, mode, cam, toggles }) {
  const c = [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2), +cam.fov.toFixed(1)];
  if (mode === 'fly' && isFinite(cam.yaw) && isFinite(cam.pitch) && isFinite(cam.roll)) {
    c.push(+cam.yaw.toFixed(3), +cam.pitch.toFixed(3), +cam.roll.toFixed(3));
  }
  const obj = {
    v: 1,
    p: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, +(+v).toFixed(4)])),
    q: quality === 'safemode' ? 'high' : quality,
    sd: seed,
    le: longExposure ? 1 : 0,
    lf: exposureFrames,
    lm: accumMode === 'le' ? 'le' : 'taa',
    m: mode,
    c,
  };
  if (toggles) obj.t = toggles;
  if (photoAdj) {
    const pa = {
      b: +photoAdj.brightness, c: +photoAdj.contrast,
      s: +photoAdj.saturation, t: +photoAdj.temperature,
    };
    // 全中性不写,保持旧分享码长度
    if (pa.b !== 1 || pa.c !== 1 || pa.s !== 1 || pa.t !== 0) obj.pa = pa;
  }
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const obj = JSON.parse(atob(b64));
    if (!obj || obj.v !== 1 || typeof obj.p !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

export function buildShareURL(state, camera) {
  const base = location.origin + location.pathname;
  // 飞行模式带完整朝向(含 QE 滚转):YXZ 欧拉,与 flight.js 的 yaw/pitch/roll 同序
  const cam = { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov };
  if (state.mode === 'fly') {
    const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    cam.yaw = eul.y; cam.pitch = eul.x; cam.roll = eul.z;
  }
  const code = encodeShare({
    params: state.params, quality: state.quality, seed: state.seed,
    longExposure: state.longExposure, exposureFrames: state.exposureFrames,
    accumMode: state.accumMode,
    photoAdj: state.photoAdj,
    mode: state.mode === 'cine' ? 'orbit' : state.mode, // 分享静态视角,不给对方强开循环
    toggles: {
      vd: state.volDisk ? 1 : 0,
      an: state.annotations ? 1 : 0, eht: state.eht ? 1 : 0,
      fg: state.filmGrade ? 1 : 0, rc: state.refColor ? 1 : 0,
      wm: state.watermark ? 1 : 0, ga: state.geoArmed ? 1 : 0,
    },
    cam,
  });
  return `${base}?s=${code}`;
}
