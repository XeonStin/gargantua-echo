# GARGANTUA gargantua-echo — 会话对接文档（Handoff）

> 用途：压缩上下文后的续接说明。读完本文件 + README.md + TESTREPORT.md 即可无缝接手。
> 最后更新：2026-11-05（十四轮：首访功能引导 + 十三轮审查修复）

---

## 1. 项目速览

| 项 | 值 |
|---|---|
| 路径 | `C:\Users\HJF\Desktop\AI-playground\gargantua-echo\` |
| 线上 | <https://xeonstin.github.io/gargantua-echo/> —— 仓库 `XeonStin/gargantua-echo`（原名 `xeonstin.github.io`，2026-11-04 改名后从用户站变为项目站，`master` 根目录发布到子路径 `/gargantua-echo/`；全站相对路径无需改动。旧 2016 站备份在 `..\_backups\xeonstin.github.io-2016`） |
| 启动 | `cd gargantua-echo && python serve.py 5300` → `http://127.0.0.1:5300/`（本会话后台任务，进程可能已结束，重启即可） |
| 技术栈 | 原生 HTML/CSS/JS + ES Modules + 本地 three r170（vendor）+ 零构建 + 静态服务器 |
| 核心 | 全屏 Fragment Shader 实时积分黑洞零测地线；**Schwarzschild 速度 Verlet** + **Kerr-Schild 哈密顿**双路径 |
| 当前版本 | `window.gargantua.version = '2.2.0'`，24 参数，API 见 README |
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
- 湍流 = 刚体旋转(Ω_ref) + 有界差速剪切（**基准取盘外缘 Ω_outer，diff≥0 保证内外同向**，×5 放大，双相位防无限剪切）；
- 丝状层 = 各向异性柱坐标（切向 ×0.55）上 4 层 vnoise **相乘**；
- 细节纹理 = `uDiskTex`（disktex.js 烘焙）按 (θ·3, r·1.6) 采样，`clamp(detail²·4,0.1,1.7)` 混合 0.5；
- 内缘白热环 = Lorentzian `0.9/((rimDist·14)²+0.06)`，密度门控、体积盘 ×0.35；
- 体积盘 = 段内 **4 子采样**（防阶梯带;低档 2,亮度按 ev 补偿,见 §11），盘区步长 ×0.40（十轮放宽,含薄层门控与壳层跳过,见 §10）；
- 电影色调（uFilm）：盘面双色带 + 合成胶片曲线（S 0.32 + 通道 gamma 1.08/1.03/1.0 + 抬暗 0.94）。

## 4. 功能清单（全部可用）

- **模式**：cine（电影循环）/ orbit / fly（G；WASD+R/F+滚轮；安全边界可调 2.01–3.0M）
- **24 参数**：fov、盘 8 项、相对论 6 项（**spin / jetPower** 等）、星空 3、后期 6
- **开关**（面板工具行，`TOGGLE_IDS` 映射）：体积盘 / 电影色调（默认开）/ 标注 / EHT / 水印 / 弹弓
- **HUD 按钮**：循环 / 飞行 / 导览 / 摄影 / 音乐 / 截图 / 画质 / 参数
- **快捷键**：Space/O/C/G、Shift+1-4、0-9、P/H/M/S/V/T/E/N、R/Shift+R、F、Q
- **其他**：导览 7 站（T）、摄影模式（V，胶片预设/构图线/水印）、成就 13 项、分享码（?s=）、
  时间膨胀显示、自旋自动跟 ISCO、Kerr 喷流、4K/8K 导出（屏幕/4K/8K）
- （九轮移除：真实星空/耶鲁星表烘焙——观感不佳，`src/stars.js`、`assets/data/bright-stars.js`、
  `tools/gen_stars.py` 已删除；`?stars=` 与 `setRealStars` API 不复存在，旧分享码的 `t.rs` 字段被忽略）

## 5. URL / API 速查

URL：`?preset ?mode ?view ?quality ?p= ?seed ?t ?fps ?le ?lef ?exp ?fov ?vol ?anno ?eht ?film ?refcolor ?flyb ?tour ?s ?cine ?music ?hud ?panel ?freeze ?still ?snap ?safemode ?reset`（`?stars` 已随真实星空移除）

API：`setParam/setParams/getParams、setView/setQuality/setPreset/setCine/setSeed、setFpsCap/setExportSize、
setLongExposure/setExposureFrames、setVolDisk/setAnnotations/setEHT/setFilmGrade/setRefColor/setWatermark、
setTour/setPhoto/setGeoArm/launchPhoton、setFlyBoundary、share/applyShareCode、renderFrames/renderOne/benchmark、
screenshot/exportImage/screenshotDataUrl、info()`；`window.__LAST_EXPORT__`、`window.__GARGANTUA_ERRORS__`。
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

## 12. 待办 / 可选方向（均未开始，等用户指令）

- 暂缓：双黑洞并合（含 LIGO chirp）、WebXR（无硬件不可验，不盲发）。
- 候选：视频导出（WebCodecs）、相机关键帧编辑器、分屏对比滑块、多普勒声效、hover 星表识别、
  倾斜盘+进动、引力波模式、TDE 场景、双语 i18n、PWA、课堂模式、参数画廊。
- 未决小项：无。当前构建干净、0 错误。

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
- `TESTREPORT.md`：历轮证据；**末节 = 十一轮（移动端低画质档）验证**；含已知环境限制。
- 记忆文件：`~/.zcode/cli/memories/projects/ai-playground-9dcf04bbe96961ed/memory/gargantua-53f-project.md`
  （含历轮技术要点与测试坑，MEMORY.md 有索引行）。
