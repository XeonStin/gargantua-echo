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
- **体积盘**：段内 4 子采样 + 盘区步长 ×0.28；辉光在体积模式 ×0.35。
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
