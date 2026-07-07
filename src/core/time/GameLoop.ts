/**
 * requestAnimationFrame driver with delta clamping and FPS statistics.
 * Rendering/simulation cadence is owned by the Scheduler; this class only
 * produces well-behaved frame deltas.
 */
export class GameLoop {
  /** Frame deltas are clamped to this many seconds (tab switch / debugger stalls). */
  maxFrameDelta = 0.25;

  private running = false;
  private rafHandle = 0;
  private lastTime = 0;
  private smoothedFps = 60;
  private lastFrameMs = 0;

  constructor(private readonly onFrame: (dt: number) => void) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Exponentially smoothed frames-per-second. */
  get fps(): number {
    return this.smoothedFps;
  }

  /** Last frame's total callback duration in milliseconds. */
  get frameMs(): number {
    return this.lastFrameMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const step = (now: number): void => {
      if (!this.running) return;
      const rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(rawDt, this.maxFrameDelta);
      if (rawDt > 0) {
        const instantFps = 1 / rawDt;
        this.smoothedFps += (instantFps - this.smoothedFps) * 0.05;
      }
      const beforeFrame = performance.now();
      this.onFrame(dt);
      this.lastFrameMs = performance.now() - beforeFrame;
      this.rafHandle = requestAnimationFrame(step);
    };
    this.rafHandle = requestAnimationFrame(step);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }
}
