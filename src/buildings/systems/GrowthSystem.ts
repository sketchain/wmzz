import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { createRng } from '@/terrain/createRng';
import { GROWABLES, type ZoneId } from '@/data/buildingPrototypes';
import type { BuildingFactory } from '../BuildingFactory';
import type { ZoneGrid, ZoneCell } from '../ZoneGrid';
import {
  Building,
  BuildingEcon,
  UnderConstruction,
} from '../components';

/** RCI demand in [0,1] per zone; Phase 6's economy drives the real values. */
export interface DemandProvider {
  demand(zone: Exclude<ZoneId, 0>): number;
}

/** Standalone default so zoning works before the economy exists. */
export class ConstantDemand implements DemandProvider {
  demand(): number {
    return 0.8;
  }
}

const GROWTH_INTERVAL_TICKS = 12;
const MAX_SPAWNS_PER_PASS = 6;
const VACANT_SCAN_LIMIT = 512;

/**
 * Building lifecycle driver:
 *  - develops vacant zoned lots at a rate scaled by RCI demand
 *  - counts down construction and reveals finished buildings
 *  - upgrades buildings whose `condition` stays high (the simulation phase
 *    writes condition from land value / services / utilities)
 *  - abandonment is handled by the simulation phase via the Abandoned tag
 */
export class GrowthSystem extends System {
  readonly name = 'GrowthSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 40;

  demandProvider: DemandProvider = new ConstantDemand();

  private readonly vacantScratch: ZoneCell[] = [];
  private readonly rng = createRng(0x5eed);

  constructor(
    private readonly grid: ZoneGrid,
    private readonly factory: BuildingFactory,
  ) {
    super();
  }

  update(world: World, ctx: TickContext): void {
    this.tickConstruction(world);
    if (ctx.tick % GROWTH_INTERVAL_TICKS !== 0) return;
    this.develop(world);
    this.tryUpgrades(world, ctx);
  }

  private tickConstruction(world: World): void {
    const query = world.query({ all: [Building, UnderConstruction] });
    const store = world.soa(Building);
    const ticks = store.fields.buildTicks;
    const entities = query.entities;
    const count = query.size;
    for (let i = 0; i < count; i++) {
      const entity = entities[i];
      const dense = store.denseIndexOf(entity & 0xffffff);
      if (ticks[dense] > 0) {
        ticks[dense]--;
      } else {
        world.defer(() => world.removeComponent(entity, UnderConstruction));
      }
    }
  }

  private develop(world: World): void {
    this.grid.collectVacant(VACANT_SCAN_LIMIT, this.vacantScratch);
    if (this.vacantScratch.length === 0) return;
    let spawns = 0;
    for (const cell of this.vacantScratch) {
      if (spawns >= MAX_SPAWNS_PER_PASS) break;
      const demand = this.demandProvider.demand(cell.zone as Exclude<ZoneId, 0>);
      if (this.rng() < demand * 0.5) {
        this.factory.spawnGrowable(cell);
        spawns++;
      }
    }
    void world;
  }

  private tryUpgrades(world: World, ctx: TickContext): void {
    // Throttle: examine upgrades once a second of sim time.
    if (ctx.tick % 36 !== 0) return;
    const query = world.query({ all: [Building, BuildingEcon], none: [UnderConstruction] });
    const buildings = world.soa(Building);
    const econ = world.soa(BuildingEcon);
    const entities = query.entities;
    const count = query.size;
    for (let i = 0; i < count; i++) {
      const entity = entities[i];
      const index = entity & 0xffffff;
      const b = buildings.denseIndexOf(index);
      const zone = buildings.fields.zone[b];
      if (zone === 0) continue; // services don't level
      const level = buildings.fields.level[b];
      const spec = GROWABLES[zone as Exclude<ZoneId, 0>];
      if (level >= spec.levels.length) continue;
      const e = econ.denseIndexOf(index);
      const condition = econ.fields.condition[e];
      const occupancy =
        econ.fields.capacity[e] > 0
          ? econ.fields.occupants[e] / econ.fields.capacity[e]
          : 0;
      // Upgrade needs sustained good conditions and real occupancy pressure.
      if (condition > 0.72 && occupancy > 0.85 && this.rng() < 0.3) {
        world.defer(() => this.factory.upgrade(entity));
      }
    }
  }
}
