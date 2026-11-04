// GARGANTUA — 截图自动化:显式渲染帧(隐藏标签页安全,不依赖 rAF)+ PNG 下载
export class Capture {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderOne = null; // 由 main 注入:渲染单帧(同步)
  }

  // 显式渲染 n 帧;delayMs=0 时纯同步(隐藏页 setTimeout 会被 1s 节流,逐帧 await 会拖慢 60 倍)
  async renderFrames(n, delayMs = 0) {
    if (delayMs <= 0) {
      for (let i = 0; i < n; i++) this.renderOne();
      return;
    }
    for (let i = 0; i < n; i++) {
      this.renderOne();
      await new Promise(res => setTimeout(res, delayMs));
    }
  }

  // 同一任务内先渲染再读取画布,确保缓冲有效
  screenshotDataUrl() {
    this.renderOne();
    return this.canvas.toDataURL('image/png');
  }

  // opts.watermark:画在左下角的参数摘要(摄影模式)
  screenshot(name, opts = {}) {
    let url;
    if (opts.watermark) {
      this.renderOne();
      const c2 = document.createElement('canvas');
      c2.width = this.canvas.width;
      c2.height = this.canvas.height;
      const ctx = c2.getContext('2d');
      ctx.drawImage(this.canvas, 0, 0);
      const fs = Math.max(12, Math.round(c2.height * 0.02));
      ctx.font = `${fs}px ui-monospace, Consolas, monospace`;
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillText(opts.watermark, Math.round(c2.height * 0.018), c2.height - Math.round(c2.height * 0.018));
      url = c2.toDataURL('image/png');
    } else {
      url = this.screenshotDataUrl();
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = name || `gargantua-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return url;
  }
}
