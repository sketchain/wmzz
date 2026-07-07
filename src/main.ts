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
import { DebugOverlay } from '@/boot/DebugOverlay';
import { ParticleRenderSystem } from '@/boot/ParticleRenderSystem';
import {
  LifetimeSystem,
  MovementSystem,
  RespawnSystem,
  spawnParticles,
} from '@/boot/Phase1Demo';

const log = createLogger('main');

export const WorldToken = createToken<World>('core.world');
export const SchedulerToken = createToken<Scheduler>('core.scheduler');
export const CommandStackToken = createToken<CommandStack>('core.commandStack');
export const GameLoopToken = createToken<GameLoop>('core.gameLoop');

const DEMO_ENTITY_COUNT = 100_000;

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

  const world = container.resolve(WorldToken);
  const scheduler = container.resolve(SchedulerToken);
  const renderer = container.resolve(RendererToken);
  await renderer.init();
  const input = container.resolve(InputToken);
  const rig = container.resolve(CameraRigToken);

  scheduler.add(new InputSystem(input));
  scheduler.add(new CameraControlSystem(rig, input, renderer));
  scheduler.add(new MovementSystem());
  scheduler.add(new LifetimeSystem());
  scheduler.add(new RespawnSystem());
  scheduler.add(new ParticleRenderSystem(renderer, DEMO_ENTITY_COUNT + 1024));
  scheduler.add(new RenderSystem(renderer));

  spawnParticles(world, DEMO_ENTITY_COUNT);

  const overlay = new DebugOverlay(app, 'WMZZ City — 阶段2：基础引擎');
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
        阶段: '2 / 11 (engine)',
        后端: renderer.backend,
        操作: 'WASD平移 QE旋转 滚轮缩放',
      },
    });
  });
  container.registerValue(GameLoopToken, loop);

  scheduler.start();
  loop.start();
  log.info(`Phase 2 bootstrap complete — backend=${renderer.backend}`);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      loop.stop();
      scheduler.dispose();
      overlay.dispose();
      container.dispose();
    });
  }
}

void bootstrap();
