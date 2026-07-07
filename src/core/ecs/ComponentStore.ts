import type {
  ComponentSchema,
  FieldType,
  ObjectComponentType,
  SoaComponentType,
  SoaValues,
} from './Component';
import type { Entity } from './Entity';

export type NumericArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

type ArrayFor<F extends FieldType> = F extends 'f32'
  ? Float32Array
  : F extends 'f64'
    ? Float64Array
    : F extends 'i8'
      ? Int8Array
      : F extends 'i16'
        ? Int16Array
        : F extends 'i32'
          ? Int32Array
          : F extends 'u8'
            ? Uint8Array
            : F extends 'u16'
              ? Uint16Array
              : Uint32Array;

export type SoaFields<S extends ComponentSchema> = { [K in keyof S]: ArrayFor<S[K]> };

function createArray(type: FieldType, length: number): NumericArray {
  switch (type) {
    case 'f32':
      return new Float32Array(length);
    case 'f64':
      return new Float64Array(length);
    case 'i8':
      return new Int8Array(length);
    case 'i16':
      return new Int16Array(length);
    case 'i32':
      return new Int32Array(length);
    case 'u8':
      return new Uint8Array(length);
    case 'u16':
      return new Uint16Array(length);
    case 'u32':
      return new Uint32Array(length);
  }
}

export interface ComponentStore {
  readonly typeId: number;
  readonly size: number;
  hasIndex(entityIndex: number): boolean;
  removeByIndex(entityIndex: number): void;
  clear(): void;
}

/**
 * Structure-of-Arrays sparse-set storage.
 *
 * sparse[entityIndex] = denseIndex + 1 (0 = absent); removal swap-pops the
 * last dense slot so all field arrays stay hole-free for linear iteration.
 */
export class SoaStore<S extends ComponentSchema> implements ComponentStore {
  readonly typeId: number;
  readonly fields: SoaFields<S>;
  /** dense slot -> full entity id (valid in [0, size)) */
  entities: Uint32Array;

  private sparse: Uint32Array;
  private capacity: number;
  private _size = 0;
  private readonly fieldNames: (keyof S & string)[];
  private readonly type: SoaComponentType<S>;

  constructor(type: SoaComponentType<S>, initialCapacity = 256, sparseCapacity = 1024) {
    this.type = type;
    this.typeId = type.id;
    this.capacity = initialCapacity;
    this.sparse = new Uint32Array(sparseCapacity);
    this.entities = new Uint32Array(initialCapacity);
    this.fieldNames = Object.keys(type.schema) as (keyof S & string)[];
    const fields = {} as SoaFields<S>;
    for (const field of this.fieldNames) {
      fields[field] = createArray(type.schema[field], initialCapacity) as SoaFields<S>[typeof field];
    }
    this.fields = fields;
  }

  get size(): number {
    return this._size;
  }

  hasIndex(entityIndex: number): boolean {
    return entityIndex < this.sparse.length && this.sparse[entityIndex] !== 0;
  }

  /** Dense slot for an entity index, or -1. */
  denseIndexOf(entityIndex: number): number {
    if (entityIndex >= this.sparse.length) return -1;
    return this.sparse[entityIndex] - 1;
  }

  add(entity: Entity, entityIndex: number, values?: SoaValues<S>): number {
    if (entityIndex >= this.sparse.length) this.growSparse(entityIndex + 1);
    let dense = this.sparse[entityIndex] - 1;
    if (dense < 0) {
      if (this._size === this.capacity) this.growDense();
      dense = this._size++;
      this.sparse[entityIndex] = dense + 1;
      this.entities[dense] = entity;
    }
    const defaults = this.type.defaults;
    for (const field of this.fieldNames) {
      const provided = values?.[field];
      this.fields[field][dense] = provided !== undefined ? provided : (defaults[field] ?? 0);
    }
    return dense;
  }

  removeByIndex(entityIndex: number): void {
    if (entityIndex >= this.sparse.length) return;
    const dense = this.sparse[entityIndex] - 1;
    if (dense < 0) return;
    const last = this._size - 1;
    if (dense !== last) {
      for (const field of this.fieldNames) {
        this.fields[field][dense] = this.fields[field][last];
      }
      const movedEntity = this.entities[last];
      this.entities[dense] = movedEntity;
      this.sparse[movedEntity & 0xffffff] = dense + 1;
    }
    this.sparse[entityIndex] = 0;
    this._size = last;
  }

  /** Copy one entity's fields into a plain object (convenience / cold paths). */
  read(entityIndex: number): Record<keyof S, number> | undefined {
    const dense = this.denseIndexOf(entityIndex);
    if (dense < 0) return undefined;
    const out = {} as Record<keyof S, number>;
    for (const field of this.fieldNames) {
      out[field] = this.fields[field][dense];
    }
    return out;
  }

  write(entityIndex: number, values: SoaValues<S>): boolean {
    const dense = this.denseIndexOf(entityIndex);
    if (dense < 0) return false;
    for (const field of this.fieldNames) {
      const value = values[field];
      if (value !== undefined) this.fields[field][dense] = value;
    }
    return true;
  }

  clear(): void {
    this.sparse.fill(0);
    this._size = 0;
  }

  private growSparse(minLength: number): void {
    let next = this.sparse.length * 2;
    while (next < minLength) next *= 2;
    const grown = new Uint32Array(next);
    grown.set(this.sparse);
    this.sparse = grown;
  }

  private growDense(): void {
    const next = this.capacity * 2;
    const entities = new Uint32Array(next);
    entities.set(this.entities);
    this.entities = entities;
    for (const field of this.fieldNames) {
      const grown = createArray(this.type.schema[field], next);
      (grown as Float64Array).set(this.fields[field] as unknown as Float64Array);
      this.fields[field] = grown as SoaFields<S>[typeof field];
    }
    this.capacity = next;
  }
}

/** Dense sparse-set storage for plain-object components (cold data). */
export class ObjectStore<T> implements ComponentStore {
  readonly typeId: number;
  /** dense slot -> full entity id (valid in [0, size)) */
  entities: Uint32Array;
  readonly data: T[] = [];

  private sparse: Uint32Array;

  constructor(type: ObjectComponentType<T>, sparseCapacity = 1024) {
    this.typeId = type.id;
    this.sparse = new Uint32Array(sparseCapacity);
    this.entities = new Uint32Array(256);
  }

  get size(): number {
    return this.data.length;
  }

  hasIndex(entityIndex: number): boolean {
    return entityIndex < this.sparse.length && this.sparse[entityIndex] !== 0;
  }

  get(entityIndex: number): T | undefined {
    if (entityIndex >= this.sparse.length) return undefined;
    const dense = this.sparse[entityIndex] - 1;
    return dense < 0 ? undefined : this.data[dense];
  }

  add(entity: Entity, entityIndex: number, value: T): void {
    if (entityIndex >= this.sparse.length) this.growSparse(entityIndex + 1);
    const existing = this.sparse[entityIndex] - 1;
    if (existing >= 0) {
      this.data[existing] = value;
      return;
    }
    const dense = this.data.length;
    if (dense === this.entities.length) {
      const grown = new Uint32Array(this.entities.length * 2);
      grown.set(this.entities);
      this.entities = grown;
    }
    this.data.push(value);
    this.entities[dense] = entity;
    this.sparse[entityIndex] = dense + 1;
  }

  removeByIndex(entityIndex: number): void {
    if (entityIndex >= this.sparse.length) return;
    const dense = this.sparse[entityIndex] - 1;
    if (dense < 0) return;
    const last = this.data.length - 1;
    if (dense !== last) {
      this.data[dense] = this.data[last];
      const movedEntity = this.entities[last];
      this.entities[dense] = movedEntity;
      this.sparse[movedEntity & 0xffffff] = dense + 1;
    }
    this.data.pop();
    this.sparse[entityIndex] = 0;
  }

  clear(): void {
    this.sparse.fill(0);
    this.data.length = 0;
  }

  private growSparse(minLength: number): void {
    let next = this.sparse.length * 2;
    while (next < minLength) next *= 2;
    const grown = new Uint32Array(next);
    grown.set(this.sparse);
    this.sparse = grown;
  }
}
