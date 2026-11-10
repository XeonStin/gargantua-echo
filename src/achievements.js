// GARGANTUA — 成就系统:13 项,localStorage 持久化,解锁即 toast
const LS_KEY = 'gargantua53f.ach.v1';

export const ACH_DEFS = [
  { id: 'first',       name: '初见视界',     desc: '第一次看到黑洞' },
  { id: 'photon',      name: '光子球掠行',   desc: '贴近到距黑洞 4.5M 以内' },
  { id: 'polar',       name: '极区勘察',     desc: '切换到「极区俯瞰」预设' },
  { id: 'graze',       name: '近界掠行',     desc: '切换到「近界掠行」预设' },
  { id: 'flyer',       name: '贴地飞行',     desc: '飞行模式进入 6M 以内' },
  { id: 'lighttrails', name: '光轨大师',     desc: '长曝光 ≥32 帧累计 15 秒' },
  { id: 'shutter',     name: '快门手',       desc: '保存 10 张截图' },
  { id: 'tinkerer',    name: '调参狂人',     desc: '累计调整 100 次参数' },
  { id: 'views',       name: '全景观察者',   desc: '看遍全部 10 个调试视图' },
  { id: 'slinger',     name: '弹弓手',       desc: '发射 5 次光子扇' },
  { id: 'scholar',     name: '学者',         desc: '完成导览全部 7 站' },
  { id: 'cinephile',   name: '影院观众',     desc: '完整看完一循环 96s 电影镜头' },
  { id: 'astrophys',   name: '天体物理学家', desc: '把自旋推到 0.9 以上' },
];

export class Achievements {
  constructor(onUnlock) {
    this.onUnlock = onUnlock || (() => {});
    this.unlocked = new Set();
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      for (const id of raw) if (ACH_DEFS.some(d => d.id === id)) this.unlocked.add(id);
    } catch { /* 忽略坏存档 */ }
    // 内部计数器
    this._shots = 0; this._params = 0; this._fans = 0;
    this._views = new Set(); this._presets = new Set();
    this._leTime = 0; this._cineTime = 0; this._closeTime = 0;
  }

  _save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...this.unlocked]));
    } catch { /* 隐私模式忽略 */ }
  }

  unlock(id) {
    if (this.unlocked.has(id) || !ACH_DEFS.some(d => d.id === id)) return false;
    this.unlocked.add(id);
    this._save();
    const def = ACH_DEFS.find(d => d.id === id);
    this.onUnlock(def);
    return true;
  }

  // 事件型
  track(event, value) {
    switch (event) {
      case 'param': if (++this._params >= 100) this.unlock('tinkerer'); break;
      case 'view':
        this._views.add(value | 0);
        if (this._views.size >= 10) this.unlock('views');
        break;
      case 'preset':
        this._presets.add(value | 0);
        if (this._presets.has(2)) this.unlock('polar');
        if (this._presets.has(3)) this.unlock('graze');
        break;
      case 'shot': if (++this._shots >= 10) this.unlock('shutter'); break;
      case 'fan': if (++this._fans >= 5) this.unlock('slinger'); break;
      case 'tour': this.unlock('scholar'); break;
      case 'spin': if (value >= 0.9) this.unlock('astrophys'); break;
    }
  }

  // 每帧型(约 2Hz 调用即可,dt 为帧间隔)
  tick(dt, { r = 99, mode = 'orbit', le = false, leFrames = 8, accumMode = 'taa', fly = false } = {}) {
    if (r < 4.5) this.unlock('photon');
    if (fly && r < 6) this.unlock('flyer');
    // 光轨成就只认长曝光模式:TAA 同样是帧累积,但不产生光轨
    if (le && accumMode === 'le' && leFrames >= 32) {
      this._leTime += dt;
      if (this._leTime >= 15) this.unlock('lighttrails');
    } else this._leTime = 0;
    if (mode === 'cine') {
      this._cineTime += dt;
      if (this._cineTime >= 96) this.unlock('cinephile');
    } else this._cineTime = 0;
  }

  get count() { return this.unlocked.size; }
  get total() { return ACH_DEFS.length; }
  get DEFS() { return ACH_DEFS; }
  get stats() { return { shots: this._shots, params: this._params, fans: this._fans }; }
}
