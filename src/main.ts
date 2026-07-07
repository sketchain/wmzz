import { Scheduler, World } from '@/core/ecs';
import { GameLoop } from '@/core/time/GameLoop';
import { ServiceContainer, createToken } from '@/core/di/ServiceContainer';
import { CommandStack } from '@/core/commands/CommandStack';
import { createGameEventBus, EventBusToken } from '@/core/events/GameEvents';
import { createLogger } from '@/core/utils/Logger';
import { GameConfig } from '@/config/GameConfig';
import { DebugOverlay } from '@/boot/DebugOverlay';
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

const DEMO_ENTITY_COUNT = 200_000;

function bootstrap(): void {
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

  const world = container.resolve(WorldToken);
  const scheduler = container.resolve(SchedulerToken);

  scheduler.add(new MovementSystem());
  scheduler.add(new LifetimeSystem());
  scheduler.add(new RespawnSystem());

  log.info(`spawning ${DEMO_ENTITY_COUNT.toLocaleString()} demo entities…`);
  const spawnStart = performance.now();
  spawnParticles(world, DEMO_ENTITY_COUNT);
  log.info(`spawn finished in ${(performance.now() - spawnStart).toFixed(1)} ms`);

  const overlay = new DebugOverlay(app, 'WMZZ City — 阶段1：ECS 核心压力测试');
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
        阶段: '1 / 11 (ECS core)',
        模拟频率: `${GameConfig.simulation.tickRate} Hz`,
      },
    });
  });
  container.registerValue(GameLoopToken, loop);

  scheduler.start();
  loop.start();
  log.info('Phase 1 bootstrap complete — ECS core running');

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      loop.stop();
      scheduler.dispose();
      overlay.dispose();
      container.dispose();
    });
  }
}

bootstrap();
