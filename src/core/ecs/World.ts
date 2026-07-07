import {
  SIGNATURE_WORDS,
  type AnyComponentType,
  type ComponentSchema,
  type ObjectComponentType,
  type SoaComponentType,
  type SoaValues,
  type TagComponentType,
} from './Component';
import { ObjectStore, SoaStore, type ComponentStore } from './ComponentStore';
import { EntityAllocator, entityIndex, type Entity } from './Entity';
import { Query, queryKey, type QueryDesc } from './Query';
import {
  bitsetClear,
  bitsetClearAll,
  bitsetForEach,
  bitsetSet,
  bitsetTest,
} from '../utils/Bitset';

/**
 * ECS World: owns entities, component storages and live queries.
 *
 * Structural changes made while systems iterate queries should go through
 * `defer()`; the scheduler flushes the deferred queue after every system so
 * iteration order is never invalidated mid-loop.
 */
export class World {
  private readonly allocator = new EntityAllocator();
  /** Flat signature storage: SIGNATURE_WORDS u32 words per entity index. */
  private signatures: Uint32Array;
  private signatureCapacity: number;
  private readonly stores: (ComponentStore | undefined)[] = [];
  private readonly queriesByKey = new Map<string, Query>();
  private readonly queryList: Query[] = [];
  private readonly deferredOps: (() => void)[] = [];

  constructor(initialEntityCapacity = 65536) {
    this.signatureCapacity = initialEntityCapacity;
    this.signatures = new Uint32Array(initialEntityCapacity * SIGNATURE_WORDS);
  }

  // ── Entities ────────────────────────────────────────────────────────────

  get entityCount(): number {
    return this.allocator.aliveCount;
  }

  createEntity(): Entity {
    const entity = this.allocator.create();
    const index = entityIndex(entity);
    if (index >= this.signatureCapacity) this.growSignatures(index + 1);
    else bitsetClearAll(this.signatures, index * SIGNATURE_WORDS, SIGNATURE_WORDS);
    return entity;
  }

  isAlive(entity: Entity): boolean {
    return this.allocator.isAlive(entity);
  }

  destroyEntity(entity: Entity): boolean {
    if (!this.allocator.isAlive(entity)) return false;
    const index = entityIndex(entity);
    const base = index * SIGNATURE_WORDS;
    bitsetForEach(this.signatures, base, SIGNATURE_WORDS, (typeId) => {
      this.stores[typeId]?.removeByIndex(index);
    });
    bitsetClearAll(this.signatures, base, SIGNATURE_WORDS);
    this.allocator.destroy(entity);
    for (const query of this.queryList) {
      query.refresh(index, entity, this.signatures, base, false);
    }
    return true;
  }

  // ── Components ──────────────────────────────────────────────────────────

  addComponent(entity: Entity, type: TagComponentType): void;
  addComponent<S extends ComponentSchema>(
    entity: Entity,
    type: SoaComponentType<S>,
    values?: SoaValues<S>,
  ): void;
  addComponent<T>(entity: Entity, type: ObjectComponentType<T>, value: T): void;
  addComponent(entity: Entity, type: AnyComponentType, valuesOrValue?: unknown): void {
    this.assertAlive(entity, `addComponent(${type.name})`);
    const index = entityIndex(entity);
    if (type.kind === 'soa') {
      this.soaStoreFor(type).add(entity, index, valuesOrValue as SoaValues<ComponentSchema>);
    } else if (type.kind === 'object') {
      this.objectStoreFor(type).add(entity, index, valuesOrValue);
    }
    const base = index * SIGNATURE_WORDS;
    if (!bitsetTest(this.signatures, base, type.id)) {
      bitsetSet(this.signatures, base, type.id);
      this.notifyQueries(index, entity, base);
    }
  }

  removeComponent(entity: Entity, type: AnyComponentType): boolean {
    if (!this.allocator.isAlive(entity)) return false;
    const index = entityIndex(entity);
    const base = index * SIGNATURE_WORDS;
    if (!bitsetTest(this.signatures, base, type.id)) return false;
    this.stores[type.id]?.removeByIndex(index);
    bitsetClear(this.signatures, base, type.id);
    this.notifyQueries(index, entity, base);
    return true;
  }

  hasComponent(entity: Entity, type: AnyComponentType): boolean {
    if (!this.allocator.isAlive(entity)) return false;
    const index = entityIndex(entity);
    return bitsetTest(this.signatures, index * SIGNATURE_WORDS, type.id);
  }

  /** Direct SoA storage access — the fast path for systems. */
  soa<S extends ComponentSchema>(type: SoaComponentType<S>): SoaStore<S> {
    return this.soaStoreFor(type);
  }

  /** Direct object storage access. */
  objects<T>(type: ObjectComponentType<T>): ObjectStore<T> {
    return this.objectStoreFor(type);
  }

  getObject<T>(entity: Entity, type: ObjectComponentType<T>): T | undefined {
    if (!this.allocator.isAlive(entity)) return undefined;
    return this.objectStoreFor(type).get(entityIndex(entity));
  }

  /** Copy an entity's SoA fields into a plain object (cold/UI paths). */
  read<S extends ComponentSchema>(
    entity: Entity,
    type: SoaComponentType<S>,
  ): Record<keyof S, number> | undefined {
    if (!this.allocator.isAlive(entity)) return undefined;
    return this.soaStoreFor(type).read(entityIndex(entity));
  }

  write<S extends ComponentSchema>(
    entity: Entity,
    type: SoaComponentType<S>,
    values: SoaValues<S>,
  ): boolean {
    if (!this.allocator.isAlive(entity)) return false;
    return this.soaStoreFor(type).write(entityIndex(entity), values);
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  /**
   * Get or create a cached live query. Creating a query performs a one-time
   * scan of existing entities; afterwards it stays updated incrementally.
   */
  query(desc: QueryDesc): Query {
    const key = queryKey(desc);
    let query = this.queriesByKey.get(key);
    if (query) return query;
    query = new Query(desc);
    this.queriesByKey.set(key, query);
    this.queryList.push(query);
    const capacity = this.allocator.indexCapacity;
    for (let index = 0; index < capacity; index++) {
      const entity = this.allocator.entityAt(index);
      if (!this.allocator.isAlive(entity)) continue;
      query.refresh(index, entity, this.signatures, index * SIGNATURE_WORDS, true);
    }
    return query;
  }

  // ── Deferred structural changes ─────────────────────────────────────────

  defer(op: () => void): void {
    this.deferredOps.push(op);
  }

  flushDeferred(): void {
    if (this.deferredOps.length === 0) return;
    // Ops may defer further ops; process until drained.
    while (this.deferredOps.length > 0) {
      const ops = this.deferredOps.splice(0, this.deferredOps.length);
      for (const op of ops) op();
    }
  }

  // ── Maintenance ─────────────────────────────────────────────────────────

  /** Destroy everything (used by save-load and scene resets). */
  clear(): void {
    const capacity = this.allocator.indexCapacity;
    for (let index = 0; index < capacity; index++) {
      const entity = this.allocator.entityAt(index);
      if (this.allocator.isAlive(entity)) this.destroyEntity(entity);
    }
    this.deferredOps.length = 0;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private notifyQueries(index: number, entity: Entity, base: number): void {
    for (const query of this.queryList) {
      query.refresh(index, entity, this.signatures, base, true);
    }
  }

  private soaStoreFor<S extends ComponentSchema>(type: SoaComponentType<S>): SoaStore<S> {
    let store = this.stores[type.id] as SoaStore<S> | undefined;
    if (!store) {
      store = new SoaStore(type);
      this.stores[type.id] = store;
    }
    return store;
  }

  private objectStoreFor<T>(type: ObjectComponentType<T>): ObjectStore<T> {
    let store = this.stores[type.id] as ObjectStore<T> | undefined;
    if (!store) {
      store = new ObjectStore(type);
      this.stores[type.id] = store;
    }
    return store;
  }

  private assertAlive(entity: Entity, operation: string): void {
    if (!this.allocator.isAlive(entity)) {
      throw new Error(`World.${operation}: entity ${entity} is not alive`);
    }
  }

  private growSignatures(minEntityCapacity: number): void {
    let next = this.signatureCapacity * 2;
    while (next < minEntityCapacity) next *= 2;
    const grown = new Uint32Array(next * SIGNATURE_WORDS);
    grown.set(this.signatures);
    this.signatures = grown;
    this.signatureCapacity = next;
  }
}
