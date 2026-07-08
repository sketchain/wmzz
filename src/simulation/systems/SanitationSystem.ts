import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { SERVICE_ORDER, SERVICES } from '@/data/buildingPrototypes';
import {
  BuildingEcon,
  ServiceBuilding,
  UnderConstruction,
} from '@/buildings/components';
import type { CityStats } from '../CityStats';

const INTERVAL = 90;
const PHASE = 59;
/** Garbage units produced per occupant per pass. */
const GARBAGE_PER_OCCUPANT = 0.05;

/**
 * Garbage flow: occupants produce, landfills process. Accumulated backlog
 * beyond capacity degrades building condition via the garbage penalty in
 * EnvironmentSystem — visible as unhappiness before it becomes abandonment.
 */
export class SanitationSystem extends System {
  readonly name = 'SanitationSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 25;

  constructor(private readonly stats: CityStats) {
    super();
  }

  update(world: World, ctx: TickContext): void {
    if (ctx.tick % INTERVAL !== PHASE % INTERVAL) return;

    const econ = world.soa(BuildingEcon);
    const query = world.query({ all: [BuildingEcon], none: [UnderConstruction] });
    let produced = 0;
    const entities = query.entities;
    for (let i = 0; i < query.size; i++) {
      const e = econ.denseIndexOf(entities[i] & 0xffffff);
      produced += econ.fields.occupants[e] * GARBAGE_PER_OCCUPANT;
    }

    const services = world.soa(ServiceBuilding);
    const landfills = world.query({ all: [ServiceBuilding], none: [UnderConstruction] });
    let capacity = 0;
    const landfillEntities = landfills.entities;
    for (let i = 0; i < landfills.size; i++) {
      const s = services.denseIndexOf(landfillEntities[i] & 0xffffff);
      const spec = SERVICES[SERVICE_ORDER[services.fields.serviceIndex[s]]];
      if (spec.garbage) capacity += spec.garbage / 10; // per-pass processing
    }

    this.stats.garbageCapacity = capacity;
    this.stats.garbageAccumulated = Math.max(
      0,
      this.stats.garbageAccumulated + produced - capacity,
    );
  }
}
