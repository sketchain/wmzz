import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import { ROAD_PROFILES } from '@/roads/RoadTypes';
import type { PathService } from '../PathService';
import type { TrafficControl } from '../TrafficControl';

const CONGESTION_INTERVAL = 30; // recompute once per sim second
const CONGESTION_PHASE = 13;

/**
 * Aggregates per-edge vehicle presence into a congestion factor.
 *
 * Vehicles call `reportPresence(edgeId)` every tick they occupy an edge.
 * Each pass: density = reports / (capacity per pass); congestion eases
 * toward the measured level so brief spikes don't thrash pathfinding.
 * The factor multiplies path costs (worker sync) and drives replanning,
 * road noise and the Phase 9 traffic heatmap.
 */
export class TrafficFlowSystem extends System {
  readonly name = 'TrafficFlowSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 5;

  private readonly reports = new Map<number, number>();

  constructor(
    private readonly network: RoadNetwork,
    private readonly paths: PathService,
  ) {
    super();
  }

  /** Vehicles report each tick they spend on an edge. */
  reportPresence(edgeId: number): void {
    this.reports.set(edgeId, (this.reports.get(edgeId) ?? 0) + 1);
  }

  /** Congestion in [0,1] for overlays (0 = free, 1 = jammed). */
  congestionLevel(edgeId: number): number {
    const edge = this.network.edge(edgeId);
    if (!edge) return 0;
    return Math.min(1, (edge.congestion - 1) / 3);
  }

  update(_world: World, ctx: TickContext): void {
    if (ctx.tick % CONGESTION_INTERVAL !== CONGESTION_PHASE) return;

    for (const edge of this.network.edges.values()) {
      const reports = this.reports.get(edge.id) ?? 0;
      // Vehicle-ticks an edge can absorb per pass before congesting:
      // one vehicle-tick per 8 m of lane per tick of the window.
      const profile = ROAD_PROFILES[edge.kind];
      const capacity =
        ((edge.length / 8) * profile.lanesPerDirection * CONGESTION_INTERVAL) /
        (edge.oneWay ? 1 : 2);
      const density = capacity > 0 ? reports / capacity : 0;
      const target = 1 + Math.min(3, density * 3);
      edge.congestion += (target - edge.congestion) * 0.5;
    }
    this.reports.clear();
    this.paths.pushCongestion();
  }
}

/** Advances traffic-light phases and keeps the worker graph in sync. */
export class TrafficControlSystem extends System {
  readonly name = 'TrafficControlSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 3;

  constructor(
    private readonly control: TrafficControl,
    private readonly paths: PathService,
  ) {
    super();
  }

  update(): void {
    this.control.tick();
    this.paths.sync();
  }
}
