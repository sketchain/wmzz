/**
 * Entity id layout (packed into one u32):
 *
 *   [ generation : 8 bits ][ index : 24 bits ]
 *
 * 24 bits of index → 16.7M concurrent entities, enough for the target of
 * 500k+ citizens, 100k+ vehicles and 100k+ buildings with a wide margin.
 * The 8-bit generation catches stale handles after an index is recycled;
 * it wraps at 256, which in practice makes dangling-id collisions vanishingly
 * rare while keeping the whole id inside a fast SMI / typed-array slot.
 */
export type Entity = number;

export const ENTITY_INDEX_BITS = 24;
export const ENTITY_INDEX_MASK = (1 << ENTITY_INDEX_BITS) - 1;
export const MAX_ENTITY_INDEX = ENTITY_INDEX_MASK; // index MAX is reserved for NULL
export const NULL_ENTITY: Entity = 0xffffffff >>> 0;

export function entityIndex(entity: Entity): number {
  return entity & ENTITY_INDEX_MASK;
}

export function entityGeneration(entity: Entity): number {
  return entity >>> ENTITY_INDEX_BITS;
}

export function makeEntity(index: number, generation: number): Entity {
  return (((generation & 0xff) << ENTITY_INDEX_BITS) | index) >>> 0;
}

/**
 * Allocates and recycles entity indices. Destroying an entity bumps its
 * index generation so any surviving handle to the old entity stops
 * validating against `isAlive`.
 */
export class EntityAllocator {
  private generations: Uint8Array;
  private aliveFlags: Uint8Array;
  private readonly freeIndices: number[] = [];
  private nextIndex = 0;
  private _aliveCount = 0;

  constructor(initialCapacity = 65536) {
    this.generations = new Uint8Array(initialCapacity);
    this.aliveFlags = new Uint8Array(initialCapacity);
  }

  get aliveCount(): number {
    return this._aliveCount;
  }

  /** Highest index ever allocated + 1 (upper bound for per-index storage). */
  get indexCapacity(): number {
    return this.nextIndex;
  }

  create(): Entity {
    let index: number;
    const recycled = this.freeIndices.pop();
    if (recycled !== undefined) {
      index = recycled;
    } else {
      index = this.nextIndex++;
      if (index >= MAX_ENTITY_INDEX) {
        throw new Error('EntityAllocator: entity index space exhausted');
      }
      if (index >= this.generations.length) this.grow(index + 1);
    }
    this.aliveFlags[index] = 1;
    this._aliveCount++;
    return makeEntity(index, this.generations[index]);
  }

  destroy(entity: Entity): boolean {
    const index = entityIndex(entity);
    if (!this.isAlive(entity)) return false;
    this.aliveFlags[index] = 0;
    this.generations[index] = (this.generations[index] + 1) & 0xff;
    this.freeIndices.push(index);
    this._aliveCount--;
    return true;
  }

  isAlive(entity: Entity): boolean {
    const index = entityIndex(entity);
    return (
      index < this.nextIndex &&
      this.aliveFlags[index] === 1 &&
      this.generations[index] === entityGeneration(entity)
    );
  }

  /** Current entity id for a live index (used when iterating dense storages). */
  entityAt(index: number): Entity {
    return makeEntity(index, this.generations[index]);
  }

  private grow(minLength: number): void {
    let next = this.generations.length * 2;
    while (next < minLength) next *= 2;
    const generations = new Uint8Array(next);
    generations.set(this.generations);
    this.generations = generations;
    const alive = new Uint8Array(next);
    alive.set(this.aliveFlags);
    this.aliveFlags = alive;
  }
}
