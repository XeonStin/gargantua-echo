# GARGANTUA — Schwarzschild / Kerr Black Hole Raytracer

全屏交互式黑洞渲染网站。主体是**一个全屏 Fragment Shader**,逐像素实时积分黑洞零测地线。
支持两条物理路径:

- **Schwarzschild**(自旋 0,默认):速度 Verlet 积分 `a = -(3/2)·r_s·h²·x/r⁵`(h = |x×v| 守恒,
  精确再现 GR 轨道方程 `u'' + u = (3/2)·r_s·u²`);
- **Kerr**(自旋 > 0):Kerr-Schild 笛卡尔坐标哈密顿积分 `H = ½g^{μν}p_μp_ν`(RK2 中点法),
  参考系拖曳、D 形不对称阴影、ISCO 内移由积分自然涌现。

事件视界、光子环、多次吸积盘穿越、引力透镜均由积分自然涌现——**没有黑球、没有平面圆环、
没有任何贴图/视频/截图**。原生 HTML/CSS/JavaScript + ES Modules + 本地 Three.js r170
(vendor 内置),零构建,任何静态服务器可直接运行。

## 在线版

- 线上地址：<https://xeonstin.github.io/gargantua-echo/>
- 源仓库：<https://github.com/XeonStin/gargantua-echo>（GitHub Pages 项目站，`master` 根目录发布到子路径 `/gargantua-echo/`；全站相对路径引用，无需构建）

## 启动

```bash
cd gargantua-echo
python serve.py 5300        # 或 python serve.py(默认 5300)
# 打开 http://127.0.0.1:5300/
```

要求:支持 WebGL 2 的现代浏览器(Chrome / Edge / Firefox / Safari 15+)。

## 交互与快捷键

| 输入 | 作用 |
| --- | --- |
| 拖拽 / 滚轮 | OrbitControls 环绕 / 缩放(自动接管镜头循环) |
| `Space` | 播放/暂停电影镜头循环 |
| `O` / `C` / `G` | 自由轨道 / 电影循环 / **自由飞行**(WASD 移动 · R/F 升降 · 滚轮调速 · 点击画面锁定环视;**安全边界在参数面板可调**,2.01–3.0M,贴界时时间膨胀 ~14×) |
| `Shift+1..4` | 视角预设:远景全景 / 赤道临界 / 极区俯瞰 / 近界掠行 |
| `0`–`9` | 调试视图:合成 / 原始HDR / 泛光 / 积分步数 / 命中分类 / 多普勒 / 引力红移 / 盘温 / 穿越次数 / 纯星空 |
| `P` / `Esc` | 参数面板(24 项,分组滑杆) |
| `T` | **导览模式**:7 站中文之旅(自动飞行 + 字幕,可打断) |
| `V` | **摄影模式**:胶片风格预设 + 三分/黄金构图线 + 导出水印 |
| `E` | **EHT 视角**:模拟事件视界望远镜的有限角分辨率(参考 M87*) |
| `N` | **物理标注**:阴影 b_c=√27·M / 视界 r+ / ISCO 理论位置投影 |
| `H` / 双击 | 显示/隐藏 HUD |
| `M` | 氛围音乐(本地 `assets/audio/ambient-drone.wav`,32s 无缝循环) |
| `S` | 保存 PNG 截图(分辨率跟随面板「导出分辨率」) |
| `Q` | 循环画质档:低 / 标准 / 高 / 电影 |
| `→` / `Esc` | 功能引导:下一步 / 关闭(引导开启时) |
| `R` / `Shift+R` | 复位视角 / 复位参数 |
| `F` | 全屏 |

## 24 项参数

相机:视场角 FOV(25–110°,默认 57.5°)  
吸积盘:盘内半径、盘外半径、盘厚软硬、盘亮度、峰值温度 K、自转速率、湍流强度、湍流尺度  
相对论:**自旋 a/M(0–0.998)**、**相对论喷流**、多普勒增亮、多普勒色移、引力红移、透镜强度  
星空:恒星密度、恒星亮度、银河亮度  
后期:泛光强度、泛光阈值、曝光、暗角、胶片颗粒、色散

**功能引导**:首次访问自动弹出 6 步聚光卡(欢迎 / 视角预设 / **画质调节** / 参数面板 / 工具与快捷键 / 完成);
聚光层不拦截指针,引导开着就能直接试画质下拉。可随时在**参数面板 → 引导**重新打开。
URL `?guide=1` 强制弹出、`?guide=0` 禁止;API `startGuide()`。

盘内半径不得低于 ISCO:任何设置/分享码/自旋变化都会自动钳到 ISCO(自旋 0 → 6M,a=0.318 → 4.91M)。自旋 > 0 时:盘内半径自动跟随 ISCO(a=0.9 → 2.32M)内移;手动改过或显式 URL 给出(`?diskInner=`)则不再自动跟随,**但 ISCO 物理下限钳制始终生效**(低于 ISCO 的显式值会抬回 ISCO,更大的值不会被重置)。

## 面板工具开关(参数面板顶部)

| 开关 | 说明 |
| --- | --- |
| **体积盘** | 薄面穿越 → 体积积分(盘有真实厚度与自遮挡)。**薄层门控 + 步长自适应**(十轮):只有接近盘面薄层的光线才加密步长,盘区步长按机位与盘厚自动调节——体积模式额外帧耗约为早版本的 1/3,观感不变 |
| **参考配色** | 盘面改用参考项目的调色:内缘纯白 → 外缘橙褐;关闭时用物理黑体 + 多普勒色移 |
| **电影色调** | 默认开。盘面:乘积八度丝状气体层 + 本地烘焙有机细节纹理 + 内缘白热环 + 双乘法色带(内蓝白→外深橙);合成:胶片 S 曲线 + 通道 gamma 暖偏 + 暗部轻抬。关掉即回到纯 ACES 观感 |
| **标注** | 阴影/光子环(b_c = √27·M)、视界 r+、ISCO 的理论位置投影(SVG) |
| **EHT** | 合成 pass 内模拟地球尺寸基线的模糊 + 橙红环像 |
| **水印** | 导出 PNG 左下角附参数摘要(等效 EXIF) |
| **弹弓** | 点击画面发射一圈光子:CPU 端用与着色器同源的 Kerr-Schild 方程积分,真实弯曲轨迹叠加显示 |

工具按钮:**导览**(T)、**摄影**(V)、**成就**(13 项图鉴,localStorage 持久化)、**分享**(复制含全部参数与相机的链接)、**导入**(粘贴 `?s=` 分享码)。

## 画质档

- **低**:DPR 上限 1.0,96 积分步,3 级 Bloom,体积盘 2 子采样 + 盘区积分粗化
  (加密 ×0.55/贴板细分 2.2hh/远场步长 ×6,**移动端默认**;动态分辨率下限 0.8×,
  自适应伺服 ~30fps——用帧率换清晰度,分辨率优先)
- **标准**:DPR 上限 1.5,128 积分步,4 级 Bloom
- **高**:DPR 上限 2.0,192 步,5 级 Bloom
- **电影**:DPR 上限 2.0,320 步,6 级 Bloom(桌面默认)
- 各档均以原生 CSS 分辨率 × DPR 渲染,帧耗过高时自适应动态分辨率自动下调
  (目标带按档位:默认 7.5–9ms 伺服 60fps;低档 20–26ms 伺服 ~30fps;其余下限 0.45×)
- 低档粗化都是「同一积分的更粗求积」:亮度按权重补偿自守恒,物理(测地线/多普勒/红移)不变
- **帧率限制**:面板内可选 不限/30/60/90/120/144/165(令牌桶节流,跳过帧不推进时间)
- **长曝光**:后期分组开关 + 曝光帧数滑杆(2–64)。帧累积(EMA,RGBA16F 单缓冲 alpha 混合)。
  **开启时每帧自动做亚像素抖动(Halton 序列)——帧累积顺带完成时域超采样抗锯齿**;
  冻结模式抖动归零,确定性截图不受影响。松手提交时清空旧累积,变化立即可见
- **截图导出分辨率**:屏幕 / 4K(3840×2160)/ 8K(7680×4320),按目标尺寸重建整条 HDR 管线
  逐像素重新积分(非插值);导出期间冻结主循环;8K 实测 68.5MB / 2.2s
- 另有 `?safemode=1` 安全模式;自适应动态分辨率(「不限」时启用,掉帧信号 = CPU 提交耗时与
  rAF 间隔超出 vsync 部分取大者)

## 物理与渲染管线

1. **主 pass**(全屏三角形):每像素从相机发射光子,自适应步长积分。Schwarzschild 走
   速度 Verlet 快速路径;自旋 > 0 自动切换 Kerr-Schild 哈密顿 program(独立编译,不占
   快速路径寄存器)。跨越赤道面时插值求交,按 Kerr LNRF 轨道速度 + 多普勒
   (`g = 1/γ(1-β·n̂)`)与引力红移调制黑体色温与亮度,透射率累加支持多次穿越;
   **步数耗尽的近临界光线用当前方向采天空**(比留纯黑更接近高步数积分)。
2. **吸积盘**:零扭矩辐射通量 `F ∝ r⁻³(1-√(r_in/r))`,温度 `T ∝ r^(-3/4)`,黑体配色
   (256 项 LUT);湍流 = 刚体旋转 + 有界差速剪切 + FBM;体积模式下按路径长度加权积分。
3. **喷流**:沿自旋轴的准直锥,蓝白同步辐射色 + 螺旋 FBM 湍流,发射型路径积分,天然被透镜弯曲。
4. **星空/银河**:方向网格哈希三层恒星 + 银道带 FBM 云尘。
5. **Bloom**:软阈值亮通 → 半分辨率金字塔 → 帐篷上采样(0.72 衰减)。
6. **合成**:径向色散 → Bloom → 曝光 → ACES → 伽马 → 暗角 → 颗粒(EHT 模式在此分支)。
   HDR 全程 RGBA16F。

## URL 自动化接口

| 参数 | 说明 |
| --- | --- |
| `?preset=0..3` | 视角预设(自带 FOV,除非显式给 `?fov=`) |
| `?mode=cine/orbit/fly` | 初始模式(自由飞行) |
| `?view=0..9` | 调试视图 |
| `?quality=low/standard/high/cinematic` | 画质档(移动端无存档时默认 low) |
| `?p=key=val,key2=val2`(或直接 `?diskInner=5`) | 覆盖任意参数(含 spin/jetPower,越界自动夹回) |
| `?seed=N` / `?t=秒` / `?fps=N` | 星空种子 / 初始时间 / 帧率上限 |
| `?le=0/1` / `?lef=N` | 长曝光开关 / 曝光帧数 |
| `?exp=screen/4k/8k` | 截图导出分辨率 |
| `?fov=25..110` | 初始视场角 |
| `?vol=1` / `?anno=1` / `?eht=1` / `?film=0/1` / `?refcolor=0/1` | 体积盘 / 标注 / EHT / 电影色调 / 参考配色 |
| `?flyb=2.01..3.0` | 自由飞行安全边界(米制 M;越小时间膨胀越强) |
| `?tour=1` | 自动开始导览 |
| `?guide=1/0` | 强制弹出 / 禁止功能引导(默认:首访自动) |
| `?s=分享码` | 载入分享的场景(参数+相机+画质+种子+**全部开关状态**) |
| `?cine=0/1` `?music=0/1` `?hud=0/1` `?panel=0/1` | 模式开关 |
| `?freeze=1` | 冻结动画时间(确定性截图) |
| `?still=1` | 渲染 36 帧后停止 rAF(供 API 截图) |
| `?snap=名字.png&frames=N` | 就绪后显式渲染 N 帧并自动保存 PNG |
| `?safemode=1` / `?reset=1` | 安全模式 / 忽略本地存档 |

示例:`http://127.0.0.1:5300/?reset=1&freeze=1&still=1&seed=5&preset=1&spin=0.9&jetPower=1.5`
→ 确定性的 Kerr 喷流场景;`?tour=1` → 7 站中文导览。

**JS API**(`window.gargantua` v2.3.0):

```js
gargantua.ready / info()
gargantua.setParam(k,v) / setParams(obj) / getParams()
gargantua.setView(0..9) / setQuality(q) / setPreset(0..3) / setCine(b) / setSeed(n)
gargantua.setFpsCap(0|30|60|90|120|144|165) / setExportSize('screen'|'4k'|'8k')
gargantua.setLongExposure(b) / setExposureFrames(2..64)
gargantua.setVolDisk(b) / setAnnotations(b) / setEHT(b) / setFilmGrade(b) / setRefColor(b) / setWatermark(b)
gargantua.setTour(b) / setPhoto(b) / setGeoArm(b) / launchPhoton(ndcX, ndcY)
gargantua.startGuide()             // 打开功能引导(首访自动;面板「引导」可重开)
gargantua.share()                    // 生成分享链接
gargantua.applyShareCode('...')      // 导入分享码
gargantua.renderFrames(n) / renderOne() / benchmark(n)
gargantua.screenshot(name) / exportImage(name,'4k'|'8k') / screenshotDataUrl()
window.__LAST_EXPORT__ / window.__GARGANTUA_ERRORS__
```

## 性能(实测:RTX 4070 Laptop,readPixels 强同步,GPU 热身后)

**2K 2560×1440 · 电影档 320 步,每帧 GPU 耗时**:

| 场景 | ms/帧 | 对 120fps(8.33ms) |
| --- | --- | --- |
| 默认(Schwarzschild)远景全景(最重) | **4.49** | 1.86× 余量(≈223fps) |
| 默认近界掠行 | 4.29 | 达标 |
| Kerr a=0.9 | 8.79 | 达标(≈114fps) |
| 体积盘(九轮薄层门控前) | 9.75 | 略超,建议高/标准档 |
| 体积盘(十轮步长自适应后) | 体积额外开销约为早版本 1/3(A/B 同环境远景 −37%/极区 −40%) | 接近达标;更多帧率可用「高」档(192 步) |
| EHT / 长曝光16+TAA | 4.52 / 4.70 | 达标 |
| Kerr+喷流 | 9.47 | 略超,建议高/标准档 |

**720p 重场景 1.4–3.3ms**(1K 60fps 底线的 5 倍余量)。物理无损优化:远场大步长 ×4、
弯曲常数提出循环、盘噪声降八度、黑体 LUT、Bloom 低分辨率金字塔、8K 导出内存原地翻转减半。
另有隐藏标签页 setTimeout 降级、帧率限制令牌桶(跳过帧不推进时间)。
**移动端**:低画质档(DPR 1.0 / 96 步 / 3 级 Bloom / 体积盘 2 子采样)+ 自适应动态分辨率
 servo 60fps;旗舰机(Adreno 750)实测由 21fps(标准档)回到满帧 60(十一轮)。

## 目录结构

```
gargantua-echo/
├── index.html            # 入口 + importmap + HUD/面板/摄影/导览/成就/标注 DOM
├── style.css
├── serve.py              # 静态服务器(python serve.py [port])
├── vendor/three/         # three r170 module + OrbitControls(本地,无 CDN)
├── src/
│   ├── main.js           # 启动编排 / 主循环 / 模式切换 / 自动化 API / 错误恢复
│   ├── engine.js         # 渲染引擎:RT×2(Kerr)+ Bloom 金字塔 + 合成 + 导出 + ISCO/视界公式
│   ├── state.js          # 24 参数定义、URL 解析、localStorage 持久化
│   ├── ui.js             # HUD、参数面板、快捷键、Toast、覆盖层、摄影/导览/成就 UI
│   ├── cinematic.js      # 四预设 + 96s 电影镜头循环
│   ├── flight.js         # 自由飞行模式(WASD 第一人称,pointer lock + 拖拽回退)
│   ├── geodesic.js       # 光子弹弓:CPU 端 Kerr-Schild 积分 + 轨迹叠加
│   ├── annotations.js    # 物理标注:理论位置投影(SVG)
│   ├── achievements.js   # 成就系统(13 项,localStorage)
│   ├── tour.js           # 7 站中文导览(相机飞行 + 字幕)
│   ├── photomode.js      # 胶片风格预设 / 构图线 / 水印文本
│   ├── sharecode.js      # 参数分享码(base64url)
│   ├── disktex.js        # 吸积盘有机细节纹理(本地程序化烘焙,可平铺)
│   ├── audio.js          # WebAudio 氛围音乐(淡入淡出)
│   ├── capture.js        # 截图自动化(隐藏标签页安全)
│   └── shaders/
│       ├── raytracer.js  # Schwarzschild Verlet + Kerr-Schild 哈密顿双路径 Fragment Shader
│       └── post.js       # Bloom + ACES 合成(+ EHT 模式)
├── assets/
│   └── audio/ambient-drone.wav     # 生成的氛围音乐(32s 无缝循环)
└── TESTREPORT.md         # 测试结果与证据
```

## 错误恢复

- WebGL 2 不可用 / 创建失败 → 覆盖层提示 + 「安全模式」「重试」按钮(内联脚本接线,模块加载失败时依然可点)
- 着色器编译失败(`renderer.debug.onShaderError`)→ 覆盖层 + 安全模式入口(`?safemode=1` 重载)
- `webglcontextlost/restored` → 等待并自动重建资源(已用 `WEBGL_lose_context` 实测)
- 隐藏标签页 rAF 挂起 → 自动化场景(`?snap=` / webdriver)降级 `setTimeout` 驱动;普通用户切后台循环完全停止
- 飞行模式 pointer lock 被拒 → 自动回退拖拽环视
