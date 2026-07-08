import * as THREE from 'three';
import type { RendererService } from '@/engine/renderer/RendererService';
import type { TerrainService } from '@/terrain/TerrainService';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import type { EnvironmentFields } from '@/simulation/EnvironmentFields';
import { FIELD_CELL } from '@/simulation/EnvironmentFields';
import { PowerShortage, WaterShortage, Building } from '@/buildings/components';
import { Transform } from '@/engine/components';
import type { World } from '@/core/ecs';

export type OverlayMode =
  | 'none'
  | 'traffic'
  | 'pollution'
  | 'landValue'
  | 'crime'
  | 'power'
  | 'water';

const REFRESH_MS = 1500;

/**
 * Data overlays drawn as a rebuilt triangle-soup mesh:
 *  - field modes color the 32 m environment grid (pollution red, land value
 *    green→gold, crime purple)
 *  - traffic colors a ribbon over every road edge green→red by congestion
 *  - power/water flag buildings in shortage with red markers
 * Rebuilding a few thousand quads every 1.5 s is far cheaper than keeping
 * per-cell instances resident; the mesh disappears entirely in mode 'none'.
 */
export class OverlayRenderer {
  private mode: OverlayMode = 'none';
  private mesh: THREE.Mesh | null = null;
  private readonly material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  private lastRefresh = 0;

  constructor(
    private readonly renderer: RendererService,
    private readonly terrain: TerrainService,
    private readonly roads: RoadNetwork,
    private readonly fields: EnvironmentFields,
    private readonly world: World,
  ) {}

  setMode(mode: OverlayMode): void {
    this.mode = mode;
    this.lastRefresh = 0;
    if (mode === 'none') this.clearMesh();
  }

  get currentMode(): OverlayMode {
    return this.mode;
  }

  update(now: number): void {
    if (this.mode === 'none') return;
    if (now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    this.rebuild();
  }

  private rebuild(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();

    const quad = (x: number, z: number, size: number, lift: number): void => {
      const h = size / 2;
      const y00 = this.terrain.heightAt(x - h, z - h) + lift;
      const y10 = this.terrain.heightAt(x + h, z - h) + lift;
      const y01 = this.terrain.heightAt(x - h, z + h) + lift;
      const y11 = this.terrain.heightAt(x + h, z + h) + lift;
      positions.push(
        x - h, y00, z - h,  x - h, y01, z + h,  x + h, y11, z + h,
        x - h, y00, z - h,  x + h, y11, z + h,  x + h, y10, z - h,
      );
      for (let i = 0; i < 6; i++) colors.push(color.r, color.g, color.b);
    };

    if (this.mode === 'traffic') {
      for (const edge of this.roads.edges.values()) {
        const level = Math.min(1, (edge.congestion - 1) / 3);
        color.setHSL((1 - level) * 0.33, 0.9, 0.5); // green → red
        const pts = edge.points;
        for (let i = 0; i + 3 < pts.length; i += 3) {
          const ax = pts[i];
          const ay = pts[i + 1] + 0.6;
          const az = pts[i + 2];
          const bx = pts[i + 3];
          const by = pts[i + 4] + 0.6;
          const bz = pts[i + 5];
          let dx = bx - ax;
          let dz = bz - az;
          const len = Math.hypot(dx, dz) || 1;
          dx /= len;
          dz /= len;
          const w = 2.2;
          positions.push(
            ax - dz * w, ay, az + dx * w,  ax + dz * w, ay, az - dx * w,  bx + dz * w, by, bz - dx * w,
            ax - dz * w, ay, az + dx * w,  bx + dz * w, by, bz - dx * w,  bx - dz * w, by, bz + dx * w,
          );
          for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b);
        }
      }
    } else if (this.mode === 'power' || this.mode === 'water') {
      const tag = this.mode === 'power' ? PowerShortage : WaterShortage;
      const query = this.world.query({ all: [Building, Transform] });
      const transforms = this.world.soa(Transform);
      query.forEach((entity) => {
        const t = transforms.denseIndexOf(entity & 0xffffff);
        const shortage = this.world.hasComponent(entity, tag);
        color.setHex(shortage ? 0xe04a3a : 0x3ac06a);
        quad(transforms.fields.x[t], transforms.fields.z[t], 9, 1.2);
      });
    } else {
      const map =
        this.mode === 'pollution'
          ? this.fields.pollution
          : this.mode === 'crime'
            ? this.fields.crime
            : this.fields.landValue;
      for (const [key, rawValue] of map) {
        const cx = ((key >>> 16) & 0xffff) - 0x8000;
        const cz = (key & 0xffff) - 0x8000;
        const x = (cx + 0.5) * FIELD_CELL;
        const z = (cz + 0.5) * FIELD_CELL;
        if (this.mode === 'pollution') {
          const v = Math.min(1, rawValue);
          if (v < 0.05) continue;
          color.setRGB(0.7 * v + 0.2, 0.15, 0.1);
        } else if (this.mode === 'crime') {
          const v = Math.min(1, rawValue);
          if (v < 0.05) continue;
          color.setRGB(0.5 * v + 0.2, 0.1, 0.6 * v + 0.2);
        } else {
          color.setHSL(0.25, 0.75, 0.25 + Math.min(1, rawValue) * 0.4);
        }
        quad(x, z, FIELD_CELL - 1, 0.5);
      }
    }

    this.clearMesh();
    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 3;
    this.renderer.scene.add(this.mesh);
  }

  private clearMesh(): void {
    if (this.mesh) {
      this.renderer.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }

  dispose(): void {
    this.clearMesh();
    this.material.dispose();
  }
}
