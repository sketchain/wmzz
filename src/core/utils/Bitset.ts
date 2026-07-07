/**
 * Bit manipulation helpers operating on flat Uint32Array storage.
 *
 * Entity signatures are stored as fixed-width slices inside one large
 * Uint32Array (`words` per entity), so all helpers take a `base` word offset
 * instead of allocating per-entity arrays.
 */

export function bitsetSet(data: Uint32Array, base: number, bit: number): void {
  data[base + (bit >>> 5)] |= 1 << (bit & 31);
}

export function bitsetClear(data: Uint32Array, base: number, bit: number): void {
  data[base + (bit >>> 5)] &= ~(1 << (bit & 31));
}

export function bitsetTest(data: Uint32Array, base: number, bit: number): boolean {
  return (data[base + (bit >>> 5)] & (1 << (bit & 31))) !== 0;
}

export function bitsetClearAll(data: Uint32Array, base: number, words: number): void {
  data.fill(0, base, base + words);
}

/** signature ⊇ mask */
export function bitsetContainsAll(
  data: Uint32Array,
  base: number,
  mask: Uint32Array,
): boolean {
  for (let w = 0; w < mask.length; w++) {
    if ((data[base + w] & mask[w]) !== mask[w]) return false;
  }
  return true;
}

/** signature ∩ mask ≠ ∅ */
export function bitsetIntersects(
  data: Uint32Array,
  base: number,
  mask: Uint32Array,
): boolean {
  for (let w = 0; w < mask.length; w++) {
    if ((data[base + w] & mask[w]) !== 0) return true;
  }
  return false;
}

export function maskIsEmpty(mask: Uint32Array): boolean {
  for (let w = 0; w < mask.length; w++) {
    if (mask[w] !== 0) return false;
  }
  return true;
}

/** Iterate set bits within an entity signature slice. */
export function bitsetForEach(
  data: Uint32Array,
  base: number,
  words: number,
  fn: (bit: number) => void,
): void {
  for (let w = 0; w < words; w++) {
    let word = data[base + w];
    while (word !== 0) {
      const lsb = word & -word;
      const bit = (w << 5) + 31 - Math.clz32(lsb);
      fn(bit);
      word ^= lsb;
    }
  }
}
