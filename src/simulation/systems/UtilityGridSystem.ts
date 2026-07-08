import {
  System,
  SystemStage,
  type TagComponentType,
  type TickContext,
  type World,
} from '@/core/ecs';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import {
  Building,
  BuildingEcon,
  PowerShortage,
  ServiceBuilding,
  UnderConstruction,
  WaterShortage,
} from '@/buildings/components';
import type { CityStats } from '../CityStats';

/** Union-find over road-graph node ids. */
class UnionFind {
  private readonly parent = new Map<number, number>();

  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root)! !== root) root = this.parent.get(root)!;
    let current = x;
    while (current !== root) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface UtilityConfig {
  name: 'power' | 'water';
  shortageTag: TagComponentType;
  /** Reads a building's demand from its econ row. */
  demand: (econ: { powerDemand: Float32Array; waterDemand: Float32Array }, dense: number) => number;
  /** Reads a service building's production (+) / consumption (−). */
  serviceFlow: (service: { power: Float32Array; water: Float32Array }, dense: number) => number;
  writeStats: (
    stats: CityStats,
    supply: number,
    demand: number,
    servedRatio: number,
  ) => void;
}

export const POWER_CONFIG: UtilityConfig = {
  name: 'power',
  shortageTag: PowerShortage,
  demand: (f, i) => f.powerDemand[i],
  serviceFlow: (f, i) => f.power[i],
  writeStats: (stats, supply, demand, served) => {
    stats.powerSupply = supply;
    stats.powerDemand = demand;
    stats.poweredRatio = served;
  },
};

export const WATER_CONFIG: UtilityConfig = {
  name: 'water',
  shortageTag: WaterShortage,
  demand: (f, i) => f.waterDemand[i],
  serviceFlow: (f, i) => f.water[i],
  writeStats: (stats, supply, demand, served) => {
    stats.waterSupply = supply;
    stats.waterDemand = demand;
    stats.wateredRatio = served;
  },
};

const RECOMPUTE_INTERVAL = 45; // 1.5 s of sim

/**
 * Power / water distribution (both instances of this class).
 *
 * Transmission follows the road network, Cities: Skylines style: the road
 * graph's connected components form grids; plants inject supply into the
 * component their access road belongs to; buildings draw from the component
 * of their frontage road. Component demand beyond supply blacks out the
 * newest consumers first (deterministic entity-id order) with a hysteresis-
 * free full recompute every 1.5 s.
 */
export class UtilityGridSystem extends System {
  readonly name: string;
  override readonly stage = SystemStage.Simulation;
  override readonly order = 10;

  private readonly phase: number;

  constructor(
    private readonly config: UtilityConfig,
    private readonly roads: RoadNetwork,
    private readonly stats: CityStats,
  ) {
    super();
    this.name = config.name === 'power' ? 'PowerGridSystem' : 'WaterGridSystem';
    this.phase = config.name === 'power' ? 7 : 23; // stagger the heavy passes
  }

  update(world: World, ctx: TickContext): void {
    if (ctx.tick % RECOMPUTE_INTERVAL !== this.phase % RECOMPUTE_INTERVAL) return;

    // 1. Connected components of the road graph.
    const dsu = new UnionFind();
    for (const edge of this.roads.edges.values()) {
      dsu.union(edge.a, edge.b);
    }
    const componentOfEdge = (edgeId: number): number => {
      const edge = this.roads.edges.get(edgeId);
      return edge ? dsu.find(edge.a) : -1;
    };

    // 2. Supply & internal service consumption per component.
    const supply = new Map<number, number>();
    const serviceQuery = world.query({
      all: [Building, ServiceBuilding],
      none: [UnderConstruction],
    });
    const buildings = world.soa(Building);
    const services = world.soa(ServiceBuilding);
    let totalSupply = 0;
    {
      const entities = serviceQuery.entities;
      for (let i = 0; i < serviceQuery.size; i++) {
        const index = entities[i] & 0xffffff;
        const b = buildings.denseIndexOf(index);
        const s = services.denseIndexOf(index);
        const component = componentOfEdge(buildings.fields.edgeId[b]);
        if (component < 0) continue;
        const flow = this.config.serviceFlow(services.fields, s);
        supply.set(component, (supply.get(component) ?? 0) + flow);
        if (flow > 0) totalSupply += flow;
      }
    }

    // 3. Demand per component from occupied growables.
    const econQuery = world.query({
      all: [Building, BuildingEcon],
      none: [UnderConstruction],
    });
    const econ = world.soa(BuildingEcon);
    const demandByComponent = new Map<number, number>();
    let totalDemand = 0;
    {
      const entities = econQuery.entities;
      for (let i = 0; i < econQuery.size; i++) {
        const index = entities[i] & 0xffffff;
        const b = buildings.denseIndexOf(index);
        const e = econ.denseIndexOf(index);
        const component = componentOfEdge(buildings.fields.edgeId[b]);
        const demand = this.config.demand(econ.fields, e);
        totalDemand += demand;
        if (component >= 0) {
          demandByComponent.set(component, (demandByComponent.get(component) ?? 0) + demand);
        }
      }
    }

    // 4. Tag shortages: disconnected buildings always; connected ones when
    //    their component overdraws, cutting highest entity ids first.
    const tag = this.config.shortageTag;
    const remaining = new Map<number, number>();
    for (const [component, componentSupply] of supply) remaining.set(component, componentSupply);

    const entities = econQuery.entities;
    const sorted = Array.from({ length: econQuery.size }, (_, i) => entities[i]).sort(
      (a, b) => a - b,
    );
    let servedDemand = 0;
    for (const entity of sorted) {
      const index = entity & 0xffffff;
      const b = buildings.denseIndexOf(index);
      const e = econ.denseIndexOf(index);
      const demand = this.config.demand(econ.fields, e);
      const component = componentOfEdge(buildings.fields.edgeId[b]);
      let served = false;
      if (component >= 0) {
        const left = remaining.get(component) ?? 0;
        if (left >= demand && demand >= 0) {
          remaining.set(component, left - demand);
          served = true;
        }
      }
      if (demand <= 0) served = true;
      if (served) {
        servedDemand += Math.max(demand, 0);
        if (world.hasComponent(entity, tag)) {
          world.defer(() => world.removeComponent(entity, tag));
        }
      } else if (!world.hasComponent(entity, tag)) {
        world.defer(() => world.addComponent(entity, tag));
      }
    }

    this.config.writeStats(
      this.stats,
      totalSupply,
      totalDemand,
      totalDemand > 0 ? servedDemand / totalDemand : 1,
    );
  }
}
