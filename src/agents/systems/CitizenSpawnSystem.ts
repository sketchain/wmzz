import { NULL_ENTITY, System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { createRng } from '@/terrain/createRng';
import { Transform } from '@/engine/components';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import {
  ZONE_RESIDENTIAL,
} from '@/data/buildingPrototypes';
import {
  Abandoned,
  Building,
  BuildingEcon,
  UnderConstruction,
} from '@/buildings/components';
import { Citizen, CitizenState } from '../components';

/** One agent stands in for this many statistical residents. */
export const AGENT_SCALE = 2;
/** Hard agent budget; beyond it new residents stay statistical only. */
export const MAX_AGENTS = 20000;

const INTERVAL = 150; // sync every 5 s of sim
const PHASE = 71;

/**
 * Keeps the agent population in sync with building occupancy: every pass,
 * residential buildings with more residents than represented agents spawn
 * new citizens (assigned a workplace by capacity-weighted lottery), and
 * agents whose home vanished or emptied are despawned along with their car.
 */
export class CitizenSpawnSystem extends System {
  readonly name = 'CitizenSpawnSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 50;

  private readonly rng = createRng(0xc171);
  /** home building entity -> live agent count */
  private readonly agentsPerHome = new Map<number, number>();
  agentCount = 0;

  constructor(private readonly roads: RoadNetwork) {
    super();
  }

  update(world: World, ctx: TickContext): void {
    if (ctx.tick % INTERVAL !== PHASE % INTERVAL) return;

    const buildings = world.soa(Building);
    const econ = world.soa(BuildingEcon);
    const transforms = world.soa(Transform);
    const citizens = world.soa(Citizen);

    // ── Cull agents with dead/empty homes ──
    const agentQuery = world.query({ all: [Citizen] });
    this.agentsPerHome.clear();
    {
      const entities = agentQuery.entities;
      for (let i = 0; i < agentQuery.size; i++) {
        const entity = entities[i];
        const c = citizens.denseIndexOf(entity & 0xffffff);
        const home = citizens.fields.home[c];
        if (!world.isAlive(home)) {
          const vehicle = citizens.fields.vehicle[c];
          world.defer(() => {
            if (world.isAlive(vehicle)) world.destroyEntity(vehicle);
            world.destroyEntity(entity);
          });
          continue;
        }
        this.agentsPerHome.set(home, (this.agentsPerHome.get(home) ?? 0) + 1);
      }
    }

    // ── Workplace lottery pool (capacity-weighted) ──
    const jobQuery = world.query({
      all: [Building, BuildingEcon],
      none: [UnderConstruction, Abandoned],
    });
    const jobPool: { entity: number; weight: number }[] = [];
    let jobWeightTotal = 0;
    {
      const entities = jobQuery.entities;
      for (let i = 0; i < jobQuery.size; i++) {
        const entity = entities[i];
        const index = entity & 0xffffff;
        const zone = buildings.fields.zone[buildings.denseIndexOf(index)];
        if (zone === ZONE_RESIDENTIAL || zone === 0) continue;
        const capacity = econ.fields.capacity[econ.denseIndexOf(index)];
        if (capacity > 0) {
          jobPool.push({ entity, weight: capacity });
          jobWeightTotal += capacity;
        }
      }
    }

    // ── Spawn agents for under-represented homes ──
    const homeQuery = world.query({
      all: [Building, BuildingEcon, Transform],
      none: [UnderConstruction, Abandoned],
    });
    const entities = homeQuery.entities;
    for (let i = 0; i < homeQuery.size; i++) {
      if (this.agentCount >= MAX_AGENTS) break;
      const home = entities[i];
      const index = home & 0xffffff;
      if (buildings.fields.zone[buildings.denseIndexOf(index)] !== ZONE_RESIDENTIAL) continue;
      const occupants = econ.fields.occupants[econ.denseIndexOf(index)];
      const wanted = Math.floor(occupants / AGENT_SCALE);
      const have = this.agentsPerHome.get(home) ?? 0;
      if (wanted <= have) continue;

      const t = transforms.denseIndexOf(index);
      const homeNode = this.nearestNode(
        transforms.fields.x[t],
        transforms.fields.z[t],
      );
      if (homeNode === 0) continue;

      for (let n = have; n < wanted && this.agentCount < MAX_AGENTS; n++) {
        let work = NULL_ENTITY;
        let workNode = 0;
        if (jobPool.length > 0) {
          let pick = this.rng() * jobWeightTotal;
          for (const job of jobPool) {
            pick -= job.weight;
            if (pick <= 0) {
              work = job.entity;
              break;
            }
          }
          if (work !== NULL_ENTITY) {
            const wt = transforms.denseIndexOf(work & 0xffffff);
            workNode = this.nearestNode(
              transforms.fields.x[wt],
              transforms.fields.z[wt],
            );
          }
        }
        const citizen = world.createEntity();
        world.addComponent(citizen, Citizen, {
          home,
          work,
          homeNode,
          workNode,
          state: CitizenState.AtHome,
          stateTimer: 0,
          energy: 0.6 + this.rng() * 0.4,
          fun: 0.4 + this.rng() * 0.4,
          shopping: this.rng() * 0.6,
          vehicle: NULL_ENTITY,
        });
        this.agentsPerHome.set(home, (this.agentsPerHome.get(home) ?? 0) + 1);
      }
    }
    this.agentCount = agentQuery.size;
  }

  private nearestNode(x: number, z: number): number {
    const snap = this.roads.snapEdge(x, z, 60);
    if (!snap) return 0;
    const a = this.roads.node(snap.edge.a);
    const b = this.roads.node(snap.edge.b);
    if (!a || !b) return 0;
    const da = (a.x - x) ** 2 + (a.z - z) ** 2;
    const db = (b.x - x) ** 2 + (b.z - z) ** 2;
    return da <= db ? a.id : b.id;
  }
}
