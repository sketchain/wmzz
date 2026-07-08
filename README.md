# WMZZ City

一个运行在浏览器中的《Cities: Skylines》风格 3D 城市建造模拟游戏。

- **技术栈**：TypeScript · Three.js（WebGPU 优先 / WebGL2 自动回退）· Vite · 自研 ECS · Web Worker（寻路）· IndexedDB（存档）
- **架构**：数据驱动 ECS + 事件系统 + 命令模式（Undo/Redo）+ 依赖注入 + 工厂模式 + 观察者模式

## 快速开始

```bash
npm install
npm run dev      # http://localhost:5173
```

其它命令：

```bash
npm run build      # 类型检查 + 生产构建
npm run test       # 56 个单元测试（含模拟确定性回归）
npm run typecheck  # 仅 TypeScript 类型检查
```

## 玩法与操作

| 操作 | 按键 / 方式 |
| --- | --- |
| 相机 | WASD/方向键平移 · Q/E 旋转 · R/F 俯仰 · 滚轮缩放 · 中/右键拖拽 |
| 地形笔刷 | 1 抬升 · 2 降低 · 3 平整 · 4 平滑 · 5 涂刷 · [ ] 调大小 |
| 道路 | 6 街道 · 7 大道 · 8 高速 · 9 环岛 · 0 拆除 · C 曲线 · V 单向 |
| 区划 | Z 循环 住宅→商业→工业→办公 · 按住 Alt 擦除 |
| 服务设施 | B 循环 学校/医院/消防/警察/公园/电厂/水厂/填埋场/机场/港口 |
| 时间 | 空格 暂停 · , . 调速（1×/2×/4×） |
| 存档 | F5 快速保存 · F9 读取（IndexedDB，另有 2 分钟自动存档） |
| 撤销 | Ctrl+Z / Ctrl+Y（地形、道路、区划、设施全部支持） |
| 其它 | Esc 取消工具 · F3 调试面板 |

所有工具同样可通过底部工具栏点击使用；顶部信息栏、预算/图表/检查器窗口（可拖拽）、小地图（点击跳转）、交通/污染/地价/电力/供水/治安数据图层见工具栏。

### 一座城市的最小闭环

修一条街道(6) → 沿路画住宅+商业区划(Z) → 在路旁放电厂和水厂(B) → 建筑自动生长、居民迁入 → 早高峰看车流上路 → 用预算面板调税率、图表面板看人口曲线。

## 开发状态：11 阶段全部完成 ✅

| 阶段 | 内容 | 阶段 | 内容 |
| --- | --- | --- | --- |
| 1 ✅ | ECS 核心/架构地基 | 7 ✅ | A*/流场/Worker 寻路/红绿灯 |
| 2 ✅ | WebGPU 渲染/RTS 相机/输入 | 8 ✅ | 市民日程 AI/跟驰车辆 |
| 3 ✅ | 无限地形/LOD/程序化生成/编辑 | 9 ✅ | HUD/窗口/图层/小地图 |
| 4 ✅ | 道路图/程序化路面/桥隧 | 10 ✅ | 后处理/LOD 优化/性能文档 |
| 5 ✅ | 区划/建筑生长/服务设施 | 11 ✅ | 确定性回归/存档往返测试 |
| 6 ✅ | 电力水务/经济/人口/存档 | | |

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技术选型与总体架构（ECS 设计、线程模型、数据流、存档管线）
- [docs/MODULES.md](docs/MODULES.md) — 模块划分与 System/Component 清单
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — 性能预算与每项优化的动机
- [docs/ROADMAP.md](docs/ROADMAP.md) — 11 阶段路线图与验收标准

## 目录结构

```
src/
├── main.ts           # 组合根：DI 装配 + 系统调度表
├── config/           # 引擎级配置
├── core/             # 游戏无关引擎核心：ecs/ events/ commands/ di/ time/ utils/
├── engine/           # 渲染器(WebGPU/WebGL2+后处理)、相机、输入、拾取
├── terrain/          # 高度场、区块流式加载、LOD、程序化生成、地形编辑
├── roads/            # 道路图、程序化路面网格、放置工具、路基整平
├── buildings/        # 区划格、建筑工厂、生长系统、实例化渲染
├── simulation/       # 日历天气、电水网、环境场、人口、经济、垃圾、消防
├── traffic/          # 图索引(A*/流场)、路径服务、红绿灯、车道几何
├── agents/           # 市民日程状态机、车辆跟驰、代理 LOD
├── ui/               # 信息栏、工具栏、可拖拽窗口、小地图、数据图层
├── persistence/      # IndexedDB 存档、版本迁移、自动保存
├── workers/          # path.worker（寻路线程）
├── data/             # 数据驱动定义（建筑原型、服务设施）
└── boot/             # 调试面板
tests/                # 56 个单元测试（ECS/寻路/地形/路网/确定性/存档）
```
