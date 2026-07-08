import { defineComponent, defineObjectComponent } from '@/core/ecs';

/**
 * Citizen agents. One agent represents AGENT_SCALE residents — the same
 * device Cities: Skylines 1 used to keep agent counts tractable while the
 * statistical simulation carries full population numbers.
 */
export const Citizen = defineComponent('agent.Citizen', {
  /** Home / workplace building entities (u32 entity ids). */
  home: 'u32',
  work: 'u32',
  /** Road node ids anchoring trips. */
  homeNode: 'u32',
  workNode: 'u32',
  /** CitizenState enum. */
  state: 'u8',
  /** Game minutes remaining in the current activity. */
  stateTimer: 'u16',
  /** Needs in [0,1]: sleep pressure, fun deficit, shopping urge. */
  energy: 'f32',
  fun: 'f32',
  shopping: 'f32',
  /** Vehicle entity owned by this citizen (NULL_ENTITY until first trip). */
  vehicle: 'u32',
});

export const CitizenState = {
  Sleeping: 0,
  AtHome: 1,
  ToWork: 2,
  Working: 3,
  Shopping: 4,
  Leisure: 5,
  ToHome: 6,
  ToShop: 7,
  ToLeisure: 8,
} as const;

export const Vehicle = defineComponent('agent.Vehicle', {
  /** Current edge + arc position. */
  edgeId: 'u32',
  s: 'f32',
  forward: 'u8',
  lane: 'u8',
  /** Current speed m/s. */
  speed: 'f32',
  /** Index of the NEXT node in the path (nodes[pathIndex] is ahead). */
  pathIndex: 'u16',
  /** VehicleState enum. */
  state: 'u8',
  /** Owning citizen entity. */
  owner: 'u32',
  /** Ticks spent blocked (replan trigger). */
  blockedTicks: 'u16',
});

export const VehicleState = {
  Parked: 0,
  Driving: 1,
  WaitingAtLight: 2,
} as const;

export interface VehiclePathData {
  nodes: number[];
  edges: number[];
}

export const VehiclePath = defineObjectComponent<VehiclePathData>('agent.VehiclePath');
