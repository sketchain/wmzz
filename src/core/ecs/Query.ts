import { SIGNATURE_WORDS, type AnyComponentType } from './Component';
import type { Entity } from './Entity';
import { SparseSet } from '../utils/SparseSet';
import {
  bitsetContainsAll,
  bitsetIntersects,
  maskIsEmpty,
} from '../utils/Bitset';

export interface QueryDesc {
  /** Entity must have every listed component. */
  all?: readonly AnyComponentType[];
  /** Entity must have at least one listed component (ignored if empty). */
  any?: readonly AnyComponentType[];
  /** Entity must have none of the listed components. */
  none?: readonly AnyComponentType[];
}

export function queryKey(desc: QueryDesc): string {
  const part = (types?: readonly AnyComponentType[]): string =>
    (types ?? [])
      .map((t) => t.id)
      .sort((a, b) => a - b)
      .join(',');
  return `all:${part(desc.all)}|any:${part(desc.any)}|none:${part(desc.none)}`;
}

function buildMask(types?: readonly AnyComponentType[]): Uint32Array {
  const mask = new Uint32Array(SIGNATURE_WORDS);
  for (const type of types ?? []) {
    mask[type.id >>> 5] |= 1 << (type.id & 31);
  }
  return mask;
}

/**
 * Live entity query.
 *
 * Queries are registered with the World and updated incrementally: every
 * structural change (component add/remove, entity destroy) re-tests only the
 * affected entity, so iteration is always O(matched) with no per-frame
 * rebuild — essential at 500k+ entities.
 */
export class Query {
  readonly key: string;

  private readonly allMask: Uint32Array;
  private readonly anyMask: Uint32Array;
  private readonly noneMask: Uint32Array;
  private readonly hasAny: boolean;
  private readonly hasNone: boolean;
  private readonly matched = new SparseSet();

  constructor(desc: QueryDesc) {
    this.key = queryKey(desc);
    this.allMask = buildMask(desc.all);
    this.anyMask = buildMask(desc.any);
    this.noneMask = buildMask(desc.none);
    this.hasAny = !maskIsEmpty(this.anyMask);
    this.hasNone = !maskIsEmpty(this.noneMask);
  }

  get size(): number {
    return this.matched.size;
  }

  /** Dense entity-id array; only [0, size) valid. Hot loops iterate this directly. */
  get entities(): Uint32Array {
    return this.matched.values;
  }

  contains(entityIndex: number): boolean {
    return this.matched.has(entityIndex);
  }

  forEach(fn: (entity: Entity) => void): void {
    const dense = this.matched.values;
    const count = this.matched.size;
    for (let i = 0; i < count; i++) fn(dense[i]);
  }

  matches(signatures: Uint32Array, base: number): boolean {
    if (!bitsetContainsAll(signatures, base, this.allMask)) return false;
    if (this.hasAny && !bitsetIntersects(signatures, base, this.anyMask)) return false;
    if (this.hasNone && bitsetIntersects(signatures, base, this.noneMask)) return false;
    return true;
  }

  /** Re-test one entity after its signature changed (or it died). */
  refresh(
    entityIndex: number,
    entity: Entity,
    signatures: Uint32Array,
    base: number,
    alive: boolean,
  ): void {
    if (alive && this.matches(signatures, base)) {
      this.matched.add(entityIndex, entity);
    } else {
      this.matched.remove(entityIndex);
    }
  }

  clear(): void {
    this.matched.clear();
  }
}
