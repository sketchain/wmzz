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

  scheduler.add(new InputSystem(input));
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
  scheduler.add(new RenderSystem(renderer));

  const overlay = new DebugOverlay(app, 'WMZZ City — 阶段3：地形系统');
  let brushLabel = '无 (按1-5选择)';
  events.on('terrain:brushChanged', ({ mode, radius }) => {
    brushLabel = mode ? `${mode} r=${radius.toFixed(0)}m` : '无 (按1-5选择)';
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
        阶段: '3 / 11 (terrain)',
        后端: renderer.backend,
        区块: `${terrain.loadedChunkCount} (队列 ${terrain.pendingBuilds})`,
        笔刷: brushLabel,
        操作: '1-5笔刷 [ ]大小 ^Z撤销',
      },
    });
  });
  container.registerValue(GameLoopToken, loop);

  scheduler.start();
  loop.start();
  log.info('Phase 3 bootstrap complete — terrain streaming');

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      loop.stop();
      scheduler.dispose();
      overlay.dispose();
      water.dispose();
      container.dispose();
    });
  }
}

void bootstrap();
