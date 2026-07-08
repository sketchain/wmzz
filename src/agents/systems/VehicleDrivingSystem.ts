import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { Transform } from '@/engine/components';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import type { PathService } from '@/traffic/PathService';
import type { TrafficControl } from '@/traffic/TrafficControl';
import type { TrafficFlowSystem } from '@/traffic/systems/TrafficSystems';
import { lanesOf, samplePosition, speedOf, type LaneSample } from '@/traffic/LaneGeometry';
import type { CameraRig } from '@/engine/camera/CameraRig';
import {
  Citizen,
  CitizenState,
  Vehicle,
  VehiclePath,
  VehicleState,
} from '../components';
import type { CitizenScheduleSystem } from './CitizenScheduleSystem';

const ACCELERATION = 4; // m/s²
const BRAKING = 8;
const HEADWAY = 9; // meters kept to the car ahead
const INTERSECTION_STOP_DISTANCE = 6;
const REPLAN_BLOCKED_TICKS = 150; // 5 s stuck → replan
/** Beyond this camera distance vehicles simulate coarsely (agent LOD). */
const FULL_SIM_DISTANCE = 600;
const COARSE_TICK_MODULO = 5;

/**
 * Car-following simulation on the lane graph:
 *  - accelerate toward the road's design speed, damped by congestion
 *  - keep headway to the vehicle ahead in the same lane+direction
 *    (per-edge occupancy lists rebuilt each tick)
 *  - stop at red lights; opportunistic lane change when the neighbor
 *    lane is clear ahead and this one isn't
 *  - report presence to the congestion model every tick
 *  - when blocked too long, request a replan around the jam
 *  - far from the camera, integrate every Nth tick (agent LOD) — same
 *    trajectory, less CPU
 */
export class VehicleDrivingSystem extends System {
  readonly name = 'VehicleDrivingSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 60;

  /** edge → per (dir,lane) sorted arc positions, rebuilt each tick. */
  private readonly occupancy = new Map<number, Float32Array[]>();
  private readonly sample: LaneSample = { x: 0, y: 0, z: 0, heading: 0 };

  constructor(
    private readonly roads: RoadNetwork,
    private readonly control: TrafficControl,
    private readonly flow: TrafficFlowSystem,
    private readonly paths: PathService,
    private readonly schedule: CitizenScheduleSystem,
    private readonly rig: CameraRig,
  ) {
    super();
  }

  update(world: World, ctx: TickContext): void {
    const vehicles = world.soa(Vehicle);
    const transforms = world.soa(Transform);
    const query = world.query({ all: [Vehicle, Transform] });
    const entities = query.entities;
    const count = query.size;
    const dt = ctx.dt;

    // ── Pass 1: occupancy snapshot per edge/direction/lane ──
    this.occupancy.clear();
    const positions: { v: number; edge: number; slot: number; s: number }[] = [];
    for (let i = 0; i < count; i++) {
      const v = vehicles.denseIndexOf(entities[i] & 0xffffff);
      if (vehicles.fields.state[v] === VehicleState.Parked) continue;
      const edgeId = vehicles.fields.edgeId[v];
      const edge = this.roads.edge(edgeId);
      if (!edge) continue;
      const lanes = lanesOf(edge);
      const slot = vehicles.fields.forward[v] * lanes + vehicles.fields.lane[v];
      positions.push({ v, edge: edgeId, slot, s: vehicles.fields.s[v] });
    }
    // Group and sort by s so "nearest ahead" is a neighbor scan.
    const grouped = new Map<string, { v: number; s: number }[]>();
    for (const p of positions) {
      const key = `${p.edge}:${p.slot}`;
      let list = grouped.get(key);
      if (!list) {
        list = [];
        grouped.set(key, list);
      }
      list.push({ v: p.v, s: p.s });
    }
    for (const list of grouped.values()) list.sort((a, b) => a.s - b.s);

    const aheadGap = (edgeId: number, slot: number, s: number): number => {
      const list = grouped.get(`${edgeId}:${slot}`);
      if (!list) return Infinity;
      let gap = Infinity;
      for (const other of list) {
        if (other.s > s + 0.01) {
          gap = other.s - s;
          break;
        }
      }
      return gap;
    };

    // ── Pass 2: integrate ──
    const cameraX = this.rig.target.x;
    const cameraZ = this.rig.target.z;

    for (let i = 0; i < count; i++) {
      const entity = entities[i];
      const index = entity & 0xffffff;
      const v = vehicles.denseIndexOf(index);
      const state = vehicles.fields.state[v];
      if (state === VehicleState.Parked) continue;

      const edgeId = vehicles.fields.edgeId[v];
      const edge = this.roads.edge(edgeId);
      const path = world.getObject(entity, VehiclePath);
      const c = world.soa(Citizen).denseIndexOf(vehicles.fields.owner[v] & 0xffffff);
      if (!edge || !path || c < 0) {
        this.finishTrip(world, entity, v, true);
        continue;
      }

      this.flow.reportPresence(edgeId);

      // Agent LOD: distant vehicles integrate on a coarse cadence with a
      // larger dt — identical average motion, one fifth the work.
      const t = transforms.denseIndexOf(index);
      const dx = transforms.fields.x[t] - cameraX;
      const dz = transforms.fields.z[t] - cameraZ;
      const far = dx * dx + dz * dz > FULL_SIM_DISTANCE * FULL_SIM_DISTANCE;
      if (far && ctx.tick % COARSE_TICK_MODULO !== 0) continue;
      const effectiveDt = far ? dt * COARSE_TICK_MODULO : dt;

      const lanes = lanesOf(edge);
      const lane = vehicles.fields.lane[v];
      const forward = vehicles.fields.forward[v] === 1;
      const slot = (forward ? 1 : 0) * lanes + lane;
      const s = vehicles.fields.s[v];
      const gap = aheadGap(edgeId, slot, s);

      // Lane change: blocked ahead, neighbor lane clear → move over.
      if (gap < HEADWAY && lanes > 1) {
        for (const candidate of [lane + 1, lane - 1]) {
          if (candidate < 0 || candidate >= lanes) continue;
          const candidateSlot = (forward ? 1 : 0) * lanes + candidate;
          if (aheadGap(edgeId, candidateSlot, s) > HEADWAY * 2) {
            vehicles.fields.lane[v] = candidate;
            break;
          }
        }
      }

      // Target speed: design speed damped by congestion; braking near
      // obstructions (car ahead / red light / path end).
      let targetSpeed = speedOf(edge) / Math.max(1, edge.congestion * 0.75);
      const remaining = edge.length - s;

      const nextNodeId = path.nodes[vehicles.fields.pathIndex[v]];
      const isLastEdge = vehicles.fields.pathIndex[v] >= path.nodes.length - 1;
      let mustStop = false;
      if (remaining < INTERSECTION_STOP_DISTANCE && !isLastEdge) {
        if (!this.control.canEnter(nextNodeId, edgeId)) {
          mustStop = true;
        }
      }
      if (gap < HEADWAY) mustStop = gap < HEADWAY * 0.6 ? true : mustStop;
      if (gap < HEADWAY && !mustStop) targetSpeed = Math.min(targetSpeed, 2);

      let speed = vehicles.fields.speed[v];
      if (mustStop) {
        speed = Math.max(0, speed - BRAKING * effectiveDt);
        vehicles.fields.state[v] = VehicleState.WaitingAtLight;
        vehicles.fields.blockedTicks[v] += far ? COARSE_TICK_MODULO : 1;
      } else {
        vehicles.fields.state[v] = VehicleState.Driving;
        if (speed < targetSpeed) speed = Math.min(targetSpeed, speed + ACCELERATION * effectiveDt);
        else speed = Math.max(targetSpeed, speed - BRAKING * effectiveDt);
        if (speed > 0.5) vehicles.fields.blockedTicks[v] = 0;
        else vehicles.fields.blockedTicks[v] += far ? COARSE_TICK_MODULO : 1;
      }
      vehicles.fields.speed[v] = speed;

      // Jam replan: reroute from the upcoming node.
      if (vehicles.fields.blockedTicks[v] >= REPLAN_BLOCKED_TICKS && !isLastEdge) {
        vehicles.fields.blockedTicks[v] = 0;
        const goal = path.nodes[path.nodes.length - 1];
        void this.paths.findPath(nextNodeId, goal).then((replanned) => {
          if (!replanned || !world.isAlive(entity)) return;
          const current = world.getObject(entity, VehiclePath);
          if (!current) return;
          // Keep the current edge as hop 0; splice the new route after it.
          current.nodes = [path.nodes[vehicles.fields.pathIndex[v] - 1] ?? nextNodeId, ...replanned.nodes];
          current.edges = [vehicles.fields.edgeId[v], ...replanned.edges];
          vehicles.fields.pathIndex[v] = 1;
        });
      }

      let newS = s + speed * effectiveDt;

      // Edge completed → advance along the path.
      while (newS >= edge.length) {
        if (isLastEdge || vehicles.fields.pathIndex[v] >= path.edges.length) {
          this.finishTrip(world, entity, v, false);
          break;
        }
        const enteredNode = path.nodes[vehicles.fields.pathIndex[v]];
        const nextEdgeId = path.edges[vehicles.fields.pathIndex[v]];
        const nextEdge = this.roads.edge(nextEdgeId);
        if (!nextEdge) {
          this.finishTrip(world, entity, v, true);
          break;
        }
        newS -= edge.length;
        vehicles.fields.edgeId[v] = nextEdgeId;
        vehicles.fields.forward[v] = nextEdge.a === enteredNode ? 1 : 0;
        vehicles.fields.pathIndex[v]++;
        vehicles.fields.lane[v] = Math.min(
          vehicles.fields.lane[v],
          lanesOf(nextEdge) - 1,
        );
        break; // one edge transition per tick keeps math simple
      }
      if (vehicles.fields.state[v] === VehicleState.Parked) continue;
      vehicles.fields.s[v] = Math.min(newS, this.roads.edge(vehicles.fields.edgeId[v])!.length);

      // Write world transform for rendering.
      const activeEdge = this.roads.edge(vehicles.fields.edgeId[v])!;
      samplePosition(
        activeEdge,
        vehicles.fields.s[v],
        vehicles.fields.forward[v] === 1,
        vehicles.fields.lane[v],
        this.sample,
      );
      transforms.fields.x[t] = this.sample.x;
      transforms.fields.y[t] = this.sample.y;
      transforms.fields.z[t] = this.sample.z;
      transforms.fields.rot[t] = this.sample.heading;
    }
  }

  /** Trip ends (arrival or broken path): park the car, advance the owner. */
  private finishTrip(world: World, vehicle: number, v: number, broken: boolean): void {
    const vehicles = world.soa(Vehicle);
    vehicles.fields.state[v] = VehicleState.Parked;
    vehicles.fields.speed[v] = 0;
    const owner = vehicles.fields.owner[v];
    if (world.isAlive(owner)) {
      const citizens = world.soa(Citizen);
      const c = citizens.denseIndexOf(owner & 0xffffff);
      if (c >= 0) {
        const travelState = citizens.fields.state[c];
        if (
          travelState === CitizenState.ToWork ||
          travelState === CitizenState.ToHome ||
          travelState === CitizenState.ToShop ||
          travelState === CitizenState.ToLeisure
        ) {
          this.schedule.arrive(world, owner, travelState);
        }
      }
    }
    void broken;
  }
}
