/**
 * Sparse set over non-negative integer keys.
 *
 * O(1) add / remove / has, dense iteration with zero holes. The dense array
 * stores an arbitrary u32 payload per key (typically the full entity id,
 * while the key is the entity index).
 */
export class SparseSet {
  private sparse: Uint32Array; // key -> denseIndex + 1 (0 = absent)
  private denseKeys: Uint32Array;
  private denseValues: Uint32Array;
  private _size = 0;

  constructor(initialKeyCapacity = 1024, initialDenseCapacity = 256) {
    this.sparse = new Uint32Array(initialKeyCapacity);
    this.denseKeys = new Uint32Array(initialDenseCapacity);
    this.denseValues = new Uint32Array(initialDenseCapacity);
  }

  get size(): number {
    return this._size;
  }

  /** Dense payload array; only indices [0, size) are valid. */
  get values(): Uint32Array {
    return this.denseValues;
  }

  /** Dense key array; only indices [0, size) are valid. */
  get keys(): Uint32Array {
    return this.denseKeys;
  }

  has(key: number): boolean {
    return key < this.sparse.length && this.sparse[key] !== 0;
  }

  valueOf(key: number): number {
    return this.denseValues[this.sparse[key] - 1];
  }

  add(key: number, value: number): boolean {
    if (key >= this.sparse.length) this.growSparse(key + 1);
    if (this.sparse[key] !== 0) {
      this.denseValues[this.sparse[key] - 1] = value;
      return false;
    }
    if (this._size === this.denseKeys.length) this.growDense();
    this.denseKeys[this._size] = key;
    this.denseValues[this._size] = value;
    this.sparse[key] = this._size + 1;
    this._size++;
    return true;
  }

  remove(key: number): boolean {
    if (key >= this.sparse.length) return false;
    const denseIndex = this.sparse[key] - 1;
    if (denseIndex < 0) return false;
    const last = this._size - 1;
    if (denseIndex !== last) {
      const movedKey = this.denseKeys[last];
      this.denseKeys[denseIndex] = movedKey;
      this.denseValues[denseIndex] = this.denseValues[last];
      this.sparse[movedKey] = denseIndex + 1;
    }
    this.sparse[key] = 0;
    this._size = last;
    return true;
  }

  clear(): void {
    this.sparse.fill(0);
    this._size = 0;
  }

  forEach(fn: (value: number, key: number) => void): void {
    for (let i = 0; i < this._size; i++) {
      fn(this.denseValues[i], this.denseKeys[i]);
    }
  }

  private growSparse(minLength: number): void {
    let next = this.sparse.length * 2;
    while (next < minLength) next *= 2;
    const grown = new Uint32Array(next);
    grown.set(this.sparse);
    this.sparse = grown;
  }

  private growDense(): void {
    const next = this.denseKeys.length * 2;
    const keys = new Uint32Array(next);
    keys.set(this.denseKeys);
    this.denseKeys = keys;
    const values = new Uint32Array(next);
    values.set(this.denseValues);
    this.denseValues = values;
  }
}
