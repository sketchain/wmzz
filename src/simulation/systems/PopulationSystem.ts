import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { Transform } from '@/engine/components';
import { createRng } from '@/terrain/createRng';
import {
  ZONE_COMMERCIAL,
  ZONE_INDUSTRIAL,
  ZONE_OFFICE,
  ZONE_RESIDENTIAL,
} from '@/data/buildingPrototypes';
import {
  Abandoned,
  Building,
  BuildingEcon,
  ServiceBuilding,
  UnderConstruction,
} from '@/buildings/components';
import type { CityStats } from '../CityStats';
import {
  COVER_HOSPITAL,
  COVER_SCHOOL,
  COVER_POLICE,
  EnvironmentFields,
} from '../EnvironmentFields';

const INTERVAL = 60; // 2 s of sim
const PHASE = 47;
/** Fraction of the population that seeks work. */
const WORKFORCE_RATIO = 0.52;

/**
 * Demographics + wellbeing:
 *  - move-ins fill residential capacity at a rate driven by demand and each
 *    building's condition; poor conditions cause move-outs and eventually
 *    the Abandoned tag (recovering conditions lift it)
 *  - workers spread across commercial/industrial/office jobs; unemployment
 *    feeds back into demand (EconomySystem) and happiness
 *  - education/health/safety are the population-weighted coverage of
 *    schools/hospitals/police around homes
 *  - happiness composites utilities, wellbeing, environment and tax level
 */
export class PopulationSystem extends System {
  readonly name = 'PopulationSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 20;

  private readonly rng = createRng(0x9091);

  constructor(
    private readonly stats: CityStats,
    private readonly fields: EnvironmentFields,
  ) {
    super();
  }

  update(world: World, ctx: TickContext): void {
    if (ctx.tick % INTERVAL !== PHASE % INTERVAL) return;

    const buildings = world.soa(Building);
    const econ = world.soa(BuildingEcon);
    const transforms = world.soa(Transform);
    const query = world.query({
      all: [Building, BuildingEcon, Transform],
      none: [UnderConstruction],
    });

    let population = 0;
    let households = 0;
    let resCapacity = 0;
    let jobCapacity = 0;
    let educated = 0;
    let healthy = 0;
    let safe = 0;

    const jobBuildings: { e: number; capacity: number }[] = [];

    const entities = query.entities;
    for (let i = 0; i < query.size; i++) {
      const entity = entities[i];
      const index = entity & 0xffffff;
      const b = buildings.denseIndexOf(index);
      const e = econ.denseIndexOf(index);
      const zone = buildings.fields.zone[b];
      const capacity = econ.fields.capacity[e];
      const condition = econ.fields.condition[e];
      const abandoned = world.hasComponent(entity, Abandoned);

      if (zone === ZONE_RESIDENTIAL) {
        let occupants = econ.fields.occupants[e];
        if (!abandoned) {
          const demandPull = this.stats.demandResidential;
          if (condition > 0.3 && occupants < capacity) {
            const rate = Math.max(1, Math.round(capacity * 0.12 * demandPull * (condition + 0.3)));
            occupants = Math.min(capacity, occupants + rate);
          } else if (condition < 0.25 && occupants > 0) {
            occupants = Math.max(0, occupants - Math.max(1, Math.round(capacity * 0.15)));
          }
          // Sustained bad conditions abandon the building.
          if (condition < 0.15 && occupants === 0 && this.rng() < 0.35) {
            world.defer(() => world.addComponent(entity, Abandoned));
          }
        } else {
          occupants = 0;
          if (condition > 0.4 && this.rng() < 0.25) {
            world.defer(() => world.removeComponent(entity, Abandoned));
          }
        }
        econ.fields.occupants[e] = occupants;
        population += occupants;
        if (occupants > 0) households++;
        resCapacity += capacity;

        if (occupants > 0) {
          const t = transforms.denseIndexOf(index);
          const coverage = this.fields.coverageAt(
            transforms.fields.x[t],
            transforms.fields.z[t],
          );
          if (coverage & COVER_SCHOOL) educated += occupants;
          if (coverage & COVER_HOSPITAL) healthy += occupants;
          if (coverage & COVER_POLICE) safe += occupants;
        }
      } else if (
        zone === ZONE_COMMERCIAL ||
        zone === ZONE_INDUSTRIAL ||
        zone === ZONE_OFFICE
      ) {
        if (!abandoned) {
          jobCapacity += capacity;
          jobBuildings.push({ e, capacity });
        } else {
          econ.fields.occupants[e] = 0;
        }
      }
    }

    // Service jobs.
    const serviceQuery = world.query({ all: [ServiceBuilding], none: [UnderConstruction] });
    const services = world.soa(ServiceBuilding);
    {
      const serviceEntities = serviceQuery.entities;
      for (let i = 0; i < serviceQuery.size; i++) {
        const s = services.denseIndexOf(serviceEntities[i] & 0xffffff);
        jobCapacity += services.fields.jobs[s];
      }
    }

    // Distribute workers across job buildings proportionally.
    const workforce = Math.round(population * WORKFORCE_RATIO);
    const employed = Math.min(workforce, jobCapacity);
    const fillRatio = jobCapacity > 0 ? employed / jobCapacity : 0;
    for (const job of jobBuildings) {
      econ.fields.occupants[job.e] = Math.round(job.capacity * fillRatio);
    }

    const stats = this.stats;
    stats.population = population;
    stats.households = households;
    stats.jobsTotal = jobCapacity;
    stats.jobsFilled = employed;
    stats.unemployment = workforce > 0 ? 1 - employed / workforce : 0;
    stats.education = population > 0 ? educated / population : 0;
    stats.health = population > 0 ? healthy / population : 0;
    stats.safety = population > 0 ? 0.4 + 0.6 * (safe / population) : 1;

    const taxPressure =
      (stats.taxRateResidential - 0.09) * 3 + (stats.taxRateCommercial - 0.09) * 1.5;
    stats.happiness = Math.min(
      1,
      Math.max(
        0,
        0.30 +
          stats.poweredRatio * 0.15 +
          stats.wateredRatio * 0.12 +
          stats.health * 0.1 +
          stats.education * 0.08 +
          stats.safety * 0.1 +
          stats.averageLandValue * 0.15 -
          stats.averagePollution * 0.2 -
          Math.max(0, stats.unemployment - 0.08) * 0.5 -
          taxPressure,
      ),
    );

    stats.cityLevel = stats.levelForPopulation();
    void resCapacity;
    void ctx;
  }
}
