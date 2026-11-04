# GARGANTUA gargantua-echo — 会话对接文档（Handoff）

> 用途：压缩上下文后的续接说明。读完本文件 + README.md + TESTREPORT.md 即可无缝接手。
> 最后更新：2026-11-04（七轮：参考项目盘面配方升级完成后；同日部署至 GitHub Pages）

---

## 1. 项目速览

| 项 | 值 |
|---|---|
| 路径 | `C:\Users\HJF\Desktop\AI-playground\gargantua-echo\` |
| 线上 | <https://xeonstin.github.io/gargantua-echo/> —— 仓库 `XeonStin/gargantua-echo`（原名 `xeonstin.github.io`，2026-11-04 改名后从用户站变为项目站，`master` 根目录发布到子路径 `/gargantua-echo/`；全站相对路径无需改动。旧 2016 站备份在 `..\_backups\xeonstin.github.io-2016`） |
| 启动 | `cd gargantua-echo && python serve.py 5300` → `http://127.0.0.1:5300/`（本会话后台任务，进程可能已结束，重启即可） |
| 技术栈 | 原生 HTML/CSS/JS + ES Modules + 本地 three r170（vendor）+ 零构建 + 静态服务器 |
| 核心 | 全屏 Fragment Shader 实时积分黑洞零测地线；**Schwarzschild 速度 Verlet** + **Kerr-Schild 哈密顿**双路径 |
| 当前版本 | `window.gargantua.version = '2.0.0'`，24 参数，API 见 README |
| 当前状态 | 干净默认态（filmGrade 开 / 24 参数 / localStorage 已清 / 0 控制台错误）；服务器 5300 |

## 2. 文件架构

```
gargantua-echo/
├── index.html            # 全部 DOM：HUD/面板/摄影/导览/成就/标注
├── style.css
├── serve.py              # 静态服务器（no-store）
├── src/
│   ├── main.js           # 编排：主循环、模式(cine/orbit/fly)、setParam、导出、分享码、API
│   ├── engine.js         # 渲染：RT/双材质(Verlet+Kerr)/Bloom/合成/导出/黑体LUT/ISCO+视界公式
│   ├── state.js          # 24 参数、URL 解析、持久化、开关状态
│   ├── ui.js             # HUD/面板/快捷键/Toast/覆盖层；TOGGLE_IDS 映射（勿删）
│   ├── cinematic.js      # 4 预设 + 96s 电影循环
│   ├── flight.js         # 自由飞行（WASD+R/F，子步积分，安全边界）
│   ├── geodesic.js       # 光子弹弓（CPU 端同源 KS 积分 + LineSegments 叠加）
│   ├── annotations.js    # 物理标注（阴影/视界/ISCO 投影 SVG）
│   ├── achievements.js   # 13 项成就（localStorage）
│   ├── tour.js           # 7 站中文导览
│   ├── photomode.js      # 胶片风格预设 / 构图线 / 水印文本
│   ├── sharecode.js      # 参数分享码（base64url ?s=）
│   ├── stars.js          # 耶鲁亮星表 → equirect HDR 纹理烘焙
│   ├── disktex.js        # 吸积盘有机细节纹理（本地可平铺 FBM 烘焙）
│   ├── audio.js / capture.js
│   └── shaders/
│       ├── raytracer.js  # COMMON + SCHW_MAIN + KERR_MAIN（双 program）
│       └── post.js       # Bloom 金字塔 + ACES 合成（含 EHT / 电影色调分支）
├── assets/data/bright-stars.js   # 2068 颗（tools/gen_stars.py 生成）
├── assets/audio/ambient-drone.wav
├── tools/gen_stars.py
├── README.md / TESTREPORT.md / HANDOFF.md
```

## 3. 物理与渲染核心（改代码前必读）

### 双积分路径（材质按 `uSpin > 0.001` 切换，uniforms 共享）
- **Schwarzschild**（`RT_FRAG`）：速度 Verlet `a = -(3/2)·rs·h²·x/r⁵`，`MAX_STEPS=384`，自适应步长。
- **Kerr**（`RT_FRAG_KERR`）：Kerr-Schild 笛卡尔哈密顿 `H=½g^{μν}p_μp_ν`，RK2 中点法；
  坐标旋转 `(X,Y,Z)_ks = (x,−z,y)_w`（自旋轴 = 世界 +y）。`f = 2Mr³/(r⁴+a²Z²)`，r 由
  `r⁴−(R²−a²)r²−a²Z²=0` 解出。**两条路径共享 COMMON（噪声/天空/diskShade/jetEmit）**。
- **验证基准**（回归必测）：r=26、fov55、view4 时阴影直径 = **282px**（解析 282.3，b_c=√27·M
  口径用 `sinψ=b_c/d`，不是 Synge 局地观者公式）；spin=0.9 阴影 D 形不对称 L−186/R+75；
  ISCO 跟随 a=0.9→2.32M。

### 管线顺序
`主 pass(RT) → [长曝光累积 RGBA16F EMA, 4子采样体积盘] → Bloom 金字塔 → 合成(色散/ACES/EHT/电影色调/暗角/颗粒)`
- 长曝光：`accum = accum·(1−1/N) + frame·1/N`（CustomBlending，**累积 pass 必须 noClear**，首帧 w=1）；
  LE 开启时每帧 Halton 抖动 = TAA；`freeze` 时抖动归零保证确定性。
- 导出：`engine.renderExport()` 按目标尺寸重建管线 → RGBA8 → readPixels → **原地逐行翻转** → toBlob PNG；
  导出期间 `exporting` 冻结主循环/参数/模式切换。

### 吸积盘着色（diskShade，两条路径共用）
- 湍流 = 刚体旋转(Ω_ref) + 有界差速剪切（**基准取盘外缘 Ω_outer，diff≥0 保证内外同向**，×5 放大，双相位防无限剪切）；
- 丝状层 = 各向异性柱坐标（切向 ×0.55）上 4 层 vnoise **相乘**；
- 细节纹理 = `uDiskTex`（disktex.js 烘焙）按 (θ·3, r·1.6) 采样，`clamp(detail²·4,0.1,1.7)` 混合 0.5；
- 内缘白热环 = Lorentzian `0.9/((rimDist·14)²+0.06)`，密度门控、体积盘 ×0.35；
- 体积盘 = 段内 **4 子采样**（防阶梯带），盘区步长 ×0.28；
- 电影色调（uFilm）：盘面双色带 + 合成胶片曲线（S 0.32 + 通道 gamma 1.08/1.03/1.0 + 抬暗 0.94）。

## 4. 功能清单（全部可用）

- **模式**：cine（电影循环）/ orbit / fly（G；WASD+R/F+滚轮；安全边界可调 2.01–3.0M）
- **24 参数**：fov、盘 8 项、相对论 6 项（**spin / jetPower** 等）、星空 3、后期 6
- **开关**（面板工具行，`TOGGLE_IDS` 映射）：体积盘 / 真实星空 / 电影色调（默认开）/ 标注 / EHT / 水印 / 弹弓
- **HUD 按钮**：循环 / 飞行 / 导览 / 摄影 / 音乐 / 截图 / 画质 / 参数
- **快捷键**：Space/O/C/G、Shift+1-4、0-9、P/H/M/S/V/T/E/N、R/Shift+R、F、Q
- **其他**：导览 7 站（T）、摄影模式（V，胶片预设/构图线/水印）、成就 13 项、分享码（?s=）、
  时间膨胀显示、自旋自动跟 ISCO、Kerr 喷流、4K/8K 导出（屏幕/4K/8K）

## 5. URL / API 速查

URL：`?preset ?mode ?view ?quality ?p= ?seed ?t ?fps ?le ?lef ?exp ?fov ?vol ?stars ?anno ?eht ?film ?flyb ?tour ?s ?cine ?music ?hud ?panel ?freeze ?still ?snap ?safemode ?reset`

API：`setParam/setParams/getParams、setView/setQuality/setPreset/setCine/setSeed、setFpsCap/setExportSize、
setLongExposure/setExposureFrames、setVolDisk/setRealStars/setAnnotations/setEHT/setFilmGrade/setWatermark、
setTour/setPhoto/setGeoArm/launchPhoton、setFlyBoundary、share/applyShareCode、renderFrames/renderOne/benchmark、
screenshot/exportImage/screenshotDataUrl、info()`；`window.__LAST_EXPORT__`、`window.__GARGANTUA_ERRORS__`。

## 6. 历轮变更摘要

1. **一轮**：从零建成（Schwarzschild Verlet、Bloom/ACES、四预设、21 参数、0-9 调试、音乐、持久化、错误恢复）。
2. **二轮**：2K 120/165fps 优化（远场步长×4 等，物理无损）+ 帧率限制令牌桶。
3. **三轮**：2K 无损截图交付。
4. **四轮**：FOV 第 22 参数 + 4K/8K 原生导出 + 长曝光滑块修复（自动开启/填充色/提交清空）。
5. **五轮（v2.0）**：Kerr 自旋（KS 哈密顿）、喷流、体积盘、真实星空（2068 颗）、飞行、弹弓、
   标注、成就、导览、摄影、分享码、EHT、8K 导出内存减半、LE+TAA、adapt 掉帧信号。
6. **六轮（复查+实测反馈修复）**：
   - 面板开关"不变蓝/关不掉"（驼峰键拼 `tgl-${id}` 查不到 DOM）→ `TOGGLE_IDS` 显式映射；
   - 飞行 S 与截图快捷键冲突 → 飞行模式排除 KeyR/KeyF/KeyS；
   - 导览/摄影入口进 HUD 顶栏；飞行子步积分（帧率无关）；`?mode=fly` 初始化激活；
   - 导览第 7 站 `exposureFrames=undefined` 写档 → 判空；普通重载丢 FOV → 仅显式 `?preset=` 采用预设 FOV；
   - **Kerr 路径盘/喷流冻结**：湍流相位误传逐光线坐标时间 kT → 统一 uTime；
   - **盘内外圈反向旋转**：差速剪切基准中点→外缘，`diff=max(Ω−Ω_outer,0)·5`；
   - 飞行安全边界可调（面板滑杆 2.01–3.0M）。
7. **七轮（参考项目配方升级）**：乘积八度丝状层、本地有机纹理（disktex.js）、内缘白热环、
   外缘长尾、双乘法色带、胶片曲线；「电影色调」开关默认开。

## 7. 关键坑与实现约束（踩过的坑，勿再犯）

**着色器 / 物理**
- GLSL ES 1.0：**没有 `saturate()`**，用 clamp；`texture2D` 隐式 LOD 在分歧分支可用但别依赖。
- Kerr 路径的湍流/喷流相位必须用 `uTime`（动画时钟）；曾用 kT（逐光线积分时间）导致盘/喷流冻结。
- 差速剪切基准必须是盘外缘（保证 diff≥0 同向）；中点基准会让内外圈反向。
- 体积盘：4 子采样 + dt×0.28；辉光在体积模式 ×0.35（4 子采样叠加会白片）。
- `flyMinR = max(边界, r₊·1.005)`；飞行子步 ≤1/60s + 速度上限（防卡顿瞬移）。
- 确定性：所有烘焙纹理固定种子；freeze 时 jitter=0；`?freeze=1&still=1` 两次截图必须逐字节一致。

**IAB 测试环境（本机自动化）**
- `document.hidden=false` 但 **rAF 被挂起** → 主循环死亡，测试一律用同步 API（`renderOne/screenshotDataUrl`）。
- 页内 `setTimeout` 被强节流（24 帧测试可跑 10s+）→ 长任务页内启动 + 轮询，或纯同步紧循环。
- `playwright.evaluate` ~3s 上限；大图分块取回（≤600KB/次）。
- `browser.tabs.list()` 可能为空 → `tabs.new()` 重建；连续 goto 偶发落旧文档 → 断言前核对 `location.search`。
- `camera.aspect` 构造瞬间可能为 0（视口未布局）→ 标注/弹弓已有兜底；渲染不受影响（用 uRes）。
- **基准必须热身**（30 帧起，建议 4s 持续负载）：空闲降频会让首测虚高 20 倍。
- **本会话后期出现均匀 2.46× 环境慢速**（720p/2K 同比；移除全部新代码仍慢；负载中 GPU 100%/2.4GHz/105W
  正常）→ 基准数字先区分"环境漂移 vs 代码回归"：对照 view9（纯星空）与 view0（含盘）拆分盘面成本。
- **测试污染**：在 `?reset=1` 页调用 persist 触发型 API（setQuality/setParam）会把默认值写回存档；
  端到端验证要 `setParam → 等 1.5s → goto 干净 URL`。

## 8. 性能数据

- 历史健康基线（2K 2560×1440 电影档 320 步，readPixels 强同步）：默认 **4.49ms**、Kerr 8.79、体积盘 9.75、
  真实星空 4.27、EHT 4.52、LE16+TAA 4.70、Kerr+喷流 9.47；720p 重场景 1.4–3.3ms。
- 七轮增量：盘面着色（含全部新配方）2K ≈ **0.7ms**、720p ≈ 0.24ms；胶片曲线 2K ≈ 0.9ms → 健康基线约 **5.2ms@2K**。
- 目标：2K 120fps（8.33ms）达标；体积盘/Kerr+喷流在 2K 略超建议高/标准档；1K 60fps 全部有 5× 余量。

## 9. 待办 / 可选方向（均未开始，等用户指令）

- 暂缓：双黑洞并合（含 LIGO chirp）、WebXR（无硬件不可验，不盲发）。
- 候选：视频导出（WebCodecs）、相机关键帧编辑器、分屏对比滑块、多普勒声效、hover 星表识别、
  倾斜盘+进动、引力波模式、TDE 场景、双语 i18n、PWA、课堂模式、参数画廊。
- 未决小项：无。当前构建干净、0 错误。

## 10. 八轮(参考配方盘面重写,2026-11-04)

- **盘面模型换成参考项目做法**:`coverage = pow(1-rg,1.35) × 垂直锥 × 6 层乘积噪声 × 有机纹理 × 内密外疏`,`dustGlow=1/(rg²·120+0.02)` 内缘白热 + `vGlow=1/(y²·45+0.01)` 垂直光晕;旧的等值面密度/伪光影/独立 rimGlow 已移除。
- **体积模式**:恢复 4 子采样 + 逐像素相位抖动(单采样会出同心圆壳,固定相位会出竖条纹),亮度系数按 readPixels 实测配平到 2.20(俯视 volOn/volOff ≈ 0.95)。
- **噪声坐标改直角坐标** `q = pu*3.20`,消除放射状辐条;角向域扭曲保留大尺度旋涡。
- **新增开关**「参考配色」:内缘白 → 外缘橙褐;默认**开**。URL `?refcolor=1`,API `setRefColor`。
- **分享码 v1 增加 `t` 字段**:打包 8 个开关(vd/rs/an/eht/fg/rc/wm/ga),旧链接无 `t` 时沿用接收方状态。
- **物理修正**:`diskInner` 任何路径下都钳到自旋对应的 ISCO(自旋 0 → 6M,a=0.318 → 4.91M);差速剪切双相位周期 10s→25s、放大 ×5→×2,接缝跳变肉眼不可见。
- **默认值**更新为分享场景:FOV 57.5、cinematic、体积盘开、参考配色开、内径 4.91、外径 16.5、厚 0.31、自旋 0.318、曝光 0.53、暗角 0.48、颗粒 0.045、色散 0.3、泛光 0.04。
- 已知遗留:体积模式亮度随视线路径长度变化,俯视配平、侧视略亮(真实体积的固有特性);`dopplerBeaming` 现为物理值 1.0。

## 11. 文档索引

- `AGENTS.md`：常驻工作约定（自动加载）——启动命令、硬约束、验收流程，开工先读。
- `README.md`：用法/参数/开关/URL/API/性能/目录/错误恢复。
- `TESTREPORT.md`：第 1–10 节历轮证据；**第 12 节 = 七轮（参考配方升级）验证**；第 11 节已知环境限制。
- 记忆文件：`~/.zcode/cli/memories/projects/ai-playground-9dcf04bbe96961ed/memory/gargantua-53f-project.md`
  （含历轮技术要点与测试坑，MEMORY.md 有索引行）。
