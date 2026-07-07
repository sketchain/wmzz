# 模块划分与目录规划

> 阶段 1 交付物。`✅` = 已实现；未标注 = 规划中，随对应阶段落地。目录即模块边界：`src/core` 与游戏无关，特性模块之间只通过 ECS 组件数据与事件通信。

## 1. 顶层目录

```
src/
├── main.ts                    # ✅ 组合根（唯一装配点）
├── config/                    # ✅ 引擎级配置
├── core/                      # ✅ 引擎核心（游戏无关）
├── boot/                      # ✅ 阶段演示 + 调试面板（可丢弃层）
├── engine/                    # 阶段2  渲染/摄像机/输入
├── terrain/                   # 阶段3  地形/Chunk/编辑
├── roads/                     # 阶段4  道路网络与几何
├── buildings/                 # 阶段5  建筑与区划
├── simulation/                # 阶段6  城市模拟
├── traffic/                   # 阶段7  寻路与交通
├── agents/                    # 阶段8  居民/车辆 AI
├── ui/                        # 阶段9  UI 框架与面板
├── persistence/               # 阶段6+ IndexedDB 存档
├── workers/                   # 阶段6+ Worker 入口
├── wasm/                      # 阶段10 WASM 热点模块
└── data/                      # 阶段4+ 数据驱动定义（原型/曲线/配置）
```

## 2. 模块明细

### 2.1 core/ ✅（阶段 1 已实现）

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| ecs | Entity, Component, ComponentStore, Query, System, Scheduler, World | sparse-set SoA ECS 核心 |
| events | EventBus, GameEvents | 类型化观察者模式，同步 + 延迟队列 |
| commands | Command, CommandStack | 命令模式 Undo/Redo |
| di | ServiceContainer | 类型化 Token 依赖注入 |
| time | GameLoop | rAF 驱动 + 帧统计 |
| utils | SparseSet, Bitset, ObjectPool, Logger | 数据结构与基础设施 |

### 2.2 engine/（阶段 2）

`renderer/`（RendererFactory: WebGPU→WebGL2 探测、SceneGraph、MaterialLibrary、TextureAtlas、InstancedPool、Postprocessing: Bloom/SSAO/FXAA/HDR）、`camera/`（RtsCameraRig、CameraController: 平移/缩放/旋转/边缘滚动、CameraBookmarks）、`input/`（InputMap、PointerState、KeyBindings、GestureRecognizer、PickingService: GPU picking）、`assets/`（ResourceManager: 引用计数 + 异步加载 + 工厂模式、GeometryFactory、AudioManager）。

### 2.3 terrain/（阶段 3）

`chunk/`（ChunkManager: 流式加载、ChunkMesher、ChunkLod: geo-clipmap 或 quadtree、HeightField）、`generation/`（NoiseLibrary、BiomeGenerator、RiverCarver、ForestScatter、CoastGenerator）、`editing/`（TerrainBrush: Raise/Lower/Flatten/Smooth/Paint、TerrainEditCommands: 接 CommandStack 的 Undo/Redo、SplatmapPainter）、`water/`（WaterSurface、WaterFlow）。

### 2.4 roads/（阶段 4）

`graph/`（RoadGraph: 节点-边拓扑、Intersection、LaneGraph: 车道级图、RoadSnapper）、`geometry/`（RoadSpline: 直线/圆弧/Bezier、RoadMesher: 截面挤出、IntersectionMesher、BridgeMesher、TunnelMesher、RoundaboutBuilder、MarkingGenerator: 标线、SidewalkGenerator、RoadLodBaker）、`tools/`（RoadPlacementTool、RoadUpgradeTool、BulldozeTool——全部产出 Command）、`props/`（StreetLightPlacer、RoadDecoration）。

### 2.5 buildings/（阶段 5）

`zoning/`（ZoneGrid、ZonePainter、GrowthSystem: RCI 需求驱动生长）、`prototypes/`（BuildingPrototype 数据定义 + BuildingFactory 工厂模式）、`services/`（学校/医院/消防/警察/公园/电厂/水厂/垃圾场/机场/港口的服务半径与覆盖）、`lifecycle/`（建造/升级/废弃/拆除状态机）、`mesh/`（BuildingMesher、BuildingLod、PropScatter）。

### 2.6 simulation/（阶段 6）

`population/`（人口、出生/迁入迁出、教育、健康、幸福度）、`economy/`（税收、维护费、贷款、预算、经济波动）、`utilities/`（PowerGrid: 图连通 + 容量分配 + 停电级联、WaterNetwork: 供水/排污/压力、GarbageSystem）、`environment/`（污染扩散场、噪音场、地价场、犯罪、火灾风险）、`cityStats/`（城市等级、里程碑、统计时间序列）、`clock/`（GameCalendar: 昼夜/月份/季节、WeatherSystem: 雨/雪/风/温度）。

### 2.7 traffic/（阶段 7）

`pathfinding/`（AStar、HierarchicalAStar: 区域分层、FlowField、PathCache、PathRequestQueue: Worker 批处理）、`flow/`（TrafficDensity、CongestionCost: 拥堵回馈边权、DynamicReplanner）、`control/`（TrafficLight、YieldRules、LaneSelector: 变道）、`transit/`（公交线路与站点，后续扩展）。

### 2.8 agents/（阶段 8）

`citizens/`（CitizenScheduler: 起床/上班/购物/娱乐/回家/睡觉日程状态机、NeedsModel、CitizenSpawner）、`vehicles/`（VehicleDriver: 跟驰/避让/红绿灯、ParkingSystem、VehicleSpawner）、`movement/`（PathFollower、Steering、AgentLod: 远处降频模拟）。

### 2.9 ui/（阶段 9）

`framework/`（Window: 可拖拽窗口、Dock、DataBinding: 观察者模式驱动刷新）、`panels/`（ToolBar、BuildingMenu、RoadMenu、BudgetPanel、Inspector、ChartsPanel: 人口曲线等、MiniMap: OffscreenCanvas）、`overlays/`（TrafficHeatmap、PowerOverlay、WaterOverlay、PollutionOverlay、LandValueOverlay）、`hud/`（TimeControls、CityStatsBar、NotificationToast）。

### 2.10 persistence/ · workers/ · wasm/

- `persistence/`：SaveManager、IndexedDbStore、SaveMigrations（版本迁移链）、AutoSave。
- `workers/`：sim.worker.ts、path.worker.ts、stream.worker.ts + WorkerBridge（消息协议、SAB 视图）。
- `wasm/`：flowfield、erosion 等剖析证实的热点，TS 基线先行、接口不变替换。

## 3. System 清单（目标 20+，按阶段）

| # | System | Stage | 阶段 |
| --- | --- | --- | --- |
| 1-3 | MovementSystem / LifetimeSystem / RespawnSystem（演示，后替换） | Simulation | ✅1 |
| 4 | InputSystem | Input | 2 |
| 5 | CameraSystem | Update | 2 |
| 6 | PickingSystem | Input | 2 |
| 7 | RenderSyncSystem（ECS→InstancedMesh） | Render | 2 |
| 8 | ChunkStreamingSystem | Update | 3 |
| 9 | TerrainLodSystem | Update | 3 |
| 10 | TerrainEditSystem | Simulation | 3 |
| 11 | RoadNetworkSystem | Simulation | 4 |
| 12 | RoadMeshingSystem | Update | 4 |
| 13 | ZoneGrowthSystem | Simulation | 5 |
| 14 | BuildingLifecycleSystem | Simulation | 5 |
| 15 | ServiceCoverageSystem | Simulation | 5 |
| 16 | PopulationSystem | Simulation | 6 |
| 17 | EconomySystem | Simulation | 6 |
| 18 | PowerGridSystem | Simulation | 6 |
| 19 | WaterNetworkSystem | Simulation | 6 |
| 20 | GarbageSystem | Simulation | 6 |
| 21 | PollutionSystem | Simulation | 6 |
| 22 | LandValueSystem | Simulation | 6 |
| 23 | CrimeSystem / FireSystem | Simulation | 6 |
| 24 | CalendarSystem / WeatherSystem | Simulation | 6 |
| 25 | PathRequestSystem | Simulation | 7 |
| 26 | TrafficFlowSystem | Simulation | 7 |
| 27 | TrafficLightSystem | Simulation | 7 |
| 28 | CitizenScheduleSystem | Simulation | 8 |
| 29 | VehicleDrivingSystem | Simulation | 8 |
| 30 | PathFollowSystem | Simulation | 8 |
| 31 | AgentLodSystem | Update | 8 |
| 32 | UiBindingSystem | Update | 9 |
| 33 | OverlayRenderSystem | Render | 9 |
| 34 | AutoSaveSystem | Update | 6+ |

## 4. Component 规划（目标 200+）

组件按域注册于各特性模块的 `components.ts`。命名 `域.名称`。代表性清单（每域实际落地时按此粒度展开，粗体为 SoA 热数据）：

- **空间/渲染**：**Transform**、**Velocity**、RenderInstance、LodState、BoundingRadius、Selected(tag)、Hidden(tag)、Highlighted(tag)…
- **地形**：ChunkRef、TerrainDirty(tag)、WaterBody、TreeInstance…
- **道路**：RoadSegment、RoadNode、LaneRef、**TrafficDensity**、Elevated(tag)、Bridge(tag)、Tunnel(tag)、Roundabout(tag)、OneWay(tag)…
- **建筑**：BuildingPrototypeRef、**BuildingLevel**、**LandValue**、**NoiseLevel**、**Pollution**、**PowerDemand**、**PowerSupplied**、**WaterDemand**、**WaterSupplied**、**WorkerSlots**、**ResidentSlots**、**TaxOutput**、**MaintenanceCost**、Zoned(R/C/I/Office)、UnderConstruction(tag)、Abandoned(tag)、OnFire(tag)、PowerShortage(tag)、WaterShortage(tag)…
- **市民**：**CitizenState**、**Age**、**Education**、**Health**、**Happiness**、HomeRef、WorkRef、SchoolRef、DailySchedule(object)、**Needs**（多字段）…
- **车辆**：**VehicleKinematics**、**LaneFollow**、Path(object)、ParkingRef、WaitingAtLight(tag)、Replanning(tag)…
- **公用**：GridNode、**GridLoad**、ServiceRadius、CoverageMap(object)…
- **经济/统计**：**BudgetLine**、LoanState、StatSeries(object)…

> 上限 `MAX_COMPONENT_TYPES = 256`（8 签名字），到 200+ 时余量充足；超限只需改常量（成本 = 每实体签名 +4 字节/32 类型）。
