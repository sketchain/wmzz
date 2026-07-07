import { createToken } from '@/core/di/ServiceContainer';
import { NULL_ENTITY, type Entity, type World } from '@/core/ecs';
import { Transform } from '@/engine/components';
import type { TerrainService } from '@/terrain/TerrainService';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import {
  GROWABLES,
  SERVICES,
  SERVICE_ORDER,
  ZONE_LABELS,
  type ServiceKind,
  type ZoneId,
} from '@/data/buildingPrototypes';
import {
  Building,
  BuildingEcon,
  BuildingMeta,
  ServiceBuilding,
  UnderConstruction,
} from './components';
import { ZoneGrid, type ZoneCell } from './ZoneGrid';

export const CONSTRUCTION_TICKS = 90; // 3 s of sim at 30 Hz per level-1 build

/**
 * Factory (and single owner) of building entity assembly. Every spawn path
 * — zone growth, service placement, save loading — goes through here so
 * component composition stays consistent.
 */
export class BuildingFactory {
  /** Bumped whenever the building set changes (render cache key). */
  version = 0;

  constructor(
    private readonly world: World,
    private readonly zoneGrid: ZoneGrid,
    private readonly terrain: TerrainService,
    private readonly roads: RoadNetwork,
  ) {}

  /** Spawn a level-1 growable on a vacant zoned cell, facing its road. */
  spawnGrowable(cell: ZoneCell): Entity {
    const spec = GROWABLES[cell.zone as Exclude<ZoneId, 0>];
    const level = spec.levels[0];
    const x = ZoneGrid.cellCenter(cell.cx);
    const z = ZoneGrid.cellCenter(cell.cz);
    const y = this.terrain.heightAt(x, z);
    const rotation = this.facingRotation(x, z, cell.edgeId);

    const entity = this.world.createEntity();
    this.world.addComponent(entity, Transform, { x, y, z, rot: rotation, scale: 1 });
    this.world.addComponent(entity, Building, {
      zone: cell.zone,
      level: 1,
      cellX: cell.cx,
      cellZ: cell.cz,
      edgeId: cell.edgeId,
      buildTicks: CONSTRUCTION_TICKS,
    });
    this.world.addComponent(entity, BuildingEcon, {
      capacity: level.capacity,
      occupants: 0,
      taxBase: level.tax,
      powerDemand: level.power,
      waterDemand: level.water,
      landValue: 0.4,
      pollution: spec.pollution,
      noise: spec.noise,
      condition: 0.6,
    });
    this.world.addComponent(entity, BuildingMeta, {
      name: `${ZONE_LABELS[cell.zone]} · L1`,
    });
    this.world.addComponent(entity, UnderConstruction);
    this.zoneGrid.setBuilding(cell.cx, cell.cz, entity);
    this.version++;
    return entity;
  }

  /** Place a service building at a world position. */
  spawnService(kind: ServiceKind, x: number, z: number, rotation: number): Entity {
    const spec = SERVICES[kind];
    const y = this.terrain.heightAt(x, z);
    const entity = this.world.createEntity();
    this.world.addComponent(entity, Transform, { x, y, z, rot: rotation, scale: 1 });
    this.world.addComponent(entity, Building, {
      zone: 0,
      level: 1,
      cellX: ZoneGrid.worldToCell(x),
      cellZ: ZoneGrid.worldToCell(z),
      edgeId: this.roads.snapEdge(x, z, 40)?.edge.id ?? 0,
      buildTicks: CONSTRUCTION_TICKS,
    });
    this.world.addComponent(entity, ServiceBuilding, {
      serviceIndex: SERVICE_ORDER.indexOf(kind),
      radius: spec.radius,
      jobs: spec.jobs,
      upkeep: spec.upkeep,
      power: spec.power,
      water: spec.water,
    });
    this.world.addComponent(entity, BuildingMeta, { name: spec.label });
    this.world.addComponent(entity, UnderConstruction);
    this.version++;
    return entity;
  }

  /** Remove any building entity, releasing its zone cell. */
  demolish(entity: Entity): boolean {
    const building = this.world.read(entity, Building);
    if (!building) return false;
    const cell = this.zoneGrid.cellAt(building.cellX, building.cellZ);
    if (cell && cell.building === entity) {
      this.zoneGrid.clearBuilding(building.cellX, building.cellZ);
    }
    this.world.destroyEntity(entity);
    this.version++;
    return true;
  }

  /** Upgrade a growable one level in place. */
  upgrade(entity: Entity): boolean {
    const building = this.world.read(entity, Building);
    if (!building || building.zone === 0) return false;
    const spec = GROWABLES[building.zone as Exclude<ZoneId, 0>];
    const nextLevel = building.level + 1;
    if (nextLevel > spec.levels.length) return false;
    const levelSpec = spec.levels[nextLevel - 1];
    this.world.write(entity, Building, {
      level: nextLevel,
      buildTicks: CONSTRUCTION_TICKS,
    });
    this.world.write(entity, BuildingEcon, {
      capacity: levelSpec.capacity,
      taxBase: levelSpec.tax,
      powerDemand: levelSpec.power,
      waterDemand: levelSpec.water,
    });
    const meta = this.world.getObject(entity, BuildingMeta);
    if (meta) meta.name = `${ZONE_LABELS[building.zone as ZoneId]} · L${nextLevel}`;
    this.world.addComponent(entity, UnderConstruction);
    this.version++;
    return true;
  }

  /** Buildings face the road they front. */
  private facingRotation(x: number, z: number, edgeId: number): number {
    const edge = this.roads.edges.get(edgeId);
    if (!edge) return 0;
    const pts = edge.points;
    let bestD2 = Infinity;
    let bx = x;
    let bz = z;
    for (let i = 0; i < pts.length; i += 3) {
      const d2 = (pts[i] - x) ** 2 + (pts[i + 2] - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bx = pts[i];
        bz = pts[i + 2];
      }
    }
    return Math.atan2(bx - x, bz - z);
  }
}

export const BuildingFactoryToken = createToken<BuildingFactory>('buildings.factory');
export { NULL_ENTITY };
