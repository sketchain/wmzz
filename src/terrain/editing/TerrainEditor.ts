import { createToken } from '@/core/di/ServiceContainer';
import type { Command } from '@/core/commands/Command';
import { HeightField } from '../HeightField';
import { TerrainConfig } from '../TerrainConfig';
import type { TerrainService } from '../TerrainService';

export type BrushMode = 'raise' | 'lower' | 'flatten' | 'smooth' | 'paint';

interface VertexEdit {
  key: number;
  before: number | undefined;
  after: number | undefined;
}

/**
 * One completed brush stroke over the height-delta (or paint) layer.
 * Constructed retroactively when the pointer is released: the live edits
 * were already applied for immediate feedback, so the first `execute()` is
 * skipped. Consecutive strokes deliberately do NOT merge — each stroke is
 * one undo step, matching editor conventions.
 */
export class TerrainStrokeCommand implements Command {
  readonly label: string;
  private applied = true;

  constructor(
    private readonly terrain: TerrainService,
    private readonly layer: 'height' | 'paint',
    private readonly edits: VertexEdit[],
    private readonly bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
    mode: BrushMode,
  ) {
    this.label = `terrain.${mode}`;
  }

  execute(): void {
    if (this.applied) return; // live stroke already applied the edits once
    this.applyValues('after');
  }

  undo(): void {
    this.applied = false;
    this.applyValues('before');
  }

  private applyValues(which: 'before' | 'after'): void {
    const map =
      this.layer === 'height'
        ? this.terrain.field.editDeltas
        : this.terrain.field.paintLayer;
    for (const edit of this.edits) {
      const value = edit[which];
      if (value === undefined) map.delete(edit.key);
      else map.set(edit.key, value);
    }
    this.terrain.invalidateRegion(
      this.bounds.minX,
      this.bounds.minZ,
      this.bounds.maxX,
      this.bounds.maxZ,
    );
  }
}

/**
 * Applies brush dabs to the height field and records the stroke diff.
 * The system layer feeds it pointer state; it owns brush math only.
 */
export class TerrainEditor {
  mode: BrushMode = 'raise';
  radius: number = TerrainConfig.editing.defaultBrushRadius;

  private strokeBefore = new Map<number, number | undefined>();
  private strokeBounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  private strokeActive = false;
  private flattenTarget = 0;

  constructor(private readonly terrain: TerrainService) {}

  get isStroking(): boolean {
    return this.strokeActive;
  }

  beginStroke(worldX: number, worldZ: number): void {
    this.strokeActive = true;
    this.strokeBefore.clear();
    this.strokeBounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    this.flattenTarget = this.terrain.field.heightAt(worldX, worldZ);
  }

  /** Apply one dab at (x,z); dt scales strength for frame-rate independence. */
  applyDab(x: number, z: number, dt: number): void {
    if (!this.strokeActive) return;
    const field = this.terrain.field;
    const cell = TerrainConfig.cellSize;
    const radiusVerts = Math.ceil(this.radius / cell);
    const cvx = Math.round(x / cell);
    const cvz = Math.round(z / cell);
    const strength = TerrainConfig.editing.brushStrength * dt;

    const heightLayer = this.mode !== 'paint';
    const map = heightLayer ? field.editDeltas : field.paintLayer;

    // Pre-sample for smooth mode (read-before-write consistency).
    let smoothSamples: Map<number, number> | null = null;
    if (this.mode === 'smooth') {
      smoothSamples = new Map();
      for (let dz = -radiusVerts - 1; dz <= radiusVerts + 1; dz++) {
        for (let dx = -radiusVerts - 1; dx <= radiusVerts + 1; dx++) {
          const vx = cvx + dx;
          const vz = cvz + dz;
          smoothSamples.set(HeightField.vertexKey(vx, vz), field.vertexHeight(vx, vz));
        }
      }
    }

    for (let dz = -radiusVerts; dz <= radiusVerts; dz++) {
      for (let dx = -radiusVerts; dx <= radiusVerts; dx++) {
        const vx = cvx + dx;
        const vz = cvz + dz;
        const distance = Math.hypot(dx * cell, dz * cell);
        if (distance > this.radius) continue;
        const falloff = 1 - (distance / this.radius) ** 2; // smooth dome
        const key = HeightField.vertexKey(vx, vz);

        if (!this.strokeBefore.has(key)) {
          this.strokeBefore.set(key, map.get(key));
        }

        if (this.mode === 'paint') {
          map.set(key, 1);
          continue;
        }

        const currentDelta = field.editDeltas.get(key) ?? 0;
        let nextDelta = currentDelta;
        switch (this.mode) {
          case 'raise':
            nextDelta = currentDelta + strength * falloff;
            break;
          case 'lower':
            nextDelta = currentDelta - strength * falloff;
            break;
          case 'flatten': {
            const current = field.vertexHeight(vx, vz);
            const toTarget = this.flattenTarget - current;
            nextDelta = currentDelta + toTarget * Math.min(1, falloff * 6 * dt);
            break;
          }
          case 'smooth': {
            const samples = smoothSamples!;
            const center = samples.get(key)!;
            let sum = 0;
            let n = 0;
            for (let sz = -1; sz <= 1; sz++) {
              for (let sx = -1; sx <= 1; sx++) {
                const value = samples.get(HeightField.vertexKey(vx + sx, vz + sz));
                if (value !== undefined) {
                  sum += value;
                  n++;
                }
              }
            }
            const blurred = sum / n;
            nextDelta = currentDelta + (blurred - center) * Math.min(1, falloff * 8 * dt);
            break;
          }
        }
        if (nextDelta === 0) field.editDeltas.delete(key);
        else field.editDeltas.set(key, nextDelta);
      }
    }

    const reach = radiusVerts * cell + cell;
    this.strokeBounds.minX = Math.min(this.strokeBounds.minX, x - reach);
    this.strokeBounds.minZ = Math.min(this.strokeBounds.minZ, z - reach);
    this.strokeBounds.maxX = Math.max(this.strokeBounds.maxX, x + reach);
    this.strokeBounds.maxZ = Math.max(this.strokeBounds.maxZ, z + reach);
    this.terrain.invalidateRegion(x - reach, z - reach, x + reach, z + reach);
  }

  /** Close the stroke and produce its undo command (null if nothing changed). */
  endStroke(): TerrainStrokeCommand | null {
    if (!this.strokeActive) return null;
    this.strokeActive = false;
    if (this.strokeBefore.size === 0) return null;

    const heightLayer = this.mode !== 'paint';
    const map = heightLayer
      ? this.terrain.field.editDeltas
      : this.terrain.field.paintLayer;
    const edits: VertexEdit[] = [];
    for (const [key, before] of this.strokeBefore) {
      const after = map.get(key);
      if (before !== after) edits.push({ key, before, after });
    }
    this.strokeBefore.clear();
    if (edits.length === 0) return null;
    return new TerrainStrokeCommand(
      this.terrain,
      heightLayer ? 'height' : 'paint',
      edits,
      { ...this.strokeBounds },
      this.mode,
    );
  }
}

export const TerrainEditorToken = createToken<TerrainEditor>('terrain.editor');
