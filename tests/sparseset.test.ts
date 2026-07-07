import { describe, expect, it } from 'vitest';
import { SparseSet } from '../src/core/utils/SparseSet';

describe('SparseSet', () => {
  it('adds, queries and removes keys', () => {
    const set = new SparseSet(8, 4);
    expect(set.add(3, 30)).toBe(true);
    expect(set.add(5, 50)).toBe(true);
    expect(set.size).toBe(2);
    expect(set.has(3)).toBe(true);
    expect(set.valueOf(5)).toBe(50);

    expect(set.remove(3)).toBe(true);
    expect(set.has(3)).toBe(false);
    expect(set.size).toBe(1);
    expect(set.remove(3)).toBe(false);
  });

  it('overwrites the payload on duplicate add', () => {
    const set = new SparseSet();
    set.add(1, 10);
    expect(set.add(1, 99)).toBe(false);
    expect(set.size).toBe(1);
    expect(set.valueOf(1)).toBe(99);
  });

  it('keeps dense arrays consistent through swap-removal', () => {
    const set = new SparseSet();
    for (let i = 0; i < 10; i++) set.add(i, i * 100);
    set.remove(0);
    set.remove(4);
    set.remove(9);

    const seen = new Map<number, number>();
    set.forEach((value, key) => seen.set(key, value));
    expect(seen.size).toBe(7);
    for (const [key, value] of seen) {
      expect(value).toBe(key * 100);
    }
  });

  it('grows sparse and dense storage on demand', () => {
    const set = new SparseSet(2, 2);
    for (let i = 0; i < 1000; i++) set.add(i * 7, i);
    expect(set.size).toBe(1000);
    expect(set.has(6993)).toBe(true);
    expect(set.valueOf(6993)).toBe(999);
  });
});
