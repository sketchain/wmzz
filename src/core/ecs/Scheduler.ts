import { System, SystemStage, type TickContext } from './System';
import type { World } from './World';
import type { GameEventBus } from '../events/GameEvents';

export interface SchedulerOptions {
  /** Fixed simulation timestep in seconds (default 1/30 s = 30 ticks/s). */
  fixedDelta?: number;
  /** Max fixed ticks executed per frame before dropping time (spiral-of-death guard). */
  maxCatchUpTicks?: number;
}

interface MutableTickContext {
  dt: number;
  fixedDelta: number;
  elapsed: number;
  frame: number;
  tick: number;
  alpha: number;
  timeScale: number;
}

/**
 * Stage-ordered system scheduler with a fixed-timestep simulation loop.
 *
 * Per frame: Input → Simulation×N (fixed dt, accumulator-driven) → Update →
 * Render → Cleanup. Deferred world ops flush after every system; queued
 * events flush after every stage. `timeScale` speeds up/pauses simulation
 * without affecting input/render responsiveness.
 */
export class Scheduler {
  timeScale = 1;
  paused = false;

  private readonly stages: System[][];
  private readonly fixedDelta: number;
  private readonly maxCatchUpTicks: number;
  private accumulator = 0;
  private started = false;
  private readonly ctx: MutableTickContext;
  /** Last measured duration per system (ms), keyed by system name. */
  readonly profile = new Map<string, number>();

  constructor(
    private readonly world: World,
    private readonly events?: GameEventBus,
    options: SchedulerOptions = {},
  ) {
    this.fixedDelta = options.fixedDelta ?? 1 / 30;
    this.maxCatchUpTicks = options.maxCatchUpTicks ?? 5;
    this.stages = [];
    for (let s = 0; s <= SystemStage.Cleanup; s++) this.stages.push([]);
    this.ctx = {
      dt: 0,
      fixedDelta: this.fixedDelta,
      elapsed: 0,
      frame: 0,
      tick: 0,
      alpha: 0,
      timeScale: 1,
    };
  }

  get frame(): number {
    return this.ctx.frame;
  }

  get tick(): number {
    return this.ctx.tick;
  }

  add(system: System): this {
    const list = this.stages[system.stage];
    // Insertion sort keeps stage lists ordered by `order` (stable for equal keys).
    let insertAt = list.length;
    while (insertAt > 0 && list[insertAt - 1].order > system.order) insertAt--;
    list.splice(insertAt, 0, system);
    if (this.started) system.init(this.world);
    return this;
  }

  remove(system: System): boolean {
    const list = this.stages[system.stage];
    const at = list.indexOf(system);
    if (at < 0) return false;
    list.splice(at, 1);
    system.dispose(this.world);
    return true;
  }

  getSystems(stage?: SystemStage): readonly System[] {
    if (stage !== undefined) return this.stages[stage];
    return this.stages.flat();
  }

  /** Initialize all systems and run Startup once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const list of this.stages) {
      for (const system of list) system.init(this.world);
    }
    this.ctx.dt = 0;
    this.runStage(SystemStage.Startup);
  }

  /** Advance one frame. `frameDt` is real elapsed seconds since last frame. */
  frameUpdate(frameDt: number): void {
    if (!this.started) this.start();

    this.ctx.frame++;
    this.ctx.elapsed += frameDt;
    this.ctx.timeScale = this.paused ? 0 : this.timeScale;

    this.ctx.dt = frameDt;
    this.runStage(SystemStage.Input);

    if (!this.paused && this.timeScale > 0) {
      this.accumulator += frameDt * this.timeScale;
      const maxAccumulated = this.fixedDelta * this.maxCatchUpTicks;
      if (this.accumulator > maxAccumulated) this.accumulator = maxAccumulated;
      this.ctx.dt = this.fixedDelta;
      while (this.accumulator >= this.fixedDelta) {
        this.accumulator -= this.fixedDelta;
        this.ctx.tick++;
        this.runStage(SystemStage.Simulation);
      }
    }
    this.ctx.alpha = this.accumulator / this.fixedDelta;

    this.ctx.dt = frameDt;
    this.runStage(SystemStage.Update);
    this.runStage(SystemStage.Render);
    this.runStage(SystemStage.Cleanup);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.events?.emit('game:paused', { paused });
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale);
    this.events?.emit('game:speedChanged', { scale: this.timeScale });
  }

  dispose(): void {
    for (const list of this.stages) {
      for (const system of list) system.dispose(this.world);
      list.length = 0;
    }
    this.started = false;
  }

  private runStage(stage: SystemStage): void {
    const list = this.stages[stage];
    for (const system of list) {
      if (!system.enabled) continue;
      const startedAt = performance.now();
      system.update(this.world, this.ctx as TickContext);
      this.world.flushDeferred();
      this.profile.set(system.name, performance.now() - startedAt);
    }
    this.events?.flush();
  }
}
