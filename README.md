# WMZZ City

一个运行在浏览器中的《Cities: Skylines》风格 3D 城市建造模拟游戏。

- **技术栈**：TypeScript · Three.js（WebGPU 优先 / WebGL2 兼容）· Vite · ECS · Web Worker · IndexedDB · OffscreenCanvas · WebAssembly（性能热点）
- **架构**：数据驱动 ECS + 事件系统 + 命令模式（Undo/Redo）+ 依赖注入 + 工厂模式 + 观察者模式

## 快速开始

```bash
npm install
npm run dev      # http://localhost:5173
```

其它命令：

```bash
npm run build      # 类型检查 + 生产构建
npm run test       # 运行单元测试 (vitest)
npm run typecheck  # 仅 TypeScript 类型检查
```

## 当前进度

按商业开发流程分 11 个阶段推进，详见 [docs/ROADMAP.md](docs/ROADMAP.md)。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 项目结构 / ECS 核心 / 技术选型 | ✅ 完成 |
| 2 | 基础引擎（渲染 / 摄像机 / 输入） | ⏳ 待开始 |
| 3 | 地图系统（Chunk / LOD / 地形） | ⏳ |
| 4 | 道路系统 | ⏳ |
| 5 | 建筑系统 | ⏳ |
| 6 | 城市模拟 | ⏳ |
| 7 | 交通系统 | ⏳ |
| 8 | AI 居民 | ⏳ |
| 9 | UI | ⏳ |
| 10 | 优化 | ⏳ |
| 11 | 测试 | ⏳ |

阶段 1 启动 `npm run dev` 后展示 ECS 核心压力测试：20 万实体以 30Hz 固定时间步长持续模拟（移动、寿命、销毁重生循环），左上角调试面板实时显示 FPS、实体数与各 System 耗时。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技术选型与总体架构（ECS 设计、线程模型、数据流、存档管线）
- [docs/MODULES.md](docs/MODULES.md) — 模块划分、目录规划、System / Component 清单
- [docs/ROADMAP.md](docs/ROADMAP.md) — 11 阶段开发路线图

## 目录结构（阶段 1 实际 + 后续规划）

```
src/
├── main.ts              # 组合根：DI 容器装配 + 启动
├── config/              # 引擎级配置常量
├── core/                # 与游戏内容无关的引擎核心
│   ├── ecs/             # Entity / Component / Query / System / Scheduler / World
│   ├── events/          # 类型化事件总线（同步 + 延迟队列）
│   ├── commands/        # 命令模式 Undo/Redo
│   ├── di/              # 依赖注入容器
│   ├── time/            # 游戏主循环
│   └── utils/           # SparseSet / Bitset / ObjectPool / Logger
├── boot/                # 阶段性演示与调试面板（会被后续阶段替换）
└── …                    # engine/ terrain/ roads/ buildings/ simulation/
                         # traffic/ agents/ ui/ workers/ persistence/（见 MODULES.md）
```
