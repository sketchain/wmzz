import * as THREE from 'three';
import type { RendererService } from '@/engine/renderer/RendererService';
import type { TerrainService } from '@/terrain/TerrainService';
import { ZONE_CELL_SIZE, type ZoneGrid } from './ZoneGrid';
import type { ZoneId } from '@/data/buildingPrototypes';

const ZONE_COLORS: Record<Exclude<ZoneId, 0>, THREE.Color> = {
  1: new THREE.Color(0x3fae53),
  2: new THREE.Color(0x3f7fd8),
  3: new THREE.Color(0xd8a03f),
  4: new THREE.Color(0x3fc8c0),
};

const MAX_CELLS = 16384;

/**
 * Translucent per-cell quads showing painted zones while a zoning tool is
 * active. One InstancedMesh; rebuilt only when the grid version changes.
 */
export class ZoneOverlay {
  private readonly mesh: THREE.InstancedMesh;
  private lastVersion = -1;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  visible = false;

  constructor(
    private readonly renderer: RendererService,
    private readonly grid: ZoneGrid,
    private readonly terrain: TerrainService,
  ) {
    const geometry = new THREE.PlaneGeometry(ZONE_CELL_SIZE - 0.6, ZONE_CELL_SIZE - 0.6);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_CELLS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    renderer.scene.add(this.mesh);
  }

  update(): void {
    this.mesh.visible = this.visible;
    if (!this.visible) return;
    if (this.grid.version === this.lastVersion) return;
    this.lastVersion = this.grid.version;

    let at = 0;
    for (const cell of this.grid.cells.values()) {
      if (at >= MAX_CELLS) break;
      if (cell.zone === 0) continue;
      const x = (cell.cx + 0.5) * ZONE_CELL_SIZE;
      const z = (cell.cz + 0.5) * ZONE_CELL_SIZE;
      const y = this.terrain.heightAt(x, z) + 0.25;
      this.matrix.makeTranslation(x, y, z);
      this.mesh.setMatrixAt(at, this.matrix);
      this.color.copy(ZONE_COLORS[cell.zone as Exclude<ZoneId, 0>]);
      this.mesh.setColorAt(at, this.color);
      at++;
    }
    this.mesh.count = at;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Force refresh next update (e.g. after tool toggles). */
  invalidate(): void {
    this.lastVersion = -1;
  }

  dispose(): void {
    this.renderer.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
