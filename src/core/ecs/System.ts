import type { World } from './World';

/**
 * Execution stages, run in declaration order each frame:
 *
 *  Startup    – once, when the scheduler starts
 *  Input      – per frame, before simulation (device state → intents)
 *  Simulation – fixed timestep (deterministic game logic; may run 0..N
 *               times per frame depending on the accumulator)
 *  Update     – per frame, variable dt (interpolation, camera, tweens)
 *  Render     – per frame (scene sync, draw submission)
 *  Cleanup    – per frame end (transient tags, frame allocators)
 */
export enum SystemStage {
  Startup = 0,
  Input = 1,
  Simulation = 2,
  Update = 3,
  Render = 4,
  Cleanup = 5,
}

export interface TickContext {
  /** Seconds for this invocation: fixedDelta in Simulation, frame dt elsewhere. */
  readonly dt: number;
  /** Fixed simulation timestep in seconds. */
  readonly fixedDelta: number;
  /** Total wall-clock seconds since scheduler start (unscaled). */
  readonly elapsed: number;
  /** Frame counter. */
  readonly frame: number;
  /** Fixed simulation tick counter. */
  readonly tick: number;
  /** Interpolation factor [0,1) between the last two fixed ticks. */
  readonly alpha: number;
  /** Simulation speed multiplier currently applied. */
  readonly timeScale: number;
}

export abstract class System {
  abstract readonly name: string;
  readonly stage: SystemStage = SystemStage.Update;
  /** Lower runs earlier within the same stage. */
  readonly order: number = 0;
  enabled = true;

  /** Called once when the system is added to a started scheduler. */
  init(_world: World): void {}

  abstract update(world: World, ctx: TickContext): void;

  dispose(_world: World): void {}
}
