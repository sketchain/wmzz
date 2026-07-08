import type { CameraRig } from '@/engine/camera/CameraRig';
import type { TerrainService } from '@/terrain/TerrainService';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import type { World } from '@/core/ecs';
import { Building } from '@/buildings/components';
import { Transform } from '@/engine/components';
import { TerrainConfig } from '@/terrain/TerrainConfig';
import { el, type UiShell } from '../UiShell';

const SIZE = 176;
const WORLD_HALF = 900; // minimap covers ±900 m around the camera target
const REFRESH_MS = 2000;

/**
 * Canvas minimap: terrain tint, water, roads, building dots and the camera
 * target crosshair. Click to jump the camera. Redrawn every 2 s around the
 * current view center so it works on the infinite map.
 */
export class MiniMap {
  private readonly canvas: HTMLCanvasElement;
  private lastDraw = 0;
  private centerX = 0;
  private centerZ = 0;

  constructor(
    shell: UiShell,
    private readonly terrain: TerrainService,
    private readonly roads: RoadNetwork,
    private readonly world: World,
    private readonly rig: CameraRig,
  ) {
    const panel = el('div', 'wui-minimap wui-panel');
    this.canvas = el('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    panel.appendChild(this.canvas);
    shell.root.appendChild(panel);

    this.canvas.addEventListener('click', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const worldX = this.centerX + ((mx / SIZE) * 2 - 1) * WORLD_HALF;
      const worldZ = this.centerZ + ((my / SIZE) * 2 - 1) * WORLD_HALF;
      this.rig.jumpTo(worldX, worldZ);
    });
  }

  refresh(now: number): void {
    if (now - this.lastDraw < REFRESH_MS) return;
    this.lastDraw = now;
    this.centerX = this.rig.target.x;
    this.centerZ = this.rig.target.z;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const toMapX = (x: number): number => ((x - this.centerX) / WORLD_HALF / 2 + 0.5) * SIZE;
    const toMapZ = (z: number): number => ((z - this.centerZ) / WORLD_HALF / 2 + 0.5) * SIZE;

    // Terrain tint (coarse sampling).
    const cells = 44;
    const cellPx = SIZE / cells;
    for (let gz = 0; gz < cells; gz++) {
      for (let gx = 0; gx < cells; gx++) {
        const worldX = this.centerX + ((gx + 0.5) / cells - 0.5) * WORLD_HALF * 2;
        const worldZ = this.centerZ + ((gz + 0.5) / cells - 0.5) * WORLD_HALF * 2;
        const height = this.terrain.heightAt(worldX, worldZ);
        if (height < TerrainConfig.seaLevel) {
          ctx.fillStyle = '#2d5f8a';
        } else if (height > 60) {
          ctx.fillStyle = '#8a8378';
        } else {
          const t = Math.min(1, (height - TerrainConfig.seaLevel) / 40);
          ctx.fillStyle = `rgb(${70 + t * 60}, ${120 - t * 30}, ${60})`;
        }
        ctx.fillRect(gx * cellPx, gz * cellPx, cellPx + 1, cellPx + 1);
      }
    }

    // Roads.
    ctx.strokeStyle = '#c9c9c4';
    ctx.lineWidth = 1.2;
    for (const edge of this.roads.edges.values()) {
      const pts = edge.points;
      ctx.beginPath();
      ctx.moveTo(toMapX(pts[0]), toMapZ(pts[2]));
      for (let i = 3; i < pts.length; i += 3) {
        ctx.lineTo(toMapX(pts[i]), toMapZ(pts[i + 2]));
      }
      ctx.stroke();
    }

    // Buildings.
    const transforms = this.world.soa(Transform);
    const query = this.world.query({ all: [Building, Transform] });
    ctx.fillStyle = '#e8d8a0';
    query.forEach((entity) => {
      const t = transforms.denseIndexOf(entity & 0xffffff);
      ctx.fillRect(
        toMapX(transforms.fields.x[t]) - 1,
        toMapZ(transforms.fields.z[t]) - 1,
        2,
        2,
      );
    });

    // Camera crosshair.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(SIZE / 2 - 4, SIZE / 2 - 4, 8, 8);
  }
}
