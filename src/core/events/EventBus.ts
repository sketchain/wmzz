export type Unsubscribe = () => void;

interface QueuedEvent {
  key: string;
  payload: unknown;
}

/**
 * Typed publish/subscribe event bus.
 *
 * `emit` dispatches synchronously (input, commands, UI). `enqueue` defers
 * until the scheduler calls `flush` at a stage boundary, which keeps
 * simulation systems free of reentrant side effects mid-iteration.
 *
 * The event map `M` is supplied by the game layer (see GameEvents.ts) and can
 * be extended by feature modules through interface merging.
 */
export class EventBus<M extends object> {
  private readonly handlers = new Map<string, Set<(payload: never) => void>>();
  private queue: QueuedEvent[] = [];
  private backQueue: QueuedEvent[] = [];

  on<K extends keyof M & string>(key: K, handler: (payload: M[K]) => void): Unsubscribe {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(key, handler);
  }

  once<K extends keyof M & string>(
    key: K,
    handler: (payload: M[K]) => void,
  ): Unsubscribe {
    const unsubscribe = this.on(key, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof M & string>(key: K, handler: (payload: M[K]) => void): void {
    this.handlers.get(key)?.delete(handler as (payload: never) => void);
  }

  /** Synchronous dispatch. Handlers added/removed during dispatch take effect next emit. */
  emit<K extends keyof M & string>(key: K, payload: M[K]): void {
    const set = this.handlers.get(key);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      (handler as (p: M[K]) => void)(payload);
    }
  }

  /** Deferred dispatch; delivered on the next `flush()`. */
  enqueue<K extends keyof M & string>(key: K, payload: M[K]): void {
    this.queue.push({ key, payload });
  }

  get pending(): number {
    return this.queue.length;
  }

  /**
   * Deliver all queued events. Events enqueued by handlers during a flush are
   * delivered within the same flush (bounded by `maxPasses` to surface
   * infinite feedback loops instead of hanging the frame).
   */
  flush(maxPasses = 8): void {
    let passes = 0;
    while (this.queue.length > 0) {
      if (++passes > maxPasses) {
        throw new Error(
          `EventBus: event feedback loop detected (queue still growing after ${maxPasses} passes)`,
        );
      }
      const current = this.queue;
      this.queue = this.backQueue;
      this.queue.length = 0;
      this.backQueue = current;
      for (const event of current) {
        this.emit(event.key as keyof M & string, event.payload as M[keyof M & string]);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
    this.queue.length = 0;
  }
}
