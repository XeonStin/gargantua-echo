// GARGANTUA — 参数分享码:把参数/相机/画质/种子打包成短 base64url,挂到 ?s= 一键分享
export function encodeShare({ params, quality, seed, longExposure, exposureFrames, accumMode, photoAdj, mode, cam, toggles }) {
  const obj = {
    v: 1,
    p: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, +(+v).toFixed(4)])),
    q: quality === 'safemode' ? 'high' : quality,
    sd: seed,
    le: longExposure ? 1 : 0,
    lf: exposureFrames,
    lm: accumMode === 'le' ? 'le' : 'taa',
    m: mode,
    c: [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2), +cam.fov.toFixed(1)],
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
    cam: { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov },
  });
  return `${base}?s=${code}`;
}
