import { createToken } from '@/core/di/ServiceContainer';
import type { Entity } from '@/core/ecs';
import { NULL_ENTITY } from '@/core/ecs';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import { ROAD_PROFILES } from '@/roads/RoadTypes';
import { ZONE_NONE, type ZoneId } from '@/data/buildingPrototypes';

export const ZONE_CELL_SIZE = 8;
/** Cells must lie within this distance of a zoneable road. */
export const ZONE_ROAD_REACH = 28;

export interface ZoneCell {
  cx: number;
  cz: number;
  zone: ZoneId;
  /** Road edge the lot fronts. */
  edgeId: number;
  /** Occupying building entity, or NULL_ENTITY. */
  building: Entity;
}

export function cellKey(cx: number, cz: number): number {
  return ((cx + 0x8000) << 16) | ((cz + 0x8000) & 0xffff);
}

export function cellKeyX(key: number): number {
  return ((key >>> 16) & 0xffff) - 0x8000;
}

export function cellKeyZ(key: number): number {
  return (key & 0xffff) - 0x8000;
}

/**
 * Sparse zoning grid (8 m cells). Cells exist only where painted. The
 * growth system consumes `vacantCells`; a cell is vacant when zoned,
 * road-adjacent and unoccupied.
 */
export class ZoneGrid {
  readonly cells = new Map<number, ZoneCell>();
  /** Bumped on any zoning change (overlay/renderer cache key). */
  version = 0;

  constructor(private readonly roads: RoadNetwork) {}

  cellAt(cx: number, cz: number): ZoneCell | undefined {
    return this.cells.get(cellKey(cx, cz));
  }

  static worldToCell(x: number): number {
    return Math.floor(x / ZONE_CELL_SIZE);
  }

  static cellCenter(c: number): number {
    return (c + 0.5) * ZONE_CELL_SIZE;
  }

  /**
   * Paint one cell. Returns the previous zone (for undo) or null when the
   * paint was rejected (no zoneable road in reach, or occupied on erase
   * conflict). Painting ZONE_NONE erases.
   */
  paint(cx: number, cz: number, zone: ZoneId): { previous: ZoneId } | null {
    const key = cellKey(cx, cz);
    const existing = this.cells.get(key);
    if (zone === ZONE_NONE) {
      if (!existing || existing.building !== NULL_ENTITY) return null;
      this.cells.delete(key);
      this.version++;
      return { previous: existing.zone };
    }
    if (existing) {
      if (existing.zone === zone) return null;
      if (existing.building !== NULL_ENTITY) return null; // rezone requires bulldoze
      const previous = existing.zone;
      existing.zone = zone;
      this.version++;
      return { previous };
    }
    const x = ZoneGrid.cellCenter(cx);
    const z = ZoneGrid.cellCenter(cz);
    const snap = this.roads.snapEdge(x, z, ZONE_ROAD_REACH);
    if (!snap || !ROAD_PROFILES[snap.edge.kind].zoneable) return null;
    this.cells.set(key, {
      cx,
      cz,
      zone,
      edgeId: snap.edge.id,
      building: NULL_ENTITY,
    });
    this.version++;
    return { previous: ZONE_NONE };
  }

  /** Restore a cell to an exact prior state (undo path). */
  restore(cx: number, cz: number, zone: ZoneId): void {
    const key = cellKey(cx, cz);
    if (zone === ZONE_NONE) {
      this.cells.delete(key);
    } else {
      const existing = this.cells.get(key);
      if (existing) {
        existing.zone = zone;
      } else {
        const x = ZoneGrid.cellCenter(cx);
        const z = ZoneGrid.cellCenter(cz);
        const snap = this.roads.snapEdge(x, z, ZONE_ROAD_REACH);
        this.cells.set(key, {
          cx,
          cz,
          zone,
          edgeId: snap?.edge.id ?? 0,
          building: NULL_ENTITY,
        });
      }
    }
    this.version++;
  }

  setBuilding(cx: number, cz: number, entity: Entity): void {
    const cell = this.cells.get(cellKey(cx, cz));
    if (cell) {
      cell.building = entity;
      this.version++;
    }
  }

  clearBuilding(cx: number, cz: number): void {
    const cell = this.cells.get(cellKey(cx, cz));
    if (cell) {
      cell.building = NULL_ENTITY;
      this.version++;
    }
  }

  /** Persistence: cells without their building links (relinked on load). */
  serialize(): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const cell of this.cells.values()) {
      out.push([cell.cx, cell.cz, cell.zone, cell.edgeId]);
    }
    return out;
  }

  deserialize(cells: [number, number, number, number][]): void {
    this.cells.clear();
    for (const [cx, cz, zone, edgeId] of cells) {
      this.cells.set(cellKey(cx, cz), {
        cx,
        cz,
        zone: zone as ZoneId,
        edgeId,
        building: NULL_ENTITY,
      });
    }
    this.version++;
  }

  /** Sample up to `max` vacant zoned cells (deterministic order). */
  collectVacant(max: number, out: ZoneCell[]): void {
    out.length = 0;
    for (const cell of this.cells.values()) {
      if (cell.building === NULL_ENTITY && cell.zone !== ZONE_NONE) {
        // Cells whose road vanished stop growing.
        if (!this.roads.edges.has(cell.edgeId)) {
          const x = ZoneGrid.cellCenter(cell.cx);
          const z = ZoneGrid.cellCenter(cell.cz);
          const snap = this.roads.snapEdge(x, z, ZONE_ROAD_REACH);
          if (!snap) continue;
          cell.edgeId = snap.edge.id;
        }
        out.push(cell);
        if (out.length >= max) return;
      }
    }
  }
}

export const ZoneGridToken = createToken<ZoneGrid>('buildings.zoneGrid');
