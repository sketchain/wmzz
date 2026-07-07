# 总体架构与技术选型

> 阶段 1 交付物。本文档定义整个项目的技术地基；后续所有阶段的代码必须与本文档保持一致，若有偏离需先修订本文档。

## 1. 目标与约束

- 浏览器内运行的《Cities: Skylines》风格 3D 城市模拟。
- 性能目标：**100k+ 建筑、500k+ 居民、100k+ 车辆，60 FPS**。
- 技术约束：TypeScript、Three.js（WebGPU 优先）、Vite、ECS、Web Worker、IndexedDB、OffscreenCanvas、WASM（仅热点），全部手写。

这些数字决定了架构的每个选择：**任何"每实体一个 JS 对象/闭包/Three.js Object3D"的方案都直接出局**，必须走数据导向（data-oriented）路线。

## 2. 技术选型及理由

| 领域 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript (strict) | 10 万行级代码库没有静态类型无法维护；strict + noImplicitOverride 挡住整类回归错误 |
| 构建 | Vite 6 | 原生 ESM 秒级冷启动；`worker.format: 'es'` 让 Worker 与主线程共享模块图；内置 WASM/资源管线 |
| 渲染 | Three.js WebGPURenderer，WebGL2 回退 | WebGPU 提供 compute pass（后续用于剔除/粒子/风场）与更低的 draw 开销；Three 的 TSL 材质在两种后端间可移植。运行时探测 `navigator.gpu`，失败则同一份场景图走 WebGL2 |
| 实体模型 | 自研 sparse-set ECS（SoA 存储） | 详见 §3。第三方 ECS（bitecs 等）不满足"全部手写"约束，且我们需要与 Worker 共享 TypedArray 的定制权 |
| 并行 | Web Worker + SharedArrayBuffer | 模拟（经济/寻路/市民日程）移出主线程，主线程只做输入+渲染。Vite dev server 已配置 COOP/COEP 头以启用 SAB |
| 存档 | IndexedDB | 结构化克隆直接吞 TypedArray，配版本号 + 迁移函数实现向后兼容 |
| 热点 | WebAssembly | 只用于剖析证实的热点（候选：Flow Field 生成、大规模 A\*、地形侵蚀）。先写 TS 基线，后换 WASM，接口不变 |

### 为什么是固定时间步长 30 Hz 模拟 + 可变帧率渲染

- 城市模拟必须**确定性**：同一存档 + 同一操作序列 ⇒ 同一结果，否则经济数值漂移、回归测试不可能。固定 dt 是确定性的前提。
- 30 Hz 对模拟足够（CS1 是 ~4 Hz 的日程模拟 + 60 Hz 移动插值），渲染在 Update 阶段用 `alpha` 在两个 tick 间插值，视觉仍是满帧。
- 累加器带 `maxCatchUpTicks` 上限，掉帧时丢弃时间而不是螺旋死亡。

## 3. ECS 设计（已实现，src/core/ecs/）

### 3.1 实体

实体是一个 u32：`[generation:8][index:24]`。

- 24 位索引 = 1670 万并发实体，覆盖 50 万居民 + 10 万车辆 + 10 万建筑 + 大余量。
- 8 位 generation 使被回收索引上的旧句柄失效（`isAlive` 校验），避免悬挂引用——在"车辆持有目的地建筑句柄、建筑可能被拆除"的游戏里这是刚需。
- 整个 id 塞进一个 SMI/TypedArray 槽位：实体引用可以放进 `Uint32Array`，可以零拷贝发给 Worker。

### 3.2 组件三态

| 类别 | 存储 | 用途 |
| --- | --- | --- |
| `soa` | 每字段一个 TypedArray（Structure of Arrays）+ sparse-set 索引 | 热数据：位置、速度、电力/水/污染数值。线性内存 → 缓存友好；TypedArray → 可 `postMessage` 转移、可放 SharedArrayBuffer、可直接喂 GPU instancing buffer |
| `tag` | **零存储**，只占签名位 | 标记：Selected、OnFire、Abandoned、PowerShortage… |
| `object` | 稠密 JS 对象数组 + sparse-set 索引 | 冷数据：路径数组、名字、配置引用 |

组件在模块加载期通过 `defineComponent/defineTag/defineObjectComponent` 注册，获得稳定数值 id（= 签名位）。上限 256 类型（8 个 u32 签名字），每实体签名开销 32 字节，100 万实体约 32 MB——可接受；如需更多类型只改一个常量。

### 3.3 存储：sparse-set 而非 archetype

选择 sparse-set（EnTT 风格）而非 archetype（Unity DOTS 风格）：

- 城市模拟的结构变更极其频繁（车辆每次进出路口都可能加减 tag），archetype 方案每次结构变更要整行搬迁所有组件数据；sparse-set 只动一个组件的 swap-remove。
- sparse-set 的每组件稠密数组天然就是渲染 instancing 的源缓冲。
- 代价是多组件联合迭代要经过 sparse 间接寻址——用"迭代查询缓存 + 按 denseIndex 直取字段数组"缓解，剖析显示不够时再为热系统做定制打包。

### 3.4 查询：增量维护

`world.query({all, any, none})` 返回缓存的活查询。每次结构变更只重测**受影响的那一个实体**（O(查询数)），查询自身维护匹配集 sparse-set。迭代永远是 O(匹配数)、零重建——这是 50 万实体规模下查询系统唯一可行的形态。新建查询做一次全量回填扫描，之后终身增量。

### 3.5 调度：阶段流水线

```
每帧: Input → Simulation × N(固定 30Hz, 累加器) → Update → Render → Cleanup
启动: Startup × 1
```

- 系统声明 `stage` + `order`，同阶段内稳定排序。
- **每个系统跑完后冲刷 `world.defer()` 队列**——系统在迭代查询时禁止直接结构变更，统一延迟到系统边界，杜绝迭代失效。
- **每个阶段结束后冲刷事件队列**（`bus.enqueue` 的延迟事件），带反馈环检测。
- `timeScale`/`paused` 只作用于 Simulation 阶段：暂停时相机、UI、渲染完全正常——和 CS 一致的手感。

## 4. 事件、命令、DI（已实现）

- **EventBus**（观察者模式）：类型化事件映射表，特性模块用 declaration merging 扩展 `GameEvents` 接口。`emit` 同步（输入/UI），`enqueue` 延迟到阶段边界（模拟副作用）。
- **CommandStack**（命令模式）：所有玩家操作（修地形、铺路、区划、拆除）都是 `Command`，统一 Undo/Redo；`tryMerge` 把连续笔刷合并为单步撤销。线性历史，容量有界。
- **ServiceContainer**（依赖注入）：类型化 Token，无装饰器无反射（保持打包器友好）。`main.ts` 是唯一组合根；系统之间**禁止**互相 import 单例——一切经容器或事件。这就是挡住 God Object 的机制。
- **数据驱动**：建筑原型、道路截面、经济曲线等全部进 `src/data/` 的声明式定义文件（阶段 4-6 落地），代码只写行为不写数值。

## 5. 线程模型（阶段 6+ 落地，现在定死拓扑）

```
主线程            渲染、输入、UI、命令
  │  SAB / Transferable
Sim Worker        固定 30Hz 城市模拟（经济、需求、公用设施、市民日程）
Path Worker(s)    A* / HPA* / Flow Field 批量寻路服务（请求-应答）
Stream Worker     地形 chunk 生成、mesh 构建、存档 IO (IndexedDB)
```

- 热状态（位置/速度）放 SharedArrayBuffer 上的 SoA 环形缓冲，主线程只读插值渲染。
- 结构变更走消息化命令流，保证模拟侧确定性。
- OffscreenCanvas 保留为可选路径（MiniMap / 图表在 Worker 绘制）。

## 6. 渲染策略（阶段 2 落地）

- 建筑/车辆/树木全部 **GPU instancing**（每类型一个 InstancedMesh，实例缓冲直接来自 ECS 的 SoA TypedArray）。
- 距离分级 LOD + 视锥剔除；WebGPU 路径上用 compute 做遮挡剔除，WebGL 回退为 CPU 粗剔除。
- 纹理图集 + PBR；后处理 Bloom / SSAO / FXAA / HDR。
- **10 万建筑 60 FPS 的关键**不是多边形数而是 draw call 数：目标 < 200 draws/帧，靠 instancing + 图集合批达成。

## 7. 存档管线（阶段 6+ 落地）

- IndexedDB，库名/版本见 `GameConfig.persistence`。
- 序列化 = 按组件存储直接快照 TypedArray（结构化克隆零编解码）+ 对象组件 JSON 化。
- 每个存档带 `saveVersion`，加载时按版本号顺序执行迁移函数链——向后兼容的机制而非口号。
- 自动保存在 Stream Worker 中执行，不卡主线程。

## 8. 代码规约

- `src/core/` 绝不 import 游戏内容；`src/boot/` 是可丢弃的阶段演示层。
- 禁止巨类/God Object：系统只有 `update` + 声明式元数据；跨系统通信只走组件数据或事件。
- 模拟代码禁止 `Math.random()`——统一用带种子的确定性 PRNG（见 `createRng`）。
- 热路径禁止每帧分配：对象池（`ObjectPool`）、预分配 TypedArray、复用临时向量。
