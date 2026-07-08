import { Scheduler, World } from '@/core/ecs';
import { GameLoop } from '@/core/time/GameLoop';
import { ServiceContainer, createToken } from '@/core/di/ServiceContainer';
import { CommandStack } from '@/core/commands/CommandStack';
import { createGameEventBus, EventBusToken } from '@/core/events/GameEvents';
import { createLogger } from '@/core/utils/Logger';
import { GameConfig } from '@/config/GameConfig';
import { RendererService, RendererToken } from '@/engine/renderer/RendererService';
import { InputService, InputToken } from '@/engine/input/InputService';
import { CameraRig, CameraRigToken } from '@/engine/camera/CameraRig';
import { PickingService, PickingToken } from '@/engine/picking/PickingService';
import { InputSystem } from '@/engine/systems/InputSystem';
import { CameraControlSystem } from '@/engine/systems/CameraControlSystem';
import { RenderSystem } from '@/engine/systems/RenderSystem';
import { TerrainService, TerrainToken } from '@/terrain/TerrainService';
import { WaterSurface } from '@/terrain/WaterSurface';
import { TerrainEditor, TerrainEditorToken } from '@/terrain/editing/TerrainEditor';
import { ChunkStreamingSystem } from '@/terrain/systems/ChunkStreamingSystem';
import { TerrainEditSystem } from '@/terrain/systems/TerrainEditSystem';
import { RoadNetwork, RoadNetworkToken } from '@/roads/RoadNetwork';
import { RoadRenderer, RoadRendererToken } from '@/roads/RoadRenderer';
import { RoadSyncSystem, RoadToolSystem } from '@/roads/systems/RoadToolSystem';
import { ZoneGrid, ZoneGridToken } from '@/buildings/ZoneGrid';
import { ZoneOverlay } from '@/buildings/ZoneOverlay';
import { BuildingFactory, BuildingFactoryToken } from '@/buildings/BuildingFactory';
import { ZoneToolSystem } from '@/buildings/systems/ZoneToolSystem';
import { GrowthSystem } from '@/buildings/systems/GrowthSystem';
import { BuildingRenderSystem } from '@/buildings/systems/BuildingRenderSystem';
import { ZONE_LABELS, SERVICES } from '@/data/buildingPrototypes';
import {
  Building,
  BuildingEcon as BuildingEconDebug,
  BuildingMeta as BuildingMetaDebug,
  PowerShortage as PowerShortageDebug,
  WaterShortage as WaterShortageDebug,
} from '@/buildings/components';
import { Transform } from '@/engine/components';
import { CityStats, CityStatsToken } from '@/simulation/CityStats';
import { EnvironmentFields, EnvironmentToken } from '@/simulation/EnvironmentFields';
import {
  CalendarSystem,
  CalendarToken,
  GameCalendar,
} from '@/simulation/systems/CalendarSystem';
import {
  POWER_CONFIG,
  UtilityGridSystem,
  WATER_CONFIG,
} from '@/simulation/systems/UtilityGridSystem';
import { EnvironmentSystem } from '@/simulation/systems/EnvironmentSystem';
import { PopulationSystem } from '@/simulation/systems/PopulationSystem';
import { EconomySystem } from '@/simulation/systems/EconomySystem';
import { SanitationSystem } from '@/simulation/systems/SanitationSystem';
import { FireSystem } from '@/simulation/systems/FireSystem';
import { TimeControlSystem } from '@/engine/systems/TimeControlSystem';
import { SaveManager, SaveManagerToken } from '@/persistence/SaveManager';
import {
  AutoSaveSystem,
  SaveHotkeySystem,
} from '@/persistence/systems/PersistenceSystems';
import { DebugOverlay } from '@/boot/DebugOverlay';

const log = createLogger('main');

export const WorldToken = createToken<World>('core.world');
export const SchedulerToken = createToken<Scheduler>('core.scheduler');
export const CommandStackToken = createToken<CommandStack>('core.commandStack');
export const GameLoopToken = createToken<GameLoop>('core.gameLoop');

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('missing #app container');

  const container = new ServiceContainer();
  container.registerFactory(EventBusToken, () => createGameEventBus());
  container.registerFactory(
    WorldToken,
    () => new World(GameConfig.world.initialEntityCapacity),
  );
  container.registerFactory(
    SchedulerToken,
    (c) =>
      new Scheduler(c.resolve(WorldToken), c.resolve(EventBusToken), {
        fixedDelta: 1 / GameConfig.simulation.tickRate,
        maxCatchUpTicks: GameConfig.simulation.maxCatchUpTicks,
      }),
  );
  container.registerFactory(
    CommandStackToken,
    (c) => new CommandStack(GameConfig.commands.undoHistoryLimit, c.resolve(EventBusToken)),
  );
  container.registerFactory(RendererToken, () => new RendererService(app));
  container.registerFactory(InputToken, (c) => new InputService(c.resolve(RendererToken).canvas));
  container.registerFactory(CameraRigToken, () => new CameraRig());
  container.registerFactory(PickingToken, (c) => new PickingService(c.resolve(RendererToken)));
  container.registerFactory(TerrainToken, (c) => new TerrainService(c.resolve(RendererToken)));
  container.registerFactory(
    TerrainEditorToken,
    (c) => new TerrainEditor(c.resolve(TerrainToken)),
  );
  container.registerFactory(
    RoadNetworkToken,
    (c) => new RoadNetwork(c.resolve(TerrainToken).field),
  );
  container.registerFactory(
    RoadRendererToken,
    (c) =>
      new RoadRenderer(
        c.resolve(RendererToken),
        c.resolve(RoadNetworkToken),
        c.resolve(TerrainToken).field,
      ),
  );

  const world = container.resolve(WorldToken);
  const scheduler = container.resolve(SchedulerToken);
  const renderer = container.resolve(RendererToken);
  await renderer.init();

  const input = container.resolve(InputToken);
  const rig = container.resolve(CameraRigToken);
  const picking = container.resolve(PickingToken);
  const terrain = container.resolve(TerrainToken);
  const commands = container.resolve(CommandStackToken);
  const events = container.resolve(EventBusToken);
  const water = new WaterSurface(renderer);

  // Terrain-aware camera + picking.
  rig.heightAt = (x, z) => terrain.heightAt(x, z);
  picking.groundRaycast = (ray, out) => terrain.field.raycast(ray, out);

  const roads = container.resolve(RoadNetworkToken);
  roads.onTerrainChanged = (minX, minZ, maxX, maxZ) =>
    terrain.invalidateRegion(minX, minZ, maxX, maxZ);
  const roadRenderer = container.resolve(RoadRendererToken);
  const roadTool = new RoadToolSystem(roads, input, picking, commands, renderer, events);
  roadTool.terrainHeight = (x, z) => terrain.heightAt(x, z);

  container.registerFactory(ZoneGridToken, (c) => new ZoneGrid(c.resolve(RoadNetworkToken)));
  container.registerFactory(
    BuildingFactoryToken,
    (c) =>
      new BuildingFactory(
        c.resolve(WorldToken),
        c.resolve(ZoneGridToken),
        c.resolve(TerrainToken),
        c.resolve(RoadNetworkToken),
      ),
  );
  const zoneGrid = container.resolve(ZoneGridToken);
  const buildingFactory = container.resolve(BuildingFactoryToken);
  const zoneOverlay = new ZoneOverlay(renderer, zoneGrid, terrain);

  // ── Simulation services ──
  container.registerFactory(CityStatsToken, () => new CityStats());
  container.registerFactory(EnvironmentToken, () => new EnvironmentFields());
  container.registerFactory(CalendarToken, () => new GameCalendar());
  const stats = container.resolve(CityStatsToken);
  const environment = container.resolve(EnvironmentToken);
  const calendar = container.resolve(CalendarToken);
  container.registerFactory(
    SaveManagerToken,
    (c) =>
      new SaveManager(
        c.resolve(WorldToken),
        c.resolve(TerrainToken),
        c.resolve(RoadNetworkToken),
        c.resolve(ZoneGridToken),
        c.resolve(BuildingFactoryToken),
        c.resolve(CityStatsToken),
        c.resolve(CalendarToken),
        c.resolve(CameraRigToken),
        c.resolve(EventBusToken),
      ),
  );
  const saves = container.resolve(SaveManagerToken);

  scheduler.add(new InputSystem(input));
  scheduler.add(new TimeControlSystem(scheduler, input));
  scheduler.add(new SaveHotkeySystem(saves, input));
  scheduler.add(roadTool);
  scheduler.add(
    new ZoneToolSystem(zoneGrid, zoneOverlay, buildingFactory, input, picking, commands, events),
  );
  const economy = new EconomySystem(stats, roads, calendar, events);
  const growth = new GrowthSystem(zoneGrid, buildingFactory);
  growth.demandProvider = economy;
  scheduler.add(new CalendarSystem(calendar, renderer, events));
  scheduler.add(new UtilityGridSystem(POWER_CONFIG, roads, stats));
  scheduler.add(new UtilityGridSystem(WATER_CONFIG, roads, stats));
  scheduler.add(new EnvironmentSystem(environment, roads, stats));
  scheduler.add(new PopulationSystem(stats, environment));
  scheduler.add(new SanitationSystem(stats));
  scheduler.add(new FireSystem(environment, buildingFactory, events));
  scheduler.add(economy);
  scheduler.add(growth);
  scheduler.add(new AutoSaveSystem(saves));
  scheduler.add(new BuildingRenderSystem(renderer, buildingFactory));
  scheduler.add(
    new TerrainEditSystem(
      container.resolve(TerrainEditorToken),
      input,
      picking,
      commands,
      events,
    ),
  );
  scheduler.add(new CameraControlSystem(rig, input, renderer));
  scheduler.add(new ChunkStreamingSystem(terrain, water, rig));
  scheduler.add(
    new RoadSyncSystem(() => {
      roadRenderer.sync();
      zoneOverlay.update();
    }),
  );
  scheduler.add(new RenderSystem(renderer));

  const overlay = new DebugOverlay(app, 'WMZZ City — 阶段6：城市模拟');
  let brushLabel = '无 (按1-5选择)';
  events.on('terrain:brushChanged', ({ mode, radius }) => {
    brushLabel = mode ? `${mode} r=${radius.toFixed(0)}m` : '无 (按1-5选择)';
  });
  let roadLabel = '无 (按6-0选择)';
  events.on('road:toolChanged', ({ mode, curved, oneWay }) => {
    roadLabel = mode
      ? `${mode}${curved ? ' 曲线' : ''}${oneWay ? ' 单向' : ''}`
      : '无 (按6-0选择)';
  });
  let zoneLabel = '无 (按Z/B选择)';
  events.on('zone:toolChanged', ({ zone }) => {
    if (zone !== null) zoneLabel = `区划: ${ZONE_LABELS[zone]}`;
    else zoneLabel = '无 (按Z/B选择)';
  });
  events.on('service:toolChanged', ({ kind }) => {
    if (kind !== null) zoneLabel = `设施: ${SERVICES[kind].label}`;
  });

  const loop = new GameLoop((dt) => {
    scheduler.frameUpdate(dt);
    overlay.update({
      fps: loop.fps,
      frameMs: loop.frameMs,
      entities: world.entityCount,
      tick: scheduler.tick,
      frame: scheduler.frame,
      systems: scheduler.profile,
      extra: {
        阶段: '6 / 11 (simulation)',
        时间: `${calendar.dateLabel} ${calendar.clockLabel} ${calendar.weather} ${calendar.temperature.toFixed(0)}°C`,
        人口: `${stats.population} (失业 ${(stats.unemployment * 100).toFixed(0)}%)`,
        财政: `$${Math.round(stats.treasury).toLocaleString()} (${stats.monthlyIncome >= stats.monthlyExpenses ? '+' : ''}${Math.round(stats.monthlyIncome - stats.monthlyExpenses)}/月)`,
        幸福: `${(stats.happiness * 100).toFixed(0)}% 电${(stats.poweredRatio * 100).toFixed(0)}% 水${(stats.wateredRatio * 100).toFixed(0)}%`,
        需求RCI: `${(stats.demandResidential * 100).toFixed(0)}/${(stats.demandCommercial * 100).toFixed(0)}/${(stats.demandIndustrial * 100).toFixed(0)}/${(stats.demandOffice * 100).toFixed(0)}`,
        道路: `${roads.edges.size}边`,
        建筑: `${world.query({ all: [Building] }).size} (${zoneGrid.cells.size}格区划)`,
        笔刷: brushLabel,
        道路工具: roadLabel,
        区划工具: zoneLabel,
        操作: 'Z区划 B设施 6-0路 空格暂停 F5存 F9读',
      },
    });
  });
  container.registerValue(GameLoopToken, loop);

  // Test/debug hook (read-only introspection; not part of the public API).
  (window as unknown as Record<string, unknown>).__wmzz = {
    world,
    scheduler,
    renderer,
    roads,
    zoneGrid,
    buildingFactory,
    terrain,
    stats,
    calendar,
    saves,
    environment,
    debugConditions: () => {
      const query = world.query({ all: [Building] });
      const rows: Record<string, unknown>[] = [];
      query.forEach((entity) => {
        const b = world.read(entity, Building)!;
        const econ = world.read(entity, BuildingEconDebug);
        if (!econ) return;
        const tf = world.read(entity, Transform)!;
        rows.push({
          zone: b.zone,
          uc: b.buildTicks > 0,
          cond: Math.round(econ.condition * 100) / 100,
          lv: Math.round(econ.landValue * 100) / 100,
          occ: econ.occupants,
          noPower: world.hasComponent(entity, PowerShortageDebug),
          noWater: world.hasComponent(entity, WaterShortageDebug),
          x: Math.round(tf.x),
          z: Math.round(tf.z),
          pollution: Math.round(environment.pollutionAt(tf.x, tf.z) * 100) / 100,
          noise: Math.round(environment.noiseAt(tf.x, tf.z) * 100) / 100,
          crime: Math.round(environment.crimeAt(tf.x, tf.z) * 100) / 100,
          lvField: Math.round(environment.landValueAt(tf.x, tf.z) * 100) / 100,
        });
      });
      return rows;
    },
    debugServices: () => {
      const query = world.query({ all: [Building] });
      const out: Record<string, unknown>[] = [];
      query.forEach((entity) => {
        const b = world.read(entity, Building)!;
        if (b.zone !== 0) return;
        out.push({
          name: world.getObject(entity, BuildingMetaDebug)?.name,
          edgeId: b.edgeId,
          buildTicks: b.buildTicks,
        });
      });
      return out;
    },
  };

  scheduler.start();
  loop.start();
  log.info('Phase 6 bootstrap complete — city simulation running');

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      loop.stop();
      scheduler.dispose();
      overlay.dispose();
      water.dispose();
      zoneOverlay.dispose();
      container.dispose();
    });
  }
}

void bootstrap();
