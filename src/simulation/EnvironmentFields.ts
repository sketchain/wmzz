import { createToken } from '@/core/di/ServiceContainer';

export const FIELD_CELL = 32; // meters per environment-field cell

export function fieldKey(cx: number, cz: number): number {
  return ((cx + 0x8000) << 16) | ((cz + 0x8000) & 0xffff);
}

/** Service coverage bitmask flags. */
export const COVER_PARK = 1;
export const COVER_SCHOOL = 2;
export const COVER_HOSPITAL = 4;
export const COVER_POLICE = 8;
export const COVER_FIRE = 16;

/**
 * Sparse city-wide scalar fields on a 32 m grid: pollution, noise, land
 * value, crime and service coverage. Rebuilt periodically by the
 * EnvironmentSystem; sampled by buildings, overlays and the inspector.
 */
export class EnvironmentFields {
  pollution = new Map<number, number>();
  noise = new Map<number, number>();
  landValue = new Map<number, number>();
  crime = new Map<number, number>();
  coverage = new Map<number, number>();
  /** Bumped after every rebuild (overlay cache key). */
  version = 0;

  static cellOf(worldCoord: number): number {
    return Math.floor(worldCoord / FIELD_CELL);
  }

  sample(map: Map<number, number>, x: number, z: number): number {
    return map.get(fieldKey(EnvironmentFields.cellOf(x), EnvironmentFields.cellOf(z))) ?? 0;
  }

  pollutionAt(x: number, z: number): number {
    return this.sample(this.pollution, x, z);
  }

  noiseAt(x: number, z: number): number {
    return this.sample(this.noise, x, z);
  }

  landValueAt(x: number, z: number): number {
    const key = fieldKey(EnvironmentFields.cellOf(x), EnvironmentFields.cellOf(z));
    return this.landValue.get(key) ?? 0.35;
  }

  crimeAt(x: number, z: number): number {
    return this.sample(this.crime, x, z);
  }

  coverageAt(x: number, z: number): number {
    return this.sample(this.coverage, x, z);
  }

  /** Stamp a radial falloff dome into a field. */
  static stamp(
    map: Map<number, number>,
    x: number,
    z: number,
    radius: number,
    amount: number,
  ): void {
    const c0x = EnvironmentFields.cellOf(x - radius);
    const c1x = EnvironmentFields.cellOf(x + radius);
    const c0z = EnvironmentFields.cellOf(z - radius);
    const c1z = EnvironmentFields.cellOf(z + radius);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const centerX = (cx + 0.5) * FIELD_CELL;
        const centerZ = (cz + 0.5) * FIELD_CELL;
        const d = Math.hypot(centerX - x, centerZ - z);
        if (d > radius) continue;
        const w = 1 - d / radius;
        const key = fieldKey(cx, cz);
        map.set(key, (map.get(key) ?? 0) + amount * w);
      }
    }
  }

  /** OR a coverage flag into all cells within radius. */
  static stampFlag(
    map: Map<number, number>,
    x: number,
    z: number,
    radius: number,
    flag: number,
  ): void {
    const c0x = EnvironmentFields.cellOf(x - radius);
    const c1x = EnvironmentFields.cellOf(x + radius);
    const c0z = EnvironmentFields.cellOf(z - radius);
    const c1z = EnvironmentFields.cellOf(z + radius);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const centerX = (cx + 0.5) * FIELD_CELL;
        const centerZ = (cz + 0.5) * FIELD_CELL;
        if (Math.hypot(centerX - x, centerZ - z) > radius) continue;
        const key = fieldKey(cx, cz);
        map.set(key, (map.get(key) ?? 0) | flag);
      }
    }
  }
}

export const EnvironmentToken = createToken<EnvironmentFields>('simulation.environment');
