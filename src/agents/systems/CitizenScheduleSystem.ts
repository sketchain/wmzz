import {
  NULL_ENTITY,
  System,
  SystemStage,
  type Entity,
  type SoaStore,
  type TickContext,
  type World,
} from '@/core/ecs';
import { createRng } from '@/terrain/createRng';
import { Transform } from '@/engine/components';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import type { PathService } from '@/traffic/PathService';
import { SERVICE_ORDER } from '@/data/buildingPrototypes';
import { ZONE_COMMERCIAL } from '@/data/buildingPrototypes';
import { Building, ServiceBuilding } from '@/buildings/components';
import type { GameCalendar } from '@/simulation/systems/CalendarSystem';
import {
  Citizen,
  CitizenState,
  Vehicle,
  VehiclePath,
  VehicleState,
} from '../components';

const INTERVAL = 30; // schedule decisions once per sim second
const PHASE = 3;
/** Needs drift per game-minute. */
const ENERGY_DRAIN = 1 / (16 * 60); // empty after 16 waking hours
const FUN_DRAIN = 1 / (30 * 60);
const SHOPPING_GROWTH = 1 / (48 * 60);

/**
 * Daily-life state machine. Citizens wake, commute to work, work a shift,
 * satisfy shopping/leisure needs, return home and sleep — transitions are
 * driven by the game clock plus per-citizen needs, never by random walks.
 * Trips request paths from the worker; while the path is in flight the
 * citizen stays in the travelling state with no vehicle yet.
 */
export class CitizenScheduleSystem extends System {
  readonly name = 'CitizenScheduleSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 55;

  private readonly rng = createRng(0x5c4ed);

  constructor(
    private readonly calendar: GameCalendar,
    private readonly paths: PathService,
    private readonly roads: RoadNetwork,
  ) {
    super();
  }

  update(world: World, ctx: TickContext): void {
    if (ctx.tick % INTERVAL !== PHASE) return;

    const citizens = world.soa(Citizen);
    const query = world.query({ all: [Citizen] });
    const minute = this.calendar.minuteOfDay;
    const elapsedMinutes = INTERVAL / 30; // game minutes per pass (1 tick = 1 min... pass = 30 ticks)

    const entities = query.entities;
    for (let i = 0; i < query.size; i++) {
      const entity = entities[i];
      const c = citizens.denseIndexOf(entity & 0xffffff);
      const state = citizens.fields.state[c];

      // Needs drift.
      if (state !== CitizenState.Sleeping) {
        citizens.fields.energy[c] = Math.max(
          0,
          citizens.fields.energy[c] - ENERGY_DRAIN * elapsedMinutes * 30,
        );
        citizens.fields.shopping[c] = Math.min(
          1,
          citizens.fields.shopping[c] + SHOPPING_GROWTH * elapsedMinutes * 30,
        );
      }
      if (state === CitizenState.Working) {
        citizens.fields.fun[c] = Math.max(
          0,
          citizens.fields.fun[c] - FUN_DRAIN * elapsedMinutes * 30,
        );
      }

      if (citizens.fields.stateTimer[c] > 0) {
        citizens.fields.stateTimer[c] = Math.max(
          0,
          citizens.fields.stateTimer[c] - elapsedMinutes * 30,
        );
        continue;
      }

      switch (state) {
        case CitizenState.Sleeping:
          if (minute >= 6.5 * 60 && minute < 22 * 60) {
            citizens.fields.state[c] = CitizenState.AtHome;
            citizens.fields.energy[c] = 1;
          }
          break;
        case CitizenState.AtHome: {
          const hasWork = citizens.fields.work[c] !== NULL_ENTITY;
          if (minute >= 22 * 60 || minute < 6 * 60 || citizens.fields.energy[c] < 0.15) {
            citizens.fields.state[c] = CitizenState.Sleeping;
          } else if (
            hasWork &&
            minute >= 7 * 60 &&
            minute < 10 * 60 &&
            citizens.fields.workNode[c] !== 0
          ) {
            this.beginTrip(world, entity, c, citizens.fields.homeNode[c], citizens.fields.workNode[c], CitizenState.ToWork);
          } else if (citizens.fields.shopping[c] > 0.75 && minute >= 10 * 60 && minute < 20 * 60) {
            this.tripToAmenity(world, entity, c, 'shop');
          }
          break;
        }
        case CitizenState.Working: {
          // Shift over (timer expired). Decide the evening.
          if (citizens.fields.shopping[c] > 0.5) {
            this.tripToAmenity(world, entity, c, 'shop');
          } else if (citizens.fields.fun[c] < 0.35) {
            this.tripToAmenity(world, entity, c, 'leisure');
          } else {
            this.beginTrip(world, entity, c, this.currentNode(citizens, c), citizens.fields.homeNode[c], CitizenState.ToHome);
          }
          break;
        }
        case CitizenState.Shopping:
          citizens.fields.shopping[c] = 0;
          this.beginTrip(world, entity, c, this.currentNode(citizens, c), citizens.fields.homeNode[c], CitizenState.ToHome);
          break;
        case CitizenState.Leisure:
          citizens.fields.fun[c] = 1;
          this.beginTrip(world, entity, c, this.currentNode(citizens, c), citizens.fields.homeNode[c], CitizenState.ToHome);
          break;
        default:
          break; // travelling states resolve via vehicle arrival
      }
    }
  }

  /** Node the citizen is currently anchored to (destination of last trip). */
  private currentNode(
    citizens: SoaStore<(typeof Citizen)['schema']>,
    c: number,
  ): number {
    return this.lastDestination.get(citizens.entities[c]) ?? citizens.fields.homeNode[c];
  }

  private readonly lastDestination = new Map<number, number>();

  /** Kick off a trip: async path request; vehicle activates on resolve. */
  private beginTrip(
    world: World,
    citizen: Entity,
    c: number,
    fromNode: number,
    toNode: number,
    travelState: number,
  ): void {
    const citizens = world.soa(Citizen);
    if (fromNode === 0 || toNode === 0 || fromNode === toNode) {
      // Degenerate trip: arrive instantly.
      this.arrive(world, citizen, travelState);
      return;
    }
    citizens.fields.state[c] = travelState;
    citizens.fields.stateTimer[c] = 0;
    this.lastDestination.set(citizen, toNode);

    void this.paths.findPath(fromNode, toNode).then((path) => {
      if (!world.isAlive(citizen)) return;
      if (!path || path.edges.length === 0) {
        this.arrive(world, citizen, travelState);
        return;
      }
      this.activateVehicle(world, citizen, path.nodes, path.edges);
    });
  }

  /** Trip to the nearest commercial (shop) or park (leisure). */
  private tripToAmenity(
    world: World,
    citizen: Entity,
    c: number,
    kind: 'shop' | 'leisure',
  ): void {
    const citizens = world.soa(Citizen);
    const from = this.currentNode(citizens, c);
    const target = this.findAmenityNode(world, kind, from);
    if (target === 0) {
      // No amenity in town: need stays unmet (visible in happiness).
      citizens.fields.state[c] = CitizenState.AtHome;
      citizens.fields.stateTimer[c] = 60;
      return;
    }
    this.beginTrip(
      world,
      citizen,
      c,
      from,
      target,
      kind === 'shop' ? CitizenState.ToShop : CitizenState.ToLeisure,
    );
  }

  private findAmenityNode(world: World, kind: 'shop' | 'leisure', nearNode: number): number {
    const origin = this.roads.node(nearNode);
    if (!origin) return 0;
    const buildings = world.soa(Building);
    const transforms = world.soa(Transform);
    let bestNode = 0;
    let bestD2 = Infinity;
    const consider = (entity: number): void => {
      const index = entity & 0xffffff;
      const t = transforms.denseIndexOf(index);
      const x = transforms.fields.x[t];
      const z = transforms.fields.z[t];
      const d2 = (x - origin.x) ** 2 + (z - origin.z) ** 2;
      if (d2 >= bestD2) return;
      const snap = this.roads.snapEdge(x, z, 60);
      if (!snap) return;
      bestD2 = d2;
      bestNode = snap.edge.a;
    };
    if (kind === 'shop') {
      const query = world.query({ all: [Building, Transform] });
      const entities = query.entities;
      for (let i = 0; i < query.size; i++) {
        const b = buildings.denseIndexOf(entities[i] & 0xffffff);
        if (buildings.fields.zone[b] === ZONE_COMMERCIAL) consider(entities[i]);
      }
    } else {
      const services = world.soa(ServiceBuilding);
      const query = world.query({ all: [ServiceBuilding, Transform] });
      const entities = query.entities;
      const parkIndex = SERVICE_ORDER.indexOf('park');
      for (let i = 0; i < query.size; i++) {
        const s = services.denseIndexOf(entities[i] & 0xffffff);
        if (services.fields.serviceIndex[s] === parkIndex) consider(entities[i]);
      }
    }
    return bestNode;
  }

  /** Complete a travel state without/after driving. */
  arrive(world: World, citizen: Entity, travelState: number): void {
    const citizens = world.soa(Citizen);
    const c = citizens.denseIndexOf(citizen & 0xffffff);
    if (c < 0) return;
    switch (travelState) {
      case CitizenState.ToWork:
        citizens.fields.state[c] = CitizenState.Working;
        citizens.fields.stateTimer[c] = 8 * 60; // 8-hour shift
        break;
      case CitizenState.ToShop:
        citizens.fields.state[c] = CitizenState.Shopping;
        citizens.fields.stateTimer[c] = 45 + Math.floor(this.rng() * 45);
        break;
      case CitizenState.ToLeisure:
        citizens.fields.state[c] = CitizenState.Leisure;
        citizens.fields.stateTimer[c] = 60 + Math.floor(this.rng() * 60);
        break;
      default:
        citizens.fields.state[c] = CitizenState.AtHome;
        citizens.fields.stateTimer[c] = 15;
        break;
    }
  }

  /** Park-and-ride: give the citizen's vehicle the resolved path. */
  private activateVehicle(
    world: World,
    citizen: Entity,
    nodes: number[],
    edges: number[],
  ): void {
    const citizens = world.soa(Citizen);
    const c = citizens.denseIndexOf(citizen & 0xffffff);
    if (c < 0) return;
    let vehicle = citizens.fields.vehicle[c];
    if (!world.isAlive(vehicle)) {
      vehicle = world.createEntity();
      world.addComponent(vehicle, Vehicle, {
        edgeId: 0,
        s: 0,
        forward: 1,
        lane: 0,
        speed: 0,
        pathIndex: 0,
        state: VehicleState.Parked,
        owner: citizen,
        blockedTicks: 0,
      });
      world.addComponent(vehicle, Transform, { x: 0, y: 0, z: 0, rot: 0, scale: 1 });
      world.addComponent(vehicle, VehiclePath, { nodes: [], edges: [] });
      citizens.fields.vehicle[c] = vehicle;
    }
    const path = world.getObject(vehicle, VehiclePath)!;
    path.nodes = nodes;
    path.edges = edges;
    const vehicles = world.soa(Vehicle);
    const v = vehicles.denseIndexOf(vehicle & 0xffffff);
    const firstEdge = this.roads.edge(edges[0]);
    if (!firstEdge) {
      this.arrive(world, citizen, citizens.fields.state[c]);
      return;
    }
    vehicles.fields.edgeId[v] = edges[0];
    vehicles.fields.s[v] = 0;
    vehicles.fields.forward[v] = firstEdge.a === nodes[0] ? 1 : 0;
    vehicles.fields.lane[v] = 0;
    vehicles.fields.speed[v] = 0;
    vehicles.fields.pathIndex[v] = 1;
    vehicles.fields.state[v] = VehicleState.Driving;
    vehicles.fields.blockedTicks[v] = 0;
  }
}
