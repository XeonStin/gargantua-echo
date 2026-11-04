// GARGANTUA — 可选氛围音乐(assets/audio/ambient-drone.wav 循环,带淡入淡出)
export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.src = null;
    this.buffer = null;
    this._loadP = null; // 进行中的解码 Promise(并发 enable 共享,修复竞态)
    this.enabled = false;
  }

  async _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('WebAudio 不可用');
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.buffer) {
      // 多次并发调用共享同一个加载 Promise,避免"第二次调用跳过等待 → buffer 未就绪 → 假开无声"
      if (!this._loadP) {
        this._loadP = (async () => {
          const res = await fetch('./assets/audio/ambient-drone.wav');
          if (!res.ok) throw new Error('音频资源加载失败 ' + res.status);
          this.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        })();
        this._loadP.catch(() => { this._loadP = null; }); // 失败后允许重试
      }
      await this._loadP;
    }
  }

  async enable() {
    try {
      await this._ensure();
      if (!this.src && this.buffer) {
        this.src = this.ctx.createBufferSource();
        this.src.buffer = this.buffer;
        this.src.loop = true;
        this.src.connect(this.gain);
        this.src.start();
      }
      this.enabled = true;
      const t = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(0.5, t + 2.5);
      return true;
    } catch (e) {
      console.warn('[GARGANTUA] 音乐启用失败:', e && e.message);
      return false;
    }
  }

  disable() {
    this.enabled = false;
    if (!this.ctx || !this.gain) return;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + 1.2);
  }

  toggle() {
    if (this.enabled) { this.disable(); return false; }
    this.enable();
    return true;
  }
}
