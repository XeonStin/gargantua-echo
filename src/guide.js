// GARGANTUA — 功能引导:首次访问的聚光步骤卡(含画质调节),参数面板「引导」按钮可重开。
// 聚光层不拦截指针:引导开着也能真的去试画质下拉/按钮;场景交互照常,只有卡片可点。
const LS_KEY = 'gargantua_guide_v1';

const STEPS = [
  {
    target: null,
    title: '欢迎来到 GARGANTUA',
    text: '这是一台实时黑洞测地线渲染器——没有贴图、没有视频,每个像素都在现场积分广义相对论轨道。<b>拖拽</b>环绕 · <b>滚轮</b>缩放 · <b>双击</b>或 <b>H</b> 隐藏界面文字。',
  },
  {
    target: '.preset-group',
    title: '视角预设',
    text: '远景 / 赤道 / 极区 / 掠行——四个经典机位一键直达(Shift+1~4)。',
  },
  {
    target: '#sel-quality',
    title: '画质调节',
    text: '右上的画质下拉:<b>低 / 标准 / 高 / 电影</b>(Q 键循环)。手机默认「低」档,并自动调分辨率保帧率——觉得糊就升一档,卡顿就降一档,随时可换。',
  },
  {
    target: '#btn-panel',
    title: '参数面板',
    text: '「参数」按钮打开 24 项物理参数:自旋、喷流、多普勒、盘面温度……(P 键开关)。画质和帧率限制也在面板顶部。',
  },
  {
    target: '.tool-group',
    title: '工具与快捷键',
    text: '循环(Space) / 飞行(G) / 导览(T) / 摄影(V) / 音乐(M) / 截图(S);左下角有完整快捷键表。',
  },
  {
    target: null,
    title: '开始探索',
    text: '这份引导随时可以在<b>参数面板 → 引导</b>重新打开。试试在画质下拉里切一档,然后飞向黑洞吧。',
  },
];

export class Guide {
  constructor() {
    this.active = false;
    this.idx = 0;
    this.root = null;
    this._onResize = () => { if (this.active) this._show(this.idx); };
    this._onKey = (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); this.done(); }
      else if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); e.preventDefault(); this.next(); }
    };
  }

  _build() {
    if (this.root) return;
    this.root = document.createElement('div');
    this.root.id = 'guide';
    this.root.innerHTML = `
      <div class="guide-spot"></div>
      <div class="guide-card">
        <div class="guide-head">
          <span class="guide-title"></span>
          <span class="guide-prog"></span>
        </div>
        <p class="guide-text"></p>
        <div class="guide-ctrl">
          <button class="btn guide-skip" title="跳过并不再自动显示">跳过引导</button>
          <button class="btn guide-prev">‹ 上一步</button>
          <button class="btn guide-next">下一步 ›</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    const $ = (s) => this.root.querySelector(s);
    $(' .guide-skip').addEventListener('click', () => this.done());
    $(' .guide-prev').addEventListener('click', () => this.prev());
    $(' .guide-next').addEventListener('click', () => this.next());
    this.spot = $(' .guide-spot');
    this.card = $(' .guide-card');
    this.elTitle = $(' .guide-title');
    this.elProg = $(' .guide-prog');
    this.elText = $(' .guide-text');
    this.elPrev = $(' .guide-prev');
    this.elNext = $(' .guide-next');
  }

  start() {
    this._build();
    if (this.active) { this.idx = 0; this._show(0); return; } // 重入:回到第一步,不重复挂监听
    this.active = true;
    this.idx = 0;
    this.root.classList.add('on');
    window.addEventListener('resize', this._onResize);
    window.addEventListener('keydown', this._onKey, true); // capture:先于面板/HUD 快捷键
    this._show(0);
  }

  done() {
    try { localStorage.setItem(LS_KEY, '1'); } catch { /* 隐私模式忽略 */ }
    this.active = false;
    this.root.classList.remove('on');
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey, true);
  }

  next() { this.idx >= STEPS.length - 1 ? this.done() : (this.idx++, this._show(this.idx)); }
  prev() { if (this.idx > 0) { this.idx--; this._show(this.idx); } }

  _show(i) {
    const step = STEPS[i];
    this.elTitle.textContent = step.title;
    this.elProg.textContent = `${i + 1} / ${STEPS.length}`;
    this.elText.innerHTML = step.text; // 静态文案
    this.elPrev.style.visibility = i > 0 ? 'visible' : 'hidden';
    this.elNext.textContent = i >= STEPS.length - 1 ? '完成 ✓' : '下一步 ›';

    const vw = innerWidth, vh = innerHeight;
    const rect = targetRect(step.target);
    this.card.style.width = 'min(340px, calc(100vw - 24px))';
    this.spot.style.display = rect ? 'block' : 'none';
    if (rect) {
      const p = 8;
      this.spot.style.left = `${rect.left - p}px`;
      this.spot.style.top = `${rect.top - p}px`;
      this.spot.style.width = `${rect.width + p * 2}px`;
      this.spot.style.height = `${rect.height + p * 2}px`;
    }
    // 先摆好宽度再量卡片尺寸
    const cw = this.card.offsetWidth, ch = this.card.offsetHeight;
    let left, top;
    if (!rect) {
      left = (vw - cw) / 2;
      top = (vh - ch) / 2;
    } else {
      const below = rect.bottom + 14 + ch < vh - 10;
      top = below ? rect.bottom + 14 : Math.max(10, rect.top - ch - 14);
      left = rect.left + rect.width / 2 - cw / 2;
    }
    this.card.style.left = `${Math.max(10, Math.min(vw - cw - 10, left))}px`;
    this.card.style.top = `${Math.max(10, Math.min(vh - ch - 10, top))}px`;
  }

  // 首次访问自动开始;自动化/特殊场景一律不弹(?guide=1 强制,?guide=0 禁止)
  maybeAutoStart(state) {
    const blocked = state.still || !!state.snapName || navigator.webdriver || state.safemode ||
      !state.hud || state.reset || !!state.share || state.tour || state.panel;
    if (state.guide === true) this.start();
    else if (state.guide === false) { /* 显式禁止 */ }
    else if (!blocked) {
      let seen = false;
      try { seen = !!localStorage.getItem(LS_KEY); } catch { /* 隐私模式视为未看过 */ }
      if (!seen) this.start();
    }
  }
}

function targetRect(sel) {
  if (!sel) return null;
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
  return r;
}
