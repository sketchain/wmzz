import * as THREE from 'three';
import { createToken } from '@/core/di/ServiceContainer';
import { SimplexNoise2D } from './noise/SimplexNoise';
import { TerrainConfig } from './TerrainConfig';

/**
 * The single source of truth for terrain height and surface paint.
 *
 * height(x,z) = procedural base (deterministic from seed) + sparse edit
 * deltas keyed by vertex. The base function synthesizes plains, ridged
 * mountain chains, a coastline (west), carved rivers and lake basins from
 * independent noise channels; player edits never touch the base, so saves
 * only need the sparse delta map (tiny) plus the seed.
 */
export class HeightField {
  private readonly continentNoise: SimplexNoise2D;
  private readonly mountainNoise: SimplexNoise2D;
  private readonly detailNoise: SimplexNoise2D;
  private readonly riverNoise: SimplexNoise2D;
  private readonly lakeNoise: SimplexNoise2D;
  private readonly forestNoise: SimplexNoise2D;

  /** vertexKey -> height delta (player edits). */
  readonly editDeltas = new Map<number, number>();
  /** vertexKey -> paint id (0 none, 1 dirt, 2 pavement). */
  readonly paintLayer = new Map<number, number>();

  constructor(readonly seed: number = TerrainConfig.seed) {
    this.continentNoise = new SimplexNoise2D(seed);
    this.mountainNoise = new SimplexNoise2D(seed + 101);
    this.detailNoise = new SimplexNoise2D(seed + 202);
    this.riverNoise = new SimplexNoise2D(seed + 303);
    this.lakeNoise = new SimplexNoise2D(seed + 404);
    this.forestNoise = new SimplexNoise2D(seed + 505);
  }

  /** Pack signed vertex-grid coords (±32k verts ≈ ±65 km) into a map key. */
  static vertexKey(vx: number, vz: number): number {
    return ((vx + 0x8000) << 16) | ((vz + 0x8000) & 0xffff);
  }

  /** Procedural base height in meters at world position. */
  baseHeight(x: number, z: number): number {
    const sea = TerrainConfig.seaLevel;

    // Continent mass: slow falloff toward the west creates a coastline.
    const continent = this.continentNoise.fbm(x * 0.0009, z * 0.0009, 4);
    let height = sea + 8 + continent * 14 + (x + 600) * 0.012;

    // Mountain chains where the ridged mask is strong.
    const mountainMask = this.mountainNoise.fbm(x * 0.0006 + 40, z * 0.0006 - 25, 3);
    if (mountainMask > 0.05) {
      const ridge = this.mountainNoise.ridged(x * 0.004, z * 0.004, 5);
      height += (mountainMask - 0.05) * ridge * 130;
    }

    // Rolling detail everywhere.
    height += this.detailNoise.fbm(x * 0.02, z * 0.02, 4) * 2.2;

    // Rivers: carve where a low-frequency channel crosses zero.
    const river = this.riverNoise.fbm(x * 0.0016, z * 0.0016, 3);
    const riverDist = Math.abs(river);
    if (riverDist < 0.07) {
      const depth = (1 - riverDist / 0.07) ** 2 * 11;
      height = Math.min(height, Math.max(height - depth, sea - 6));
    }

    // Lake basins: deep lows of an independent channel.
    const lake = this.lakeNoise.fbm(x * 0.0011 - 77, z * 0.0011 + 33, 3);
    if (lake < -0.42) {
      const t = Math.min(1, (-0.42 - lake) / 0.18);
      height = Math.min(height, sea + 3 - t * 8);
    }

    return height;
  }

  /** Effective height (base + edits) at exact vertex coordinates. */
  vertexHeight(vx: number, vz: number): number {
    const cell = TerrainConfig.cellSize;
    let height = this.baseHeight(vx * cell, vz * cell);
    const delta = this.editDeltas.get(HeightField.vertexKey(vx, vz));
    if (delta !== undefined) height += delta;
    return height;
  }

  /** Bilinear-interpolated height at any world position. */
  heightAt(x: number, z: number): number {
    const cell = TerrainConfig.cellSize;
    const fx = x / cell;
    const fz = z / cell;
    const vx = Math.floor(fx);
    const vz = Math.floor(fz);
    const tx = fx - vx;
    const tz = fz - vz;
    const h00 = this.vertexHeight(vx, vz);
    const h10 = this.vertexHeight(vx + 1, vz);
    const h01 = this.vertexHeight(vx, vz + 1);
    const h11 = this.vertexHeight(vx + 1, vz + 1);
    return (
      h00 * (1 - tx) * (1 - tz) +
      h10 * tx * (1 - tz) +
      h01 * (1 - tx) * tz +
      h11 * tx * tz
    );
  }

  /** Surface normal from central differences. */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const eps = TerrainConfig.cellSize;
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    return out.set(hL - hR, 2 * eps, hD - hU).normalize();
  }

  /** Slope magnitude (rise over run) at world position. */
  slopeAt(x: number, z: number): number {
    const eps = TerrainConfig.cellSize;
    const dx = (this.heightAt(x + eps, z) - this.heightAt(x - eps, z)) / (2 * eps);
    const dz = (this.heightAt(x, z + eps) - this.heightAt(x, z - eps)) / (2 * eps);
    return Math.hypot(dx, dz);
  }

  paintAt(vx: number, vz: number): number {
    return this.paintLayer.get(HeightField.vertexKey(vx, vz)) ?? 0;
  }

  /** Forest density in [0,1] used by tree scatter and (later) land value. */
  forestDensity(x: number, z: number): number {
    return this.forestNoise.fbm(x * 0.004 + 9, z * 0.004 - 4, 3) * 0.5 + 0.5;
  }

  /**
   * Ray → heightfield intersection by fixed-step march + bisection refine.
   * Good enough for picking (sub-centimeter after refinement).
   */
  raycast(ray: THREE.Ray, out: THREE.Vector3, maxDistance = 3000): boolean {
    const step = TerrainConfig.cellSize;
    const pos = new THREE.Vector3();
    let prevT = 0;
    for (let t = 0; t <= maxDistance; t += step) {
      pos.copy(ray.origin).addScaledVector(ray.direction, t);
      const above = pos.y > this.heightAt(pos.x, pos.z);
      if (!above) {
        if (t === 0) return false;
        // Bisect between prevT (above) and t (below).
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) * 0.5;
          pos.copy(ray.origin).addScaledVector(ray.direction, mid);
          if (pos.y > this.heightAt(pos.x, pos.z)) lo = mid;
          else hi = mid;
        }
        pos.copy(ray.origin).addScaledVector(ray.direction, (lo + hi) * 0.5);
        out.set(pos.x, this.heightAt(pos.x, pos.z), pos.z);
        return true;
      }
      prevT = t;
    }
    return false;
  }
}

export const HeightFieldToken = createToken<HeightField>('terrain.heightField');
