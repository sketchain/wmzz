/**
 * Generic object pool for hot-path allocations (path nodes, events,
 * temp vectors). Avoids GC pressure in the simulation loop.
 */
export class ObjectPool<T> {
  private readonly free: T[] = [];
  private _created = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset?: (item: T) => void,
    preallocate = 0,
    private readonly maxRetained = 65536,
  ) {
    for (let i = 0; i < preallocate; i++) {
      this.free.push(this.factory());
      this._created++;
    }
  }

  get created(): number {
    return this._created;
  }

  get available(): number {
    return this.free.length;
  }

  acquire(): T {
    const item = this.free.pop();
    if (item !== undefined) return item;
    this._created++;
    return this.factory();
  }

  release(item: T): void {
    if (this.reset) this.reset(item);
    if (this.free.length < this.maxRetained) this.free.push(item);
  }

  releaseAll(items: T[]): void {
    for (const item of items) this.release(item);
    items.length = 0;
  }
}
