// GARGANTUA — UI:HUD 统计、24 项设置面板、快捷键、Toast、覆盖层
import { PARAM_META, PARAM_COUNT, QUALITIES, DEBUG_VIEWS, DEFAULTS, LE_FRAMES, RES_SCALE, PHOTO_ADJ_META } from './state.js';

const $ = (id) => document.getElementById(id);

// 状态键 → DOM id(必须显式映射:驼峰键拼 tgl-${id} 找不到 tgl-voldisk/tgl-geo 之类的元素)
const TOGGLE_IDS = {
  volDisk: 'tgl-voldisk',
  annotations: 'tgl-anno',
  eht: 'tgl-eht',
  filmGrade: 'tgl-film',
  refColor: 'tgl-refcolor',
  watermark: 'tgl-watermark',
  geoArmed: 'tgl-geo',
};

export class UI {
  constructor(opts) {
    this.o = opts; // { onParam, onQuality, onMinScale, onFpsCap, onExportSize, onPreset, onCine, onMusic, onScreenshot, onResetParams, onReseed, onView, onMode, onLongExposure, onExposureFrames, onGuide(摄影构图线), onStartGuide(功能引导) }
    this.hud = $('hud');
    this.statLine = $('stat-line');
    this.physLine = $('phys-line');
    this.toastEl = $('toast');
    this.toastTimer = null;
    this._fps = 0; this._ms = 0;
    this._cur = {};  // 各参数当前生效值(数字框输入非法时回退显示用)

    this._buildPanel();
    this._wireButtons();
    this._wireKeys();
  }

  // ---------------- 设置面板 ----------------
  _buildPanel() {
    const groups = {};
    for (const m of PARAM_META) (groups[m.group] ??= []).push(m);
    const root = $('panel-groups');
    let postSection = null;
    for (const [g, items] of Object.entries(groups)) {
      const sec = document.createElement('div');
      sec.className = 'pgroup';
      if (g === '后期') postSection = sec;
      const h = document.createElement('div');
      h.className = 'pgroup-title';
      h.textContent = g;
      sec.appendChild(h);
      for (const m of items) {
        const row = document.createElement('div');
        row.className = 'prow';
        const lab = document.createElement('label');
        lab.textContent = m.label;
        lab.htmlFor = `pr-${m.key}`;
        const range = document.createElement('input');
        range.type = 'range';
        range.id = `pr-${m.key}`;
        range.min = m.min; range.max = m.max; range.step = m.step;
        range.value = DEFAULTS[m.key];
        const val = document.createElement('input');
        val.type = 'number';
        val.className = 'pval';
        val.min = m.min; val.max = m.max; val.step = m.step;
        val.value = DEFAULTS[m.key];
        const apply = (v, fromRange) => {
          const num = parseFloat(v);
          // 数字框清空/非法输入:回退到当前值,不误跳到最小值
          if (isNaN(num)) {
            val.value = this._cur[m.key] ?? DEFAULTS[m.key];
            range.value = val.value;
            this._fill(range, m);
            return;
          }
          v = Math.min(m.max, Math.max(m.min, num));
          this._cur[m.key] = v;
          if (fromRange) val.value = v; else range.value = v;
          this._fill(range, m);
          this.o.onParam(m.key, v);
        };
        range.addEventListener('input', () => apply(range.value, true));
        val.addEventListener('change', () => apply(val.value, false));
        row.append(lab, range, val);
        sec.appendChild(row);
      }
      root.appendChild(sec);
    }
    // 时域累积(不占参数槽):TAA / 长曝光模式 + 开关 + 帧数滑杆
    if (postSection) {
      const leRow = document.createElement('div');
      leRow.className = 'le-row';
      const btn = document.createElement('button');
      btn.className = 'btn btn-le';
      btn.id = 'btn-le';
      btn.textContent = 'TAA';
      btn.title = 'TAA:静止时累积亚像素抖动样本抗锯齿;移动视角自动丢弃历史，不拖影';
      btn.setAttribute('aria-pressed', 'false');
      const mode = document.createElement('select');
      mode.id = 'sel-accummode';
      mode.title = 'TAA 抗锯齿 / 长曝光光轨';
      mode.innerHTML = '<option value="taa">TAA</option><option value="le">长曝光</option>';
      const range = document.createElement('input');
      range.type = 'range';
      range.id = 'pr-leframes';
      range.min = LE_FRAMES.min; range.max = LE_FRAMES.max; range.step = 1;
      range.value = LE_FRAMES.def;
      range.title = 'TAA 采样数 / 长曝光累积帧数';
      this._fillRange(range, LE_FRAMES.min, LE_FRAMES.max, LE_FRAMES.def);
      const val = document.createElement('input');
      val.type = 'number';
      val.className = 'pval';
      val.id = 'pv-leframes';
      val.min = LE_FRAMES.min; val.max = LE_FRAMES.max; val.step = 1;
      val.value = LE_FRAMES.def;
      btn.addEventListener('click', () => this.o.onLongExposure(!btn.classList.contains('active')));
      mode.addEventListener('change', () => this.o.onAccumMode(mode.value));
      const applyN = (v, fromRange, commit) => {
        v = Math.min(LE_FRAMES.max, Math.max(LE_FRAMES.min, Math.round(parseFloat(v)) || LE_FRAMES.def));
        if (fromRange) val.value = v; else range.value = v;
        this._fillRange(range, LE_FRAMES.min, LE_FRAMES.max, v);
        this.o.onExposureFrames(v, { user: true, commit });
      };
      // input:拖动中实时改帧数;change:松手时提交并清空旧累积,反馈更直接
      range.addEventListener('input', () => applyN(range.value, true, false));
      range.addEventListener('change', () => applyN(range.value, true, true));
      val.addEventListener('change', () => applyN(val.value, false, true));
      leRow.append(btn, mode, range, val);
      postSection.appendChild(leRow);
    }
    // 面板标题标注 24
    document.querySelector('#panel .count').textContent = PARAM_COUNT;
  }

  _fill(range, m) {
    this._fillRange(range, m.min, m.max, parseFloat(range.value));
  }

  _fillRange(range, min, max, value) {
    const pct = ((value - min) / (max - min)) * 100;
    range.style.setProperty('--fill', `${pct}%`);
  }

  setParamUI(key, v) {
    const range = $(`pr-${key}`);
    if (!range) return;
    this._cur[key] = v;
    range.value = v;
    const val = range.parentElement.querySelector('.pval');
    if (val) val.value = v;
    const m = PARAM_META.find(x => x.key === key);
    if (m) this._fill(range, m);
  }

  setParamsUI(params) {
    for (const k of Object.keys(params)) this.setParamUI(k, params[k]);
  }

  // ---------------- 按钮 ----------------
  _wireButtons() {
    document.querySelectorAll('.preset-btn').forEach(b =>
      b.addEventListener('click', () => this.o.onPreset(parseInt(b.dataset.preset))));
    $('btn-cine').addEventListener('click', () => this.o.onCine());
    $('btn-fly').addEventListener('click', () => this.o.onFlyToggle());
    $('btn-music').addEventListener('click', () => this.o.onMusic());
    $('btn-music-panel')?.addEventListener('click', () => this.o.onMusic());
    $('btn-shot').addEventListener('click', () => this.o.onScreenshot());
    $('btn-panel').addEventListener('click', () => this.togglePanel());
    $('btn-panel-close').addEventListener('click', () => this.togglePanel(false));
    $('btn-hud').addEventListener('click', () => this.toggleHud());
    $('btn-reset-params').addEventListener('click', () => this.o.onResetParams());
    $('btn-reseed').addEventListener('click', () => this.o.onReseed());
    for (const id of ['sel-quality', 'sel-quality2']) {
      $(id).addEventListener('change', (e) => this.o.onQuality(e.target.value));
    }
    $('sel-fpscap').addEventListener('change', (e) => this.o.onFpsCap(parseInt(e.target.value) || 0));
    $('sel-exportsize').addEventListener('change', (e) => this.o.onExportSize(e.target.value));
    // 安全边界滑杆:拖动实时生效,松手 toast
    const fb = $('pr-flyboundary');
    if (fb) {
      fb.addEventListener('input', () => this.o.onFlyBoundary(parseFloat(fb.value), { commit: false }));
      fb.addEventListener('change', () => this.o.onFlyBoundary(parseFloat(fb.value), { commit: true }));
    }
    // 最低分辨率滑杆:拖动只更新显示/状态,松手才应用并重排渲染目标(避免每步 resize)
    const ms = $('pr-minscale');
    if (ms) {
      ms.addEventListener('input', () => this.o.onMinScale(parseFloat(ms.value), { commit: false }));
      ms.addEventListener('change', () => this.o.onMinScale(parseFloat(ms.value), { commit: true }));
    }
    $('btn-minscale-auto')?.addEventListener('click', () => this.o.onMinScale(null, { commit: true }));
    // 工具开关(aria-pressed 样式复用 .active)
    for (const [id, ev] of [
      ['tgl-voldisk', 'onVolDisk'],
      ['tgl-anno', 'onAnnotations'], ['tgl-eht', 'onEHT'], ['tgl-film', 'onFilmGrade'],
      ['tgl-refcolor', 'onRefColor'],
      ['tgl-watermark', 'onWatermark'], ['tgl-geo', 'onGeoArm'],
    ]) {
      const el = $(id);
      if (el) el.addEventListener('click', () => this.o[ev](!el.classList.contains('active')));
    }
    // 工具按钮
    const map = {
      'btn-tour': () => this.o.onTour(!this._tourActive),
      'btn-tour-hud': () => this.o.onTour(!this._tourActive),
      'btn-photo': () => this.o.onPhoto(!this._photoOpen),
      'btn-photo-hud': () => this.o.onPhoto(!this._photoOpen),
      'btn-ach': () => { this.toggleAch(); },
      'btn-ach-hud': () => { this.toggleAch(); },
      'btn-share': () => this.o.onShareCopy(),
      'btn-import': () => this.o.onShareImport(),
      'btn-guide': () => this.o.onStartGuide?.(),
      'btn-ach-close': () => this.toggleAch(false),
    };
    for (const [id, fn] of Object.entries(map)) {
      const el = $(id);
      if (el) el.addEventListener('click', fn);
    }
    // 摄影模式工具条
    document.querySelectorAll('#photo .look-chip').forEach(b =>
      b.addEventListener('click', () => this.o.onFilmLook(b.dataset.look)));
    document.querySelectorAll('#photo .guide-chip').forEach(b =>
      b.addEventListener('click', () => this.setGuideUI(b.dataset.guide)));
    const pc = $('btn-photo-close');
    if (pc) pc.addEventListener('click', () => this.setPhoto(false));
    // 摄影调整滑杆:亮度/对比度/饱和度/色温
    document.querySelectorAll('#photo .photo-adj input[data-adj]').forEach(inp => {
      inp.addEventListener('input', () => this.o.onPhotoAdj?.(inp.dataset.adj, parseFloat(inp.value)));
    });
    $('btn-photo-adj-reset')?.addEventListener('click', () => this.o.onPhotoAdjReset?.());
    // 导览控制
    const tn = $('tour-next'), tp = $('tour-prev'), tx = $('tour-exit');
    if (tn) tn.addEventListener('click', () => this.o.onTourNext?.());
    if (tp) tp.addEventListener('click', () => this.o.onTourPrev?.());
    if (tx) tx.addEventListener('click', () => this.o.onTour(false));
  }

  setFpsCapUI(v) {
    $('sel-fpscap').value = String(v);
  }

  setExportSizeUI(v) {
    $('sel-exportsize').value = v;
  }

  setFlyBoundaryUI(v) {
    const r = $('pr-flyboundary'), s = $('pv-flyboundary');
    if (r) {
      r.value = v;
      const pct = ((v - 2.01) / (3 - 2.01)) * 100;
      r.style.setProperty('--fill', `${pct}%`);
    }
    if (s) s.textContent = (+v).toFixed(2);
  }

  // 最低分辨率:auto = 跟随画质档(此时「自动」按钮高亮)
  setMinScaleUI(v, auto) {
    const r = $('pr-minscale'), s = $('pv-minscale'), b = $('btn-minscale-auto');
    if (r) {
      r.value = v;
      this._fillRange(r, RES_SCALE.min, RES_SCALE.max, v);
    }
    if (s) s.textContent = `${(+v).toFixed(2)}×`;
    if (b) b.classList.toggle('active', !!auto);
  }

  // ---------------- 开关 / 摄影 / 导览 / 成就 ----------------
  setToggleUI(id, on) {
    const el = $(TOGGLE_IDS[id] || `tgl-${id}`);
    if (el) {
      el.classList.toggle('active', !!on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (id === 'eht') this._ehtOn = !!on;
    if (id === 'annotations') this._annoOn = !!on;
  }

  setModeUI(mode) {
    this._mode = mode;
    $('btn-cine').classList.toggle('active', mode === 'cine');
    $('btn-cine').textContent = mode === 'cine' ? '⏸ 循环' : '▶ 循环';
    const fly = $('btn-fly');
    if (fly) {
      fly.classList.toggle('active', mode === 'fly');
      fly.textContent = mode === 'fly' ? '⏹ 飞行' : '✈ 飞行';
    }
  }

  setPhotoUI(open, state) {
    this._photoOpen = !!open;
    const p = $('photo');
    if (!p) return;
    p.classList.toggle('on', !!open);
    this.setLookUI('default');
    if (state) {
      this.setToggleUI('watermark', state.watermark);
      this.setPhotoAdjUI(state.photoAdj);
    }
    for (const id of ['btn-photo', 'btn-photo-hud']) $(id)?.classList.toggle('active', !!open);
  }

  // 摄影调整:同步四根滑杆与数值(不触发 onPhotoAdj)
  setPhotoAdjUI(adj) {
    if (!adj) return;
    for (const m of PHOTO_ADJ_META) {
      const v = Math.min(m.max, Math.max(m.min, +adj[m.key]));
      if (!isFinite(v)) continue;
      const inp = document.querySelector(`#photo .photo-adj input[data-adj="${m.key}"]`);
      const out = document.querySelector(`#photo .photo-adj span[data-adjv="${m.key}"]`);
      if (inp) {
        inp.value = v;
        const pct = ((v - m.min) / (m.max - m.min)) * 100;
        inp.style.setProperty('--fill', `${pct}%`);
      }
      if (out) out.textContent = m.key === 'temperature'
        ? (v >= 0 ? '+' : '') + v.toFixed(2)
        : v.toFixed(2);
    }
  }

  setPhoto(open) {
    this._photoOpen = !!open;
    const p = $('photo');
    if (p) p.classList.toggle('on', !!open);
    for (const id of ['btn-photo', 'btn-photo-hud']) $(id)?.classList.toggle('active', !!open);
  }

  setLookUI(id) {
    document.querySelectorAll('#photo .look-chip').forEach(b =>
      b.classList.toggle('active', b.dataset.look === id));
  }

  setGuideUI(id) {
    const host = $('guides');
    if (!host) return;
    host.className = 'guides';
    if (id && id !== 'off') host.classList.add(`guide-${id}`);
    document.querySelectorAll('#photo .guide-chip').forEach(b =>
      b.classList.toggle('active', b.dataset.guide === id));
  }

  showTourStation(i, st, tour) {
    this._tourActive = true;
    const t = $('tour');
    if (!t) return;
    t.classList.add('on');
    $('tour-title').textContent = st.name;
    $('tour-text').textContent = st.text;
    $('tour-prog').textContent = `${i + 1} / ${tour ? tour.TOTAL : 7}`;
    for (const id of ['btn-tour', 'btn-tour-hud']) $(id)?.classList.add('active');
  }

  hideTour() {
    this._tourActive = false;
    const t = $('tour');
    if (t) t.classList.remove('on');
    for (const id of ['btn-tour', 'btn-tour-hud']) $(id)?.classList.remove('active');
  }

  toggleAch(force) {
    const p = $('ach');
    if (!p) return;
    const show = force !== undefined ? force : p.hidden;
    p.hidden = !show;
    if (show) this.renderAch(this._ach);
  }

  renderAch(ach) {
    if (!ach) return;
    this._ach = ach;
    const list = $('ach-list');
    if (!list) return;
    list.innerHTML = ach.DEFS.map(d => `
      <div class="ach-item ${ach.unlocked.has(d.id) ? 'on' : ''}">
        <span class="ach-icon">${ach.unlocked.has(d.id) ? '🏆' : '🔒'}</span>
        <span><b>${d.name}</b><i>${d.desc}</i></span>
      </div>`).join('');
    $('ach-count').textContent = `${ach.count} / ${ach.total}`;
  }

  setLongExposureUI(on) {
    this._leOn = !!on;
    this._syncAccumButton();
  }

  setAccumModeUI(mode) {
    this._accumMode = mode === 'le' ? 'le' : 'taa';
    const sel = $('sel-accummode');
    if (sel) sel.value = this._accumMode;
    this._syncAccumButton();
  }

  _syncAccumButton() {
    const btn = $('btn-le');
    if (!btn) return;
    const le = this._accumMode === 'le';
    btn.classList.toggle('active', !!this._leOn);
    btn.setAttribute('aria-pressed', this._leOn ? 'true' : 'false');
    btn.textContent = le ? '长曝光' : 'TAA';
    btn.title = le
      ? '长曝光:帧累积,镜头运动把亮点拉成光轨(拖右侧滑杆自动开启)'
      : 'TAA:静止时累积亚像素抖动样本抗锯齿;移动视角自动丢弃历史、不拖影';
  }

  setExposureFramesUI(n) {
    const r = $('pr-leframes'), v = $('pv-leframes');
    if (r) {
      r.value = n;
      this._fillRange(r, LE_FRAMES.min, LE_FRAMES.max, n);
    }
    if (v) v.value = n;
  }

  setQualityUI(q) {
    for (const id of ['sel-quality', 'sel-quality2']) $(id).value = q;
  }

  setMusicUI(on) {
    $('btn-music')?.classList.toggle('active', on);
    $('btn-music-panel')?.classList.toggle('active', on);
  }

  togglePanel(force) {
    const p = $('panel');
    const show = force !== undefined ? force : p.hidden;
    p.hidden = !show;
    return show;
  }

  toggleHud(force) {
    const show = force !== undefined ? force : this.hud.classList.contains('hidden');
    this.hud.classList.toggle('hidden', !show);
    return show;
  }

  // ---------------- 快捷键 ----------------
  _wireKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        if (e.code !== 'Escape') return;
      }
      // 带修饰键的组合留给浏览器(Ctrl+S 保存 / Ctrl+F 查找 / Ctrl+R 刷新…)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 飞行模式下 R/F 升降、S 后退,不作复位/全屏/截图
      if (this._mode === 'fly' && (e.code === 'KeyR' || e.code === 'KeyF' || e.code === 'KeyS')) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.o.onCine(); break;
        case 'KeyO': this.o.onMode('orbit'); break;
        case 'KeyC': this.o.onMode('cine'); break;
        case 'KeyG': this.o.onFlyToggle(); break;
        case 'KeyH': this.toggleHud(); break;
        case 'KeyP': this.togglePanel(); break;
        case 'KeyM': this.o.onMusic(); break;
        case 'KeyS': e.preventDefault(); this.o.onScreenshot(); break;
        case 'KeyF': this._fullscreen(); break;
        case 'KeyT': this.o.onTour(!(this._tourActive)); break;
        case 'KeyV': this.o.onPhoto(!this._photoOpen); break;
        case 'KeyN': this.o.onAnnotations(!this._annoOn); break;
        case 'KeyR': this.o[e.shiftKey ? 'onResetParams' : 'onResetView'](); break;
        case 'Escape': this.togglePanel(false); this.toggleAch(false); if (this._photoOpen) this.o.onPhoto(false); break;
        default:
          if (e.code.startsWith('Digit')) {
            const d = parseInt(e.code.slice(5));
            if (e.shiftKey && d >= 1 && d <= 4) this.o.onPreset(d - 1);
            else if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) this.o.onView(d);
          }
      }
    });
    // HUD 隐藏后双击画布恢复
    $('gl').addEventListener('dblclick', () => this.toggleHud(true));
  }

  _fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // ---------------- HUD ----------------
  updateStats({ fps, ms, w, h, steps, quality, mode, view, le, leFrames, accumMode }) {
    this._fps = fps; this._ms = ms;
    const q = (QUALITIES[quality] || QUALITIES.high).label;
    const modeName = mode === 'cine' ? '镜头循环' : mode === 'fly' ? '自由飞行' : '自由轨道';
    this.statLine.textContent =
      `${fps.toFixed(0)} FPS · ${ms.toFixed(1)} ms · ${w}×${h} · 步数 ${steps} · ${q} · ` +
      `${modeName}${view ? ` · 调试 ${view}` : ''}` +
      `${le ? ` · ${accumMode === 'le' ? '长曝光' : 'TAA'} ${leFrames ?? ''}帧` : ''}`;
  }

  updatePhysics({ r, fov, tmax }) {
    const g = Math.sqrt(Math.max(0, 1 - 2 / Math.max(r, 2.01)));
    const dil = 1 / Math.max(g, 0.02);
    this.physLine.textContent =
      `r = ${r.toFixed(1)} M · FOV ${fov.toFixed(0)}° · T_max = ${tmax.toFixed(0)} K · ` +
      `g(∞) = ${g.toFixed(2)} · 你的1h = 地球${dil >= 100 ? dil.toFixed(0) : dil.toFixed(2)}h`;
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  viewToast(v) {
    this.toast(`调试视图 ${v} · ${DEBUG_VIEWS[v]}`);
  }

  // ---------------- 覆盖层 ----------------
  showOverlay(msg, { error = false, spinner = true } = {}) {
    $('overlay').classList.remove('gone');
    $('ov-msg').textContent = msg;
    $('ov-spinner').style.display = spinner ? '' : 'none';
    $('ov-actions').hidden = !error;
  }

  hideOverlay() {
    $('overlay').classList.add('gone');
  }
}
