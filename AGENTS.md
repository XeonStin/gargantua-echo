# GARGANTUA gargantua-echo — 工作约定（AGENTS.md）

本目录是一个全屏 Fragment Shader 黑洞光线追踪站（原生 HTML/CSS/JS + ES Modules + 本地 three r170，零构建）。

## 开工必读

1. **先读 `HANDOFF.md`** —— 会话交接文档：文件架构、物理/渲染核心、历轮变更、踩坑清单、测试方法、性能基线、待办。
2. 用户使用说明与 API 见 `README.md`；历轮测试证据见 `TESTREPORT.md`。

## 启动

```bash
cd gargantua-echo && python serve.py 5300
# http://127.0.0.1:5300/
```

## 硬约束（改代码前确认）

- **物理零损失**：禁止用黑球/平面圆环/贴图/截图伪造主体；测地线积分必须真实（Schwarzschild Verlet 或 Kerr-Schild 哈密顿）。
- **确定性**：`?freeze=1&still=1&seed=5` 下两次 `screenshotDataUrl()` 必须逐字节一致（烘焙纹理固定种子、冻结时 jitter=0）。
- **零控制台错误**：`window.__GARGANTUA_ERRORS__` 必须为空。
- **性能预算**：2K（2560×1440）电影档默认路径 ≤8.33ms（120fps）；1K 60fps 是底线；新增效果默认不得拖垮默认路径。
- **GLSL ES 1.0**：没有 `saturate()`（用 `clamp`）；`texture2D` 在分歧分支慎用隐式 LOD。
- **Kerr 路径**：湍流/喷流相位必须用 `uTime`（动画时钟），不得用逐光线积分时间；差速剪切基准必须取盘外缘（保证 `diff ≥ 0` 同向旋转）。
- **体积盘**：段内 4 子采样（低档 2，由 `uVolSub` 控制，亮度按 ev 补偿自守恒）+ 盘区步长 ×0.40（十轮由 0.28 放宽）+ **薄层门控**（仅接近盘面
  贡献截止 8.7×dHH(r)+1.0 的段加密；壳层段——不穿越中面且整体高于贡献截止——整段跳过，
  阈值必须分段保守：加密段 10×dHH(r)、粗段 10×hMax，防 dHH 梯度漏采）；辉光在体积模式 ×0.35。
- **子采样权重补偿必须用乘法形式并进 `ev` 本身**（`segLen*(0.25-0.125*step(...))`），不得在
  `col +=` 处追加 `* evMul` 因子——ANGLE/D3D 的 FMA 收缩随表达式形状改变，会破坏默认档逐位
  输出（十一轮实测：evMul 形式哈希改变，乘法形式与旧代码精确一致 a75252fd）。
- **体积盘中面穿越保护**（十七轮）：预计本步穿过盘面且交点半径 **r > 1.6·r_in** 时，dt 必须缩到
  0.85·t_cross；否则远场大步会跳过薄层，产生低画质前方缺块与粒子-纹理条带。
  **内圈（r < 1.6·r_in）不做额外保护**，保留旧版软边，避免近侧内缘白带变硬、像“嵌进”阴影。
- **盘面细节纹理**：必须按当前样本的真实交点逐样本采样（LinearFilter 可用）。
  **不要改成每像素预采样/固定锚点**——远侧透镜像与内缘会扭曲成放射状怪纹。
  接缝修复用整数倍 `v=2.0` + 圆周坐标 warp，**warp 圆周半径 1.45**（2π·1.45≈9，
  匹配旧版 θ 路径长度 0..9）；用 *9 会让角向 warp 频率高 6 倍，盘面放射状扭曲。
- **TAA**：相机位姿变化必须 `invalidateAccum()` 丢历史（不重投影，保留会拖影）；参数/开关
  变化也要丢；冻结模式权重 1 覆盖。`adapt` 调分辨率用 `resize(false)`，避免该帧二次渲染。
- 双路径共享 `COMMON`（raytracer.js）；材质按 `uSpin > 0.001` 切换；uniforms 对象共享。
- 导出期间 `exporting` 必须冻结主循环/参数/模式切换；LE 累积 pass 必须 noClear。
- UI 开关的 DOM id 与状态键必须走 `ui.js` 的 `TOGGLE_IDS` 显式映射（勿用驼峰键自动拼接）。

## 验收流程（每次改动）

1. IAB 浏览器打开 `?reset=1&still=1`，用**同步 API**（`renderOne/screenshotDataUrl`）验证——IAB 中 rAF 被挂起，主循环不跑。
2. `playwright.evaluate` 有 ~3s 上限：长任务页内启动 + 轮询，或纯同步紧循环。
3. 性能基准：`readPixels(1×1)` 强同步 + **先热身 30 帧以上**（空闲降频会让首测虚高）；用 view9（纯星空）vs view0（含盘）拆分成本。
4. 回归清单：Kerr 自旋阴影（282px/ISCO 2.32）、确定性截图、长曝光、4K 导出、分享码、零错误。
5. 更新 README/TESTREPORT；交接信息写回 HANDOFF.md。

## 测试环境注意事项

- 在 `?reset=1` 页面调用 persist 触发型 API（setParam/setQuality）会污染存档；端到端验证用「setParam → 等 1.5s → goto 干净 URL」。
- `browser.tabs.list()` 可能为空 → `tabs.new()` 重建；连续 goto 偶发落旧文档 → 断言前核对 `location.search`。
- 基准数字先区分"环境漂移 vs 代码回归"：整机可能均匀变慢（GPU 满载但时钟正常），用相对量（view0−view9、新旧代码 A/B）判断。
