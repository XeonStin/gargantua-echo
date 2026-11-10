# GARGANTUA gargantua-echo — 会话对接文档（Handoff）

> 用途：压缩上下文后的续接说明。读完本文件 + README.md + TESTREPORT.md 即可无缝接手。
> 最后更新：2026-11-11（二十二轮：坠入之旅改测地线螺旋 + 移动端飞行双摇杆 v2.6.0）

---

## 1. 项目速览

| 项 | 值 |
|---|---|
| 路径 | `C:\Users\HJF\Desktop\AI-playground\gargantua-echo\` |
| 线上 | <https://xeonstin.github.io/gargantua-echo/> —— 仓库 `XeonStin/gargantua-echo`（原名 `xeonstin.github.io`，2026-11-04 改名后从用户站变为项目站，`master` 根目录发布到子路径 `/gargantua-echo/`；全站相对路径无需改动。旧 2016 站备份在 `..\_backups\xeonstin.github.io-2016`） |
| 启动 | `cd gargantua-echo && python serve.py 5300` → `http://127.0.0.1:5300/`（本会话后台任务，进程可能已结束，重启即可） |
| 技术栈 | 原生 HTML/CSS/JS + ES Modules + 本地 three r170（vendor）+ 零构建 + 静态服务器 |
| 核心 | 全屏 Fragment Shader 实时积分黑洞零测地线；**Schwarzschild 速度 Verlet** + **Kerr-Schild 哈密顿**双路径 |
| 当前版本 | `window.gargantua.version = '2.6.0'`，24 参数 + TAA/长曝光 + 最低分辨率 + 摄影调整，API 见 README |
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
│   ├── achievements.js   # 14 项成就（localStorage）
│   ├── tour.js           # 7 站中文导览
│   ├── plunge.js         # 坠入之旅(测地线螺旋积分,视线朝向速度)
│   ├── joysticks.js      # 移动端飞行双摇杆(左俯仰滚转/右进退偏航)
│   ├── photomode.js      # 胶片风格预设 / 构图线 / 水印文本
│   ├── sharecode.js      # 参数分享码（base64url ?s=）
│   ├── disktex.js        # 吸积盘有机细节纹理（本地可平铺 FBM 烘焙）
│   ├── audio.js / capture.js
│   └── shaders/
│       ├── raytracer.js  # COMMON + SCHW_MAIN + KERR_MAIN（双 program）
│       └── post.js       # Bloom 金字塔 + ACES 合成（含 EHT / 电影色调分支）
├── assets/audio/ambient-drone.wav
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
`主 pass(RT) → [长曝光累积 RGBA16F EMA, 4子采样体积盘(低档 2)] → Bloom 金字塔 → 合成(色散/ACES/EHT/电影色调/暗角/颗粒)`
- 长曝光：`accum = accum·(1−1/N) + frame·1/N`（CustomBlending，**累积 pass 必须 noClear**，首帧 w=1）；
  LE 开启时每帧 Halton 抖动 = TAA；`freeze` 时抖动归零保证确定性。
- 导出：`engine.renderExport()` 按目标尺寸重建管线 → RGBA8 → readPixels → **原地逐行翻转** → toBlob PNG；
  导出期间 `exporting` 冻结主循环/参数/模式切换。

### 吸积盘着色（diskShade，两条路径共用）
- 湍流 = 刚体旋转(Ω_ref) + 有界差速剪切（**基准取盘外缘 Ω_outer，diff≥0 保证内外同向**，×2 放大，双相位防无限剪切）；
- 丝状层 = 各向异性柱坐标（切向 ×0.55）上 4 层 vnoise **相乘**；
- 细节纹理 = `uDiskTex`（disktex.js 烘焙）按 (θ·3, r·1.6) 采样，`clamp(detail²·4,0.1,1.7)` 混合 0.5；
- 内缘白热环 = Lorentzian `0.9/((rimDist·14)²+0.06)`，密度门控、体积盘 ×0.35；
- 体积盘 = 段内 **4 子采样**（防阶梯带;低档 2,亮度按 ev 补偿,见 §11），盘区步长 ×0.40（十轮放宽,含薄层门控与壳层跳过,见 §10）；
- 电影色调（uFilm）：盘面双色带 + 合成胶片曲线（S 0.32 + 通道 gamma 1.08/1.03/1.0 + 抬暗 0.94）。

## 4. 功能清单（全部可用）

- **模式**：cine（电影循环；接近盘面时半径平滑抬到盘外缘外，避免穿盘卡顿）/ orbit / fly
  （G；WASD+R/F 升降+Q/E 滚转+拖拽环视+滚轮调速；安全边界可调 2.01–3.0M）
- **24 参数**：fov、盘 8 项、相对论 6 项（**spin / jetPower** 等）、星空 3、后期 6
- **时域累积**：TAA（默认，静止累积、移动自动丢弃历史）/ 长曝光光轨；帧数 2–64；`?le=1&lm=taa|le`
- **摄影调整**：亮度/对比度/饱和度/色温（中性值不改变默认画面）+ 胶片风格「默认」恢复进入时视效
- **开关**（面板工具行，`TOGGLE_IDS` 映射）：体积盘 / 电影色调（默认开）/ 标注 / EHT / 水印 / 弹弓
- **HUD 按钮**：循环 / 飞行 / 导览 / 摄影 / 🏆 成就 / 音乐 / 截图 / 画质 / 设置
- **快捷键**：Space/O/C/G、Shift+1-4、0-9、P/H/M/S/V/T/N、R/Shift+R、F；飞行中 Q/E 滚转
  （Q/E 不再切画质/EHT；画质走顶栏/面板下拉，EHT 走开关）
- **其他**：导览 7 站（T）、**坠入之旅**（B，二十二轮：测地线螺旋 + 视线朝向速度，见 §12e/§12f）、摄影模式（V）、成就 14 项（顶栏 🏆 / 设置面板）、分享码（?s=，
  飞行模式含完整朝向与滚转，见 §12c）、
  时间膨胀显示、自旋自动跟 ISCO、Kerr 喷流、4K/8K 导出（屏幕/4K/8K）
- （九轮移除：真实星空/耶鲁星表烘焙——观感不佳，`src/stars.js`、`assets/data/bright-stars.js`、
  `tools/gen_stars.py` 已删除；`?stars=` 与 `setRealStars` API 不复存在，旧分享码的 `t.rs` 字段被忽略）

## 5. URL / API 速查

URL：`?preset ?mode ?view ?quality ?p= ?seed ?t ?fps ?le ?lef ?lm ?exp ?fov ?vol ?anno ?eht ?film ?refcolor ?flyb ?minscale ?tour ?s ?cine ?music ?hud ?panel ?freeze ?still ?snap ?safemode ?reset`（`?stars` 已随真实星空移除）

API：`setParam/setParams/getParams、setView/setQuality/setMinScale/setPreset/setCine/setSeed、setFpsCap/setExportSize、
setLongExposure/setAccumMode/setExposureFrames、setVolDisk/setAnnotations/setEHT/setFilmGrade/setRefColor/setWatermark、
getPhotoAdj/setPhotoAdj、setTour/setPhoto/setGeoArm/launchPhoton、setFlyBoundary、share/applyShareCode、
renderFrames/renderOne/benchmark、screenshot/exportImage/screenshotDataUrl、info()`；
`window.__LAST_EXPORT__`、`window.__GARGANTUA_ERRORS__`。
（`setRealStars` 已移除）

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
- 体积盘：4 子采样（低档 2,uVolSub 控制）+ dt×0.40（十轮;勿回 0.28 除非连带回调门控）+ 薄层门控/壳层跳过（§10）；
  辉光在体积模式 ×0.35（4 子采样叠加会白片）。
- **体积盘中面穿越保护（十七轮，勿删）**：远场大步可能一步跨过薄盘中面，4 子采样全部落在薄层外
  → 低画质前方盘面缺块 + 粒子-纹理条带。两条积分路径都在预计穿越前把 dt 缩到 0.85·t_cross；
  删掉后低档分享场景会复现缺块。**只对 r > 1.6·r_in 生效**：内圈保留旧版软边，否则近侧内缘
  白带会变硬、像"嵌进"阴影。
- **盘面细节纹理采样（十七轮，勿回退）**：必须按当前样本的真实交点逐样本采样（LinearFilter 可用）。
  **不要改成每像素预采样/固定锚点**——远侧透镜像与内缘会扭曲成放射状怪纹。接缝修复保留：
  v 用整数倍 2.0 + 圆周坐标 warp；**warp 圆周半径必须 1.45**（2π·1.45≈9，匹配旧版 θ 路径长度 0..9）。
  用 *9 会让圆周路径长达 2π·9≈56，角向 warp 频率高 6 倍，盘面扭成放射状。
  注：体积循环里逐样本 LinearFilter 的隐式 LOD 在本机偶发 2/255 双稳态，原始代码同样存在；
  视觉正确性优先，不再用预采样/手动双线性规避。
- **TAA**：`renderFrame` 比较相机位置/基向量，变化即 `invalidateAccum`；参数/开关变化也要丢历史；
  冻结模式 `_accumDirect` 每帧权重 1。TAA 导出时间冻结、逐帧换抖动；长曝光导出时间推进。
- **自适应重绘**：主循环 `adapt` 在 renderOne 之前，`resize(false)` 跳过内部重绘；只有窗口变化/
  切档等事件路径才用默认 `resize()` 立即补一帧。不要改回 adapt 内重绘（该帧会渲染两次 → 周期性卡顿）。
- **电影循环避让**：`Cinematic` 在 |y| < 1.0+1.2×厚度 时把半径平滑抬到 diskOuter+3M；
  否则轨迹会从盘内穿过（近场体积成本暴涨 + 镜头穿模）。
- **子采样权重补偿必须乘法形式并进 `ev`**（§11）：在 `col +=` 尾部追加 `* evMul` 会让 ANGLE/D3D
  改变 FMA 收缩,默认档输出不再逐位一致——十轮三元 select 坑的同族问题。
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
- 九轮薄层门控后：体积模式额外开销约减半（同环境 A/B −34%），2K 体积盘预计回到达标区间（原生 2K 复测待做）。

## 9. 九轮（代码审查修复 + 优化，2026-11-05）

**审查发现并全修的问题**：
- **P1 盘内半径存档丢失**：初始化无条件把 diskInner 赋值为 ISCO（注释声称"未显式给盘内半径时"但实现没有判断）→ 用户调大值和显式 URL 每次刷新被重置。现改为**只抬不压**（保留 ≥ISCO 的现值），显式 URL 跳过自动跟随但保留 ISCO 物理下限钳制。
- **P1 错误恢复按钮未接线**：覆盖层「安全模式/重试」从未绑定事件 → index.html 尾部内联脚本接线（模块加载失败时依然可用；安全模式 = `?safemode=1` 重载，重试 = reload）。
- **P2 体积盘表层补采样死分支**：`uVolDisk > 1.5` 永不可达（setVolDisk 只写 0/1）→ 按用户决定**删除**（观感保持现状）。
- **P2 弹弓忽略透镜强度**：geodesic.js 硬编码 lensing=1 → 现从 `state.params.lensing` 透传。
- **P2 分享码相机数组未校验**：`obj.c` 元素非数值会让 NaN 传播进测地线 → 加 `every(isFinite)` 校验。
- 其余：setFilmGrade 混入行删除、QUALITIES.scale 死字段删除、标注 Kerr 口径注明、音乐 toggle 异步化（enable 失败不再"假开"）、`hdrFloat=false` 时 RT 降级 8 位、隐藏标签页 setTimeout 循环仅在自动化场景（?snap=/webdriver）启用、文档漂移（22→24 参数等）。

**真实星空移除**（用户决定：效果不佳）：shader `uRealStars/uStars`、engine `setRealStars/setStarsTexture/setGalPole`、state/ui/main/sharecode 全链路 + 资产 + 生成工具。程序化星空为唯一星空。

**体积盘薄层门控（主优化）**：
- 实测发现体积模式帧耗大头是**盘区步长 ×0.28 的 3.6 倍积分步数**（view0≈view9、vol1/vol0=3.6× 均印证；着色 ALU 占比可忽略）。
- 修复：盘区加密加**薄层门控**——`|y| < gate(=5×最大半厚+1.2) 或一个粗步长内能到达` 才 ×0.28；远离薄层的光线保持与薄盘模式一致步长。门控常数与 diskHalfHeight 剖面同源（0.090+0.30·uDiskSoft, ×1.55, wv≤1.5, 采样截止 ×5 半厚）。
- **同环境 A/B 实测（IAB 1600×900，readPixels 强同步）**：默认 cine 视角 vol1 **−34%**（55.9→36.7ms）、极区俯瞰 **−19%**（21.8→17.7ms）、vol0 对照组 −1%（噪声，证明收益来自门控）；体积模式额外开销（vol1−vol0）从 40.1ms 降到 21.1ms，**砍半**。
- 观感验证：薄盘路径与原版**逐字节一致**（FNV 哈希 35ea26cb 三明治复现）；体积模式块均值网格 maxDiff=2/255、meanDiff=0.042（采样相位微移，肉眼不可见），截图目视一致。

**其他 shader 改动**（均逐位验证无输出变化）：
- 删除死湍流场 `n`（双相位 fbm4×2，第 8 轮 coverage 模型后无消费者——编译器此前已 DCE，源码层面清理）；
- **「湍流尺度」滑杆重新接线**：`q = pu * 3.20 * (uTurbScale * 0.33333334)`——默认 3.0 时因子精确归 1.0（同环境哈希逐位一致验证过；注意**不能用三元 select 形式**，ANGLE/D3D11 下 select 竟然改变像素）；
- Doppler/轨道速度块推迟到 cov 早退之后（被尘埃带剔除的样本不再白算 sqrt/pow）；pixPh/ev 提升出循环；死分支 fbm2 删除。

**测试方法论教训（重要）**：
- **跨环境的截图字节哈希不可比**——同一份代码隔夜哈希不同（IAB 缩放/驱动状态漂移，块均值网格也可能 ±1-2）。A/B 必须同环境分钟级内完成（git stash 三明治法：stash→测原版→pop→测改版→可再 stash 复验）。
- IAB 页内 setTimeout 节流程度随会话波动（昨天 1-2s 跑完的轮询基准今天 >2.5min）→ 长基准改用**单次同步 evaluate**（20 帧热身 + 30 帧实测 ≈ 2.8s，卡 3s evaluate 上限内）。
- 本会话 IAB 环境帧耗比历史会话慢 ~1.6-3.6×（35→56ms 漂移），绝对值只在本环境内可比。

## 10. 十轮（体积盘 2K 帧率攻坚,2026-11-05）

目标:默认设置(体积盘开/电影档 320 步)2K 120fps(8.33ms)。**结论:绝对目标未达成**——本环境
实测远景 vol1 ≈ 28-31ms(今日 IAB 环境系数 ~1.7-1.9×,健康口径 ≈ 15-17ms ≈ 60fps),但体积盘
相对成本大幅下降(累计 −40%),且画面零损伤。120fps 需再 −50%,现有安全手段已尽,除非
降步数(见下)或缩小盘面/降档。

**改动(全部只影响体积分支,薄盘路径逐位不变)**:
1. **门控精修**:门限改半径相关 `8.7×dHH(r)+1.0`(外盘薄→门限低,九轮是全局 5×hMax+1.2);
   lookahead 1.0→0.6(几何证明未加密段终点必高于门限,不跨板)。
2. **步长放宽(主收益)**:盘区加密 ×0.28→**×0.40**;贴板细分上限 hh→**1.6×hh**。
   同窗 A/B:远景 −35%、近景 −27%、极区 −35%(43.4/43.4/29.5 → 28.3/31.6/19.0)。
   亮度自守恒(ev∝segLen),网格对比 far max 1/255、polar max 5/255,目视无条带。
3. **壳层跳过**:不穿越中面且整体高于贡献截止的段整段跳过(免 4 次子采样)。
   **阈值必须分段保守**(关键坑):加密段(Δr≤~2M,梯度有界)用 10×dHH(r);非加密粗段
   (Δr 可达 12M)必须用全局 10×hMax——首版统一用 10×dHH(r) 被哈希等价性测试抓出
   粗段漏采隐患。修复后与禁用跳过**逐位一致**(f4e1ae18/716e607 双机位)。
4. hhStep 每步只算一次(门控/跳过/细分共用);子采样 5×hMax 预检保留。

**步数扫描**(远景同窗):320=28.3 / 192=21.0 / 128=20.3ms——步数节省大头在 192 步即拿到。
128 步阴影边缘收缩 2.5%(546 vs 560px@2560 宽)。**决定:电影档保持 320 步**(光子环是画面
签名);要更多帧率用 `?quality=high`(192 步,远景 −26%)。

**测量方法论补充**:本会话 IAB 环境帧耗在 ±30-50% 区间振荡(分钟级,疑似 GPU 时钟状态切换),
跨小时绝对值完全不可比;A/B 必须 stash 三明治 + 同窗完成;哈希等价性测试(改动的输出不变性)
比性能 A/B 更可靠,优先用它验证"零贡献剔除"类优化。
**第二档尝试(×0.48/2.2hh)已回退**:环境振荡幅度超过待测效应无法验收,且采样更粗风险更高;
当前终态 = ×0.40/1.6hh(远景哈希 f4e1ae18 与已验证态精确一致)。要再压帧率优先降步数
(?quality=high,192 步,远景 −26%)而非再放步长。

## 11. 十一轮（移动端低画质档 + 60fps 自适应重调,2026-11-05）

背景:用户红魔 9 Pro(骁龙 8 Gen 3/Adreno 750)线上实测 21fps @ 339×623(标准档 128 步)。
目标:手机 60fps,允许降分辨率/一定画质下降,关键元素必须齐全。

**改动**:
1. **新「低」画质档**(`QUALITIES.low`):DPR 上限 1.0、96 步、3 级 Bloom、体积盘 2 子采样
   (`uVolSub`,亮度按 `ev = segLen*(0.25-0.125*step(3.5,uVolSub))` ×2 补偿自守恒)、动态分辨率
   下限 0.35×(其余档 0.45×)。移动端无存档时默认低档(有存档尊重存档)。
2. **自适应分辨率重调**(`engine.adapt`):目标带 13.5–27ms → **7.5–9ms**。旧带对应 37–74fps
   (永远 servo 不到 60);新带利用「60/120/165Hz 屏幕上满帧 60fps 的 iv−vsync 信号同为
   16.7−8.5≈8.2ms」落在带内,稳定在 60fps。下限改按档位 `resFloor`。
3. **vsyncMin 封顶 8.5ms**(`main.js`):GPU 满载时 rAF ratchet 会一路追到 iv、把掉帧信号
   (ivEma−vsyncMin)归零,自适应在 GPU-bound 手机上失明;封顶后各刷新率的 GPU 超支都能被看到。
   副作用:60Hz 屏幕瞬态降档后不自动回升(iv≈16.7→eff 8.2 落在带内不动;切一次画质档复位)。
4. Q 循环 low→standard→high→cinematic;两个 select 加「低」;`?quality=low`;分享码通用透传;
   v2.2.0。

**验收(git stash 三明治 + IAB)**:
- **standard 档逐位不变**:a75252fd 精确一致。关键坑:子采样补偿第一版写成 `col += ... * evMul`
  (乘 ×1.0 数学恒等)但哈希改变——ANGLE/D3D 的 **FMA 收缩随表达式形状改变**;把补偿并进 ev
  本身(乘法形式、下游表达式逐字不变)后恢复逐位一致。与十轮三元 select 坑同族,已写入 AGENTS.md。
- 低档 80 步时阴影上缘内侧出现步数耗尽带(灰斑),96 步消除 → 定档 96。
- 低档页内双渲染逐字节一致(跨加载哈希差异为 IAB 环境漂移,§9 已知);Kerr 0.9 低档 0 错误;
  Q 循环/分享码 roundtrip/safemode/双 select 全过。
- 手机端帧率待用户真机确认(自适应会自动找到 60fps 平衡点)。

**用户反馈修复(同轮追加):自适应每几秒切分辨率 + 切换瞬间黑屏一闪**:
1. **黑闪根源**:adapt 在 renderOne 之后调用,resize 清空画布后合成器在下一帧绘制前采样到
   空画布。修复:主循环改为**先 adapt(可能 resize)再 renderOne**,同帧立即重绘;
   `engine.resize()` 末尾再补一枪 `renderFrame(_lastRender)`(renderFrame 记录最近参数),
   覆盖窗口变化/手动切档等事件驱动路径——IAB 实测切档后同帧截图即为满内容(7MB PNG,非黑)。
2. **切换频率**:决策窗口 45→90 帧;出带需**连续 2 个窗口**确认;回升加 `_failScale` 上限
   (记住引发掉帧的档位,回升不超过 ×0.97,带内时每窗口 ×1.01 缓慢上探)防 60Hz 极限环;
   降档步进 0.87→0.90、回升 1.06→1.05。
3. 长曝光开启时暂停 adapt(resize 会清空累积缓冲导致画面跳变)。
4. 回归:standard 档逐位一致(a75252fd);IAB 低档实况 60s 六次采样分辨率零变化(110fps 稳定);
   0 控制台错误。

**十二轮(用户再反馈:60fps 但 130×239 太糊)——低档 30fps 重定义**:成本拆分(盘 45%/基础 55%)
后,低档三杠杆全在盘区:`uDensify` 0.55(加密放宽)、`uSubCap` 2.2hh(贴板细分放宽)、`uFarMul` 5
(远场步长 ×6)——全部是同一积分的更粗求积,ev 自守恒,默认档逐位不变(a75252fd)。桌面 A/B 低档
13.31→9.49ms(−29%),盘开销 −57%。`resFloor` 0.8(手机 ≈297×546 = 用户 300×600 下限);目标带
按档位:低档 20–26ms 伺服 ~30fps(60Hz 屏 30fps 信号 = 33.3−8.5 = 24.8 落带内),其余 7.5–9 伺服
60fps。`uVolSub=1` 段中点机制就位未启用(QUALITIES 一行开关的储备)。v2.2.1。详 TESTREPORT §16。

**十四轮(首访功能引导)**:`src/guide.js` 6 步聚光卡(含画质调节),面板「引导」重开,
`?guide=1` 强制 / `?guide=0` 禁止,API `startGuide()`,自动化场景(still/snap/webdriver/reset/
tour/s/panel/safemode/无HUD)一律豁免。**命名坑**:ui opts 的 `onGuide` 已被摄影构图线占用,
引导回调是 `onStartGuide`。v2.3.0。详 TESTREPORT §18。

**十三轮(代码审查)**:修 adapt 跨档状态泄漏(setQuality 清零 _failScale/连击)、
主循环对象分配归零、hhStep 盘区门控(远场免 pow);低档 ×0.55 壳层跳过经禁用 A/B
逐位等价(9dca6c1f),安全边际确认。详 TESTREPORT §17。

**十六轮(最低分辨率下限滑条)**:面板顶部新增「最低分辨率」滑条(0.20–1.00×,默认「自动」)
+「自动」按钮,控制自适应动态分辨率的硬下限。`state.minScale`(null = 自动跟随画质档
`resFloor`;低档 0.8×,其余 0.45×),持久化 + `?minscale=`(0 = 自动)+ API `setMinScale`
(info 输出 `minScale/resFloor/resScale`)。`engine.setResFloor` 调高到当前倍率之上时立即
resize 抬回;拖动中只更新状态/显示,松手(`change`)才应用,避免逐步重建管线。默认路径
(override=null)与旧版逐位一致:同环境 stash 三明治截图哈希 **d76e64d0 三连一致**。v2.4.0。
详 TESTREPORT §20。

**十七轮(盘面采样修复 / TAA / 交互增强)**:
- **盘面缺块 + 粒子-纹理条带(同一根因)**:体积盘用段内 4 子采样,远场大步
  (低档 `uFarMul=5` 时单步可达 8M)会直接跨过薄盘中面,子样本全部落在薄层外 →
  低画质前方盘面缺一块;同时也产生"粒子-纹理交替"条带。修复:Verlet/Kerr 两条路径
  在预计本步会穿过盘面(且交点半径在盘内)时把 `dt` 缩到穿越前(0.85·t_cross),
  下一次迭代在薄层门控内加密采样;`ev` 按实际段长自守恒,亮度不变。低画质分享链接
  实测前方缺块消失、条带消失。**只对 r > 1.6·r_in 生效**——内圈保留旧版软边,避免
  近侧内缘白带变硬、像"嵌进"阴影。
- **纹理角向接缝**:`th01*1.6` 非整数 → θ 在 2π 回绕跳 0.6 个纹理周期;`warpR` 用
  非周期 `vnoise(th01*9)` → 接缝两侧 warp 跳变。改为 `th01*2.0`(整数重复)+
  `vnoise(vec3(cosθ*1.45, sinθ*1.45, 2.0))`(圆周坐标连续)。**半径必须 1.45**:
  2π·1.45≈9,匹配旧版 θ 路径长度 0..9;用 *9 会让角向 warp 频率高 6 倍,盘面出现
  放射状扭曲怪纹(上线后用户反馈,见 §12 追加修复)。
- **盘面纹理采样(上线后追加修复)**:一度改为**每像素统一控制流预采样** +
  NearestFilter 手写 4 tap 双线性,虽然规避了体积循环的隐式 LOD 抖动,但预采样锚点
  对远侧透镜像/内缘是错的 → 红色箭头处的放射状扭曲纹理、蓝色箭头处更硬的内圈白带。
  已回退为**按真实交点逐样本 LinearFilter 采样**;环境级 2/255 双稳态为原始代码已有,
  视觉正确性优先。同环境 720p 基准与 v2.4.0 差 ~3.6%(环境噪声内)。
- **TAA**:累积模式改为 `taa`(默认)/`le`。TAA 渐进权重 `1/min(n,N)` + Halton 抖动;
  `renderFrame` 检测相机位置/基向量变化 → `invalidateAccum` 立即丢历史(移动不拖影);
  参数/开关/种子变化也丢历史;冻结模式每帧权重 1 覆盖。长曝光光轨保留为可选模式,
  导出时 TAA 冻结时间多采样、长曝光推进时间。UI:按钮 + 模式下拉 + 帧数滑杆;
  `?lm=`、分享码 `lm`(旧分享码 le=1 兼容为长曝光)、API `setAccumMode`。
- **循环卡顿**:① `engine.adapt` 调分辨率时 `resize(false)` 跳过额外重绘——此前
  resize 内重绘 + 主循环 renderOne 会让该帧渲染两次,自适应每 90 帧左右一次可见卡顿;
  ② 电影循环在接近赤道面时把半径平滑抬到 `diskOuter+3M`(盘面 1.0+1.2×厚度 的过渡带),
  不再从盘内穿过(原轨迹在 t≈35s / 76s 穿过吸积盘,近场体积成本暴涨)。
- **弹弓**:拖拽位移 >6px 不触发发射(浏览器 pointerup 后补发 click 的老坑);光子扇
  最多保留 3 组、旧扇渐淡,拖拽观察时旧轨迹不再消失。
- **飞行**:移除 pointer lock,改为拖拽环视(鼠标空闲可点按钮);新增 Q/E 滚转
  (角速度积分);Q/E 全局切画质/EHT 快捷键移除。
- **摄影**:胶片风格「默认」此前 params 为空对象、点了没反应;现在进入摄影模式时
  快照 6 个后期参数 + 4 个摄影调整,「默认」恢复。新增亮度/对比度/饱和度/色温
  滑杆(中性值 `uPhotoAdj=0` 绕过,默认画面不变),持久化 + 分享码 `pa` + API。
- **分享码参数顺序**:先应用 `spin` 再应用其余参数。旧实现按对象顺序先设 `diskInner`,
  会被默认 spin=0.318 的 ISCO 4.91 抬上去并标记为手动值,分享码里的 4.63 丢失
  (用户低画质链接复验 inner=4.63 / spin=0.396)。
- **UI/品牌**:标题与 H1/覆盖层/水印 → Gargantua-Echo;「参数」页改名「设置」;
  成就入口上 HUD(🏆,手机隐藏,面板保留);手机 HUD 分两层(品牌卡独占一行、工具按钮
  下移),摄影条移到 HUD 下方;音乐入口补进设置面板。
- **确定性**:`?freeze=1&still=1` 截图前空跑一帧 + `readPixels(1×1)` 强同步(冻结模式),
  但本 IAB 环境仍有约 30% 概率出现 2/255 的双稳态差异——**原始代码同样复现**,
  属环境/GPU 级抖动;默认哈希 **`a45a1394`**(v2.5.1,1280×720,4 组双截图全一致)。
- **v2.5.1**(上线后追加修复:回退纹理预采样、warp 半径 1.45、内圈软边)。详 TESTREPORT §21/§22。

## 12. 待办 / 可选方向（均未开始，等用户指令）

- 暂缓：双黑洞并合（含 LIGO chirp）、WebXR（无硬件不可验，不盲发）。
- 候选：视频导出（WebCodecs）、相机关键帧编辑器、分屏对比滑块、多普勒声效、hover 星表识别、
  倾斜盘+进动、引力波模式、TDE 场景、双语 i18n、PWA、课堂模式、参数画廊。
- 未决小项：无。当前构建干净、0 错误。

## 12b. 十八轮(移动端 HUD 遮挡修复 + 代码审查,v2.5.2,2026-11-06)

**用户反馈**:手机竖屏顶栏预设按钮整排盖住状态行(真机截图)。根因:十七轮手机两层顶栏
`#hud-tr { top: 58px }` 低估品牌卡高(标志圆 34px 未随移动端缩小 → 卡底 ~61-69px)。

- **CSS 修复(仅移动端媒体查询)**:`.bh-mark` 缩到 26px;`#hud-tr` top → calc(68px +
  env(safe-area-inset-top));`#hud-tl`/`#hud-br` 补 safe-area(配合 viewport-fit=cover 的
  PWA/全屏刘海)。IAB 378×624 视口实测:卡底 61.8 / 按钮顶 68,间隙 6.2px,不再遮挡。
- **手机性能**:`(pointer: coarse)` 下常驻 HUD 卡片/按钮关闭 backdrop-filter(背衬是逐帧重绘
  的 WebGL 画布,移动 GPU 常驻合成开销),底色 0.62→0.80 保读性;面板/导览/摄影等瞬时浮层
  保留模糊。桌面窄窗口不受影响(该查询只命中触摸主设备)。
- **审查修复**:
  - P2 `applyShareCode` 参数表逐键 isFinite 守卫(此前损坏分享码的 NaN 会穿过 clampParam
    进相机/引擎 → 黑屏无报错;九轮只校验了相机数组);
  - P2 `setView` 补 `invalidateAccum()`(调试视图切换在 TAA/长曝光下混影 N 帧);
  - P3 主循环 `ach.tick`/`annotations.update` 的 opts 对象提升复用(每帧零分配补漏);
  - P3 `engine._setJitter` 的 halton 闭包提为模块层函数(逐字同算法);
  - P3 `annotations.update` 静止画面跳过重建(位置+四元数+FOV+aspect+盘参数全等才跳;
    飞行拖拽只转不移,必须连四元数比对);
  - P3 `adapt` 死代码 `_lastAdapt` 删除;Esc 现在也关成就图鉴。
- **验证**:默认视图哈希 `c6811b12…` 改前改后逐字节一致(Kerr 路径在内,渲染零改动);
  冻结确定性 `70579587…` 一致;全程 0 错误;损坏分享码非法值全跳过、合法值生效;
  分享码静态往返逐键一致。详 TESTREPORT §23。

## 12c. 十九轮(4K 导出滚转修复 + 分享码携带飞行朝向,v2.5.3,2026-11-11)

**用户反馈**:飞行模式 QE 滚转后导出 4K 没有滚转;"屏幕"档正常。

- **根因**:`exportImage` 导出前统一调 `controls.update()` 推进 cine/orbit 姿态——飞行模式下
  OrbitControls.update() 会把相机重新 lookAt(target),滚转与环视姿态整体被抹掉。
  修复:fly 分支**不做任何相机操作**(姿态已由主循环 flight.update 维护)。
- **分享码 v1 增量**:飞行模式 `c` = `[x,y,z,fov,yaw,pitch,roll]`(7 元素,YXZ 欧拉与 flight.js
  同序,3 位小数);解码按长度区分,旧 4 元素码零影响。`obj.m` 字段首次接线(此前只写不读):
  `m:'fly'` 恢复飞行模式,旧 4 元素码由位置对准原点推姿态(滚转 0),新 7 元素码在
  `setMode('fly')→flight.enter()` 前写好欧拉角、滚转原样恢复。
- **验收**:滚转态 4K 导出盘面对角滚转(目视)+ 无滚转对照 SHA256 不同;滚转分享码
  运行时往返与 URL 初始化均逐位一致;默认冻结截图旧码 vs 新码**逐像素 diff=0**;
  0 错误。详 TESTREPORT §24。
- **方法论**:①跨页面会话截图哈希再次证实不可比(两次加载 67819500 vs 700e8128,
  像素 diff 却为 0)——判定渲染影响必须同页面像素 diff 或 stash 三明治;②IAB rAF 挂起是
  动态的,依赖逐帧推进的测试用 `renderOne()×N` 同步驱动。

## 12d. 二十轮(全量代码审查:导出原子性 / NaN 守卫 / 输入隔离,v2.5.4,2026-11-11)

全部 20 个源文件通读复审(shader 逐行)。**渲染路径零改动**(下证),JS 编排层修复:

- **P2 setParam 总闸**:`gargantua.setParam('spin','abc')` 经 parseFloat→NaN→clampParam(NaN)
  直进 uniform 黑屏无报错(十八轮只修了分享码参数表,API 路径裸奔)。setParam 内
  `isFinite` 总闸;Infinity 按 clamp 语义夹回上限(设计行为,非毒药)。
- **P2 导出原子性家族**:`exporting=true` 期间仍能踩踏离屏管线的路径全堵——
  `reseed()`/API `setSeed`(改 uSeedOff)、`applyShareCode`(seed+photoAdj 绕过守卫)、
  `setView`(invalidateAccum 重置 TAA 多帧导出累积)、`setPhotoAdj`(合成 uniform)。
- **P2 飞行输入隔离**:flight 的 window keydown 不看 e.target,面板输入框里打 "35"
  会触发 W/A/D 前后移动。INPUT/SELECT/TEXTAREA 目标忽略。
- **P3**:engine.dispose 漏 matAccum;achievements 死字段 `_viewCue`;annotations
  投影用上一帧 matrixWorldInverse(运动时叠加层滞后 1-2 帧)→ update 内
  `cam.updateMatrixWorld()`(仅运动时走到,静止已被跳过);HANDOFF 差速剪切 ×5→×2 文档漂移。
- **性能结论**:JS 热路径已零分配(十三/十八轮),shader 侧十轮已证无安全余量——本轮
  不动逐位输出。

**验收(IAB,同步 API)**:NaN 全拒绝/Infinity 夹回 0.998 ✓;飞行 INPUT 打字 d=0 / window
正常 d=4.7 ✓;导出中 setView+setSeed+setParam+applyShareCode+setPhotoAdj 五路踩踏全部
no-op 且 4K 导出正常完成 ✓;默认冻结截图 stash 三明治**逐像素 diff=0** ✓;确定性 6 连拍
恒定 ✓;滚转分享码往返逐位一致(roll 0.9)✓;0 错误 ✓。基准:view0≈view9≈72ms
@1600×900×320步(本会话环境底噪主导,盘面拆分不可测;像素 diff=0 已从结构上排除回归)。
详 TESTREPORT §25。

## 12e. 二十一轮(坠入之旅:参考 NASA 模拟的脚本化游览,v2.5.5,2026-11-11)

用户需求:「参考 NASA 模拟坠入黑洞做一个绕转坠入黑洞的游览」(NASA Goddard 超算可视化,
Schnittman & Buonanno——远景绕转一周→穿越吸积盘→坠向视界)。

- **新模块 `src/plunge.js`**:76s 四幕脚本化运镜——①远景绕转整圆(36→32M,26s);
  ②俯冲穿盘(极角加速越过 90°,穿面点设计在盘内 ~0.82×(32−rX)+rX,|y|=0.03 实测,
  白屏 ~0.8s;穿面半径按用户盘参数自适应 rX=clamp(2.2×inner,10,max(11,outer−1.5)));
  ③贴盘俯冲(拉升出盘再滑向黑洞,二次穿盘即"钻出");④加速坠向 r=2.05M(渲染物理
  有效区边缘),T_TURN=65s 起 4 秒转身背对黑洞看身后宇宙(NASA 标志性回头),黑场
  (CSS #plunge-fade,2.6s)在 69.5s 渐入,76s 收尾回远景。轨迹纯参数曲线,自身时钟
  按渲染帧 dt 累加,确定性。
- **接线**:renderOne 驱动链 plunge 分支(与 cine/fly 同级);setMode/gotoPreset 在
  plunge 期间拒绝抢占;setTour(false) 在坠入期间 = 退出坠入(复用导览字幕卡,
  `#tour.plunge` 隐藏上一/下一站);HUD「⤓ 坠入」+面板按钮+B 快捷键+`?plunge=1`+
  API `setPlunge`/测试钩子 `_plungeSeek`;新成就「越界者」(13→14 项)。
- **物理边界**:不真正穿越视界——渲染器只在视界外积分有效;黑场 = 信号中断的叙事表达。
  穿盘两次短暂进入体积盘(相机在介质内),近场成本由自适应分辨率吸收。

## 12f. 二十二轮(坠入之旅 v2:测地线螺旋 + 移动端双摇杆,v2.6.0,2026-11-11)

**用户反馈**:①坠入不该是自由落体,而是"初速略偏中心→被引力捕获→螺旋绕转逐渐坠入",
视线始终朝向速度方向;②手机飞行模式加双摇杆(左=俯仰/滚转,右=进退/偏航)。

- **plunge.js 重写(v2,测地线版)**:坐标时积分 Schwarzschild 束缚轨道
  `dr/dt = s(1−2/r)√(E²−V)`,`dφ/dt=(1−2/r)L/(E r²)`,V=(1−2/r)(1+L²/r²);
  **耗散 dL/dt=−kL·L/r²、dE/dt=−kE·E/r³**(kL=0.008/kE=0.00016,Python 调参:
  75s 内 4.3 圈,近点序列 7.6→6.9→6.6→6.2→5.8→5.3→4.7→坠入)。
  E0=0.97(束缚=天然"被俘获"),r0=20,T_SCALE≈6.2 M/s;轨道面倾盘面 20°(每圈两次
  短暂穿盘白屏)。自适应子步(单步角增量 ≤0.03 rad)。视线 = 位置+单位速度×5
  (解析速度方向)。字幕改**轨迹事件触发**(启程/首次节点穿越且在盘内/ r<6 / r<3.05 /
  r<2.55+黑场),与实际飞行同步;`seek(sec)` 快进钩子按 1/60 真实积分推进。
  **不真正穿越视界**(渲染器只在 r>r_s 有效),黑场=信号中断。
- **移动端双摇杆 `src/joysticks.js`**:触摸设备 + 飞行模式启用(层 z=8 盖画布不遮 HUD);
  浮动式(按住哪半边屏幕底座在哪),多点触控各管各的,松手归零。
  左摇杆 pitch/roll、右摇杆 thrust/yaw;flight.axes 轴在 update 内按角速度积分
  (与 Q/E 同框架;键盘路径逐字节不变——thrust=0 时全部跳过)。飞行 toast 提示摇杆。
- **验收**:轨迹采样(20→8.8→7.3 穿盘→6.1→4.2→坠入回远景)与 Python 调参一致;
  穿盘/绕行帧目视(视线朝速度方向,盘面/光子环掠过);摇杆 PointerEvent 模拟轴值
  全对、松手归零;flight.axes 三轴驱动相机(位移/转向/爬升)✓;
  默认冻结截图 stash 三明治(8727e8d 与 v2.6.0 工作区双对比)**逐像素 diff=0**;0 错误。
  详 TESTREPORT §27。

## 13. 八轮(参考配方盘面重写,2026-11-04)

- **盘面模型换成参考项目做法**:`coverage = pow(1-rg,1.35) × 垂直锥 × 6 层乘积噪声 × 有机纹理 × 内密外疏`,`dustGlow=1/(rg²·120+0.02)` 内缘白热 + `vGlow=1/(y²·45+0.01)` 垂直光晕;旧的等值面密度/伪光影/独立 rimGlow 已移除。
- **体积模式**:恢复 4 子采样 + 逐像素相位抖动(单采样会出同心圆壳,固定相位会出竖条纹),亮度系数按 readPixels 实测配平到 2.20(俯视 volOn/volOff ≈ 0.95)。
- **噪声坐标改直角坐标** `q = pu*3.20`,消除放射状辐条;角向域扭曲保留大尺度旋涡。
- **新增开关**「参考配色」:内缘白 → 外缘橙褐;默认**开**。URL `?refcolor=1`,API `setRefColor`。
- **分享码 v1 增加 `t` 字段**:打包 8 个开关(vd/rs/an/eht/fg/rc/wm/ga),旧链接无 `t` 时沿用接收方状态。
- **物理修正**:`diskInner` 任何路径下都钳到自旋对应的 ISCO(自旋 0 → 6M,a=0.318 → 4.91M);差速剪切双相位周期 10s→25s、放大 ×5→×2,接缝跳变肉眼不可见。
- **默认值**更新为分享场景:FOV 57.5、cinematic、体积盘开、参考配色开、内径 4.91、外径 16.5、厚 0.31、自旋 0.318、曝光 0.53、暗角 0.48、颗粒 0.045、色散 0.3、泛光 0.04。
- 已知遗留:体积模式亮度随视线路径长度变化,俯视配平、侧视略亮(真实体积的固有特性);`dopplerBeaming` 现为物理值 1.0。

## 14. 文档索引

- `AGENTS.md`：常驻工作约定（自动加载）——启动命令、硬约束、验收流程，开工先读。
- `TESTREPORT.md` 第 12 节：七轮（参考配方升级）验证；第 11 节已知环境限制。
- `README.md`：用法/参数/开关/URL/API/性能/目录/错误恢复。
- `TESTREPORT.md`：历轮证据；**末节 = §23 十八轮（移动端 HUD 遮挡修复 / 代码审查 v2.5.2）**；含已知环境限制。
- 记忆文件：`~/.zcode/cli/memories/projects/ai-playground-9dcf04bbe96961ed/memory/gargantua-53f-project.md`
  （含历轮技术要点与测试坑，MEMORY.md 有索引行）。
