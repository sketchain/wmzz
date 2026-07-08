import { describe, expect, it } from 'vitest';
import { SimplexNoise2D } from '../src/terrain/noise/SimplexNoise';
import { HeightField } from '../src/terrain/HeightField';
import { createRng } from '../src/terrain/createRng';

describe('SimplexNoise2D', () => {
  it('is deterministic for a given seed', () => {
    const a = new SimplexNoise2D(42);
    const b = new SimplexNoise2D(42);
    for (let i = 0; i < 50; i++) {
      const x = i * 13.7;
      const y = i * -7.3;
      expect(a.noise(x, y)).toBe(b.noise(x, y));
    }
  });

  it('differs across seeds', () => {
    const a = new SimplexNoise2D(1);
    const b = new SimplexNoise2D(2);
    let different = false;
    for (let i = 0; i < 20; i++) {
      if (a.noise(i * 3.1, i * 5.7) !== b.noise(i * 3.1, i * 5.7)) different = true;
    }
    expect(different).toBe(true);
  });

  it('stays within [-1, 1] and fbm within bounds', () => {
    const noise = new SimplexNoise2D(7);
    for (let i = 0; i < 500; i++) {
      const v = noise.noise(i * 0.73, i * -1.21);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      const f = noise.fbm(i * 0.3, i * 0.17, 4);
      expect(Math.abs(f)).toBeLessThanOrEqual(1.001);
    }
  });
});

describe('createRng', () => {
  it('produces identical sequences per seed', () => {
    const a = createRng(1337);
    const b = createRng(1337);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
});

describe('HeightField', () => {
  it('same seed → identical terrain', () => {
    const a = new HeightField(999);
    const b = new HeightField(999);
    for (let i = 0; i < 100; i++) {
      const x = (i - 50) * 37.3;
      const z = (i - 50) * -21.7;
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
    }
  });

  it('edit deltas shift vertex heights and interpolate', () => {
    const field = new HeightField(1);
    const base = field.vertexHeight(10, 10);
    field.editDeltas.set(HeightField.vertexKey(10, 10), 5);
    expect(field.vertexHeight(10, 10)).toBeCloseTo(base + 5);
    // Bilinear at the exact vertex equals the vertex height.
    expect(field.heightAt(20, 20)).toBeCloseTo(base + 5); // cellSize=2 → vertex 10 = 20m
    // Halfway toward an unedited neighbor gets half the delta.
    const neighborBase = field.vertexHeight(11, 10);
    const mid = field.heightAt(21, 20);
    expect(mid).toBeCloseTo((base + 5 + neighborBase) / 2, 5);
  });

  it('bilinear interpolation is continuous across cells', () => {
    const field = new HeightField(2);
    // Sample two points a hair either side of a vertex boundary.
    const left = field.heightAt(39.999, 55);
    const right = field.heightAt(40.001, 55);
    expect(Math.abs(left - right)).toBeLessThan(0.01);
  });

  it('vertexKey is bijective over the supported range', () => {
    const seen = new Set<number>();
    for (const [vx, vz] of [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1],
      [1000, -1000], [-32000, 32000], [12345, -12345],
    ]) {
      const key = HeightField.vertexKey(vx, vz);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
