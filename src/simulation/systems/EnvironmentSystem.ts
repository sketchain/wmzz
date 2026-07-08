import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { Transform } from '@/engine/components';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import { ROAD_PROFILES } from '@/roads/RoadTypes';
import { SERVICE_ORDER } from '@/data/buildingPrototypes';
import {
  Abandoned,
  Building,
  BuildingEcon,
  PowerShortage,
  ServiceBuilding,
  UnderConstruction,
  WaterShortage,
} from '@/buildings/components';
import type { CityStats } from '../CityStats';
import {
  COVER_FIRE,
  COVER_HOSPITAL,
  COVER_PARK,
  COVER_POLICE,
  COVER_SCHOOL,
  EnvironmentFields,
} from '../EnvironmentFields';

const REBUILD_INTERVAL = 90; // 3 s of sim
const PHASE = 31;

/**
 * Rebuilds the environment fields from first principles each pass:
 * pollution/noise emitted by industry, plants and busy roads; crime from
 * population density minus police coverage; land value synthesized from all
 * of the above plus service coverage. Then writes each building's local
 * samples and its `condition` composite — the single number that drives
 * upgrades (GrowthSystem) and abandonment (PopulationSystem).
 */
export class EnvironmentSystem extends System {
  readonly name = 'EnvironmentSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 15;

  constructor(
    private readonly fields: EnvironmentFields,
    private readonly roads: RoadNetwork,
    private readonly stats: CityStats,
  ) {
    super();
  }

  update(world: World, ctx: TickContext): void {
    if (ctx.tick % REBUILD_INTERVAL !== PHASE % REBUILD_INTERVAL) return;
    const fields = this.fields;
    fields.pollution.clear();
    fields.noise.clear();
    fields.crime.clear();
    fields.coverage.clear();
    fields.landValue.clear();

    const buildings = world.soa(Building);
    const econ = world.soa(BuildingEcon);
    const services = world.soa(ServiceBuilding);
    const transforms = world.soa(Transform);

    // ── Emissions from buildings ──
    const grown = world.query({ all: [Building, BuildingEcon, Transform], none: [UnderConstruction] });
    {
      const entities = grown.entities;
      for (let i = 0; i < grown.size; i++) {
        const index = entities[i] & 0xffffff;
        const b = buildings.denseIndexOf(index);
        const e = econ.denseIndexOf(index);
        const t = transforms.denseIndexOf(index);
        const x = transforms.fields.x[t];
        const z = transforms.fields.z[t];
        const level = buildings.fields.level[b];
        const pollution = econ.fields.pollution[e] * (0.6 + level * 0.4);
        const noise = econ.fields.noise[e] * (0.6 + level * 0.3);
        if (pollution > 0) EnvironmentFields.stamp(fields.pollution, x, z, 90 + pollution * 12, pollution * 0.25);
        if (noise > 0) EnvironmentFields.stamp(fields.noise, x, z, 45, noise * 0.2);
        // Crime pressure scales with residents/workers present.
        const occupants = econ.fields.occupants[e];
        if (occupants > 0) EnvironmentFields.stamp(fields.crime, x, z, 80, occupants * 0.004);
      }
    }

    // ── Service coverage + heavy plant pollution ──
    const served = world.query({ all: [Building, ServiceBuilding, Transform], none: [UnderConstruction] });
    {
      const entities = served.entities;
      for (let i = 0; i < served.size; i++) {
        const index = entities[i] & 0xffffff;
        const s = services.denseIndexOf(index);
        const t = transforms.denseIndexOf(index);
        const x = transforms.fields.x[t];
        const z = transforms.fields.z[t];
        const radius = services.fields.radius[s];
        const kind = SERVICE_ORDER[services.fields.serviceIndex[s]];
        switch (kind) {
          case 'park':
            EnvironmentFields.stampFlag(fields.coverage, x, z, radius, COVER_PARK);
            break;
          case 'school':
            EnvironmentFields.stampFlag(fields.coverage, x, z, radius, COVER_SCHOOL);
            break;
          case 'hospital':
            EnvironmentFields.stampFlag(fields.coverage, x, z, radius, COVER_HOSPITAL);
            break;
          case 'police':
            EnvironmentFields.stampFlag(fields.coverage, x, z, radius, COVER_POLICE);
            break;
          case 'fire':
            EnvironmentFields.stampFlag(fields.coverage, x, z, radius, COVER_FIRE);
            break;
          case 'powerPlant':
            EnvironmentFields.stamp(fields.pollution, x, z, 150, 1.1);
            EnvironmentFields.stamp(fields.noise, x, z, 160, 0.8);
            break;
          case 'landfill':
            EnvironmentFields.stamp(fields.pollution, x, z, 160, 1.0);
            break;
          case 'airport':
            EnvironmentFields.stamp(fields.noise, x, z, 320, 1.4);
            break;
          default:
            break;
        }
      }
    }

    // ── Road noise from traffic ──
    for (const edge of this.roads.edges.values()) {
      const profile = ROAD_PROFILES[edge.kind];
      const busy = profile.lanesPerDirection * edge.congestion;
      const pts = edge.points;
      for (let i = 0; i < pts.length; i += 12) {
        EnvironmentFields.stamp(fields.noise, pts[i], pts[i + 2], 40, busy * 0.06);
      }
    }

    // ── Synthesize land value & final crime over touched cells ──
    const touched = new Set<number>([
      ...fields.pollution.keys(),
      ...fields.noise.keys(),
      ...fields.crime.keys(),
      ...fields.coverage.keys(),
    ]);
    let landValueSum = 0;
    for (const key of touched) {
      const pollution = fields.pollution.get(key) ?? 0;
      const noise = fields.noise.get(key) ?? 0;
      const coverage = fields.coverage.get(key) ?? 0;
      let crime = fields.crime.get(key) ?? 0;
      if (coverage & COVER_POLICE) crime *= 0.25;
      fields.crime.set(key, crime);
      let value = 0.4;
      if (coverage & COVER_PARK) value += 0.2;
      if (coverage & COVER_SCHOOL) value += 0.08;
      if (coverage & COVER_HOSPITAL) value += 0.08;
      value -= Math.min(pollution * 0.25, 0.35);
      value -= Math.min(noise * 0.15, 0.2);
      value -= Math.min(crime * 0.3, 0.25);
      value = Math.min(1, Math.max(0, value));
      fields.landValue.set(key, value);
      landValueSum += value;
    }
    this.stats.averageLandValue = touched.size > 0 ? landValueSum / touched.size : 0.4;

    // ── Write per-building samples + condition composite ──
    const garbagePenalty =
      this.stats.garbageCapacity > 0
        ? Math.min(this.stats.garbageAccumulated / (this.stats.garbageCapacity * 4), 0.25)
        : Math.min(this.stats.garbageAccumulated / 4000, 0.25);
    let pollutionSum = 0;
    {
      const entities = grown.entities;
      for (let i = 0; i < grown.size; i++) {
        const entity = entities[i];
        const index = entity & 0xffffff;
        const e = econ.denseIndexOf(index);
        const t = transforms.denseIndexOf(index);
        const x = transforms.fields.x[t];
        const z = transforms.fields.z[t];

        const pollution = this.fields.pollutionAt(x, z);
        const noise = this.fields.noiseAt(x, z);
        const landValue = this.fields.landValueAt(x, z);
        const crime = this.fields.crimeAt(x, z);
        econ.fields.pollution[e] = Math.max(econ.fields.pollution[e], 0); // emitted stays
        econ.fields.landValue[e] = landValue;
        pollutionSum += pollution;

        let condition = 0.35 + landValue * 0.5;
        if (world.hasComponent(entity, PowerShortage)) condition -= 0.25;
        if (world.hasComponent(entity, WaterShortage)) condition -= 0.2;
        if (world.hasComponent(entity, Abandoned)) condition -= 0.2;
        condition -= Math.min(crime * 0.2, 0.15);
        condition -= Math.min(noise * 0.1, 0.1);
        condition -= Math.min(pollution * 0.2, 0.2);
        condition -= garbagePenalty;
        econ.fields.condition[e] = Math.min(1, Math.max(0, condition));
      }
    }
    this.stats.averagePollution = grown.size > 0 ? pollutionSum / grown.size : 0;
    fields.version++;
  }
}
