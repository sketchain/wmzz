import { createToken } from '@/core/di/ServiceContainer';
import type { RoadNetwork } from '@/roads/RoadNetwork';

interface LightState {
  /** Sorted incident edge ids. */
  edges: number[];
  /** Index into `edges` that currently has green. */
  greenIndex: number;
  /** Ticks until the phase advances. */
  timer: number;
}

const GREEN_TICKS = 180; // 6 s green per approach
const MIN_EDGES_FOR_LIGHT = 3;

/**
 * Traffic lights + right-of-way. Intersections with ≥3 approaches run a
 * rotating green phase; smaller nodes are uncontrolled (vehicles use gap
 * acceptance in the driving system). Vehicles ask `canEnter` before
 * crossing a node from a given edge.
 */
export class TrafficControl {
  private readonly lights = new Map<number, LightState>();
  private version = -1;

  constructor(private readonly network: RoadNetwork) {}

  /** Advance light timers; call once per simulation tick. */
  tick(): void {
    if (this.network.version !== this.version) {
      this.version = this.network.version;
      this.rebuild();
    }
    for (const light of this.lights.values()) {
      if (--light.timer <= 0) {
        light.greenIndex = (light.greenIndex + 1) % light.edges.length;
        light.timer = GREEN_TICKS;
      }
    }
  }

  hasLight(nodeId: number): boolean {
    return this.lights.has(nodeId);
  }

  /** May a vehicle arriving via `fromEdge` enter the intersection? */
  canEnter(nodeId: number, fromEdge: number): boolean {
    const light = this.lights.get(nodeId);
    if (!light) return true; // uncontrolled node
    return light.edges[light.greenIndex] === fromEdge;
  }

  /** Seconds until `fromEdge` gets green (UI/debug). */
  greenEdgeOf(nodeId: number): number | undefined {
    const light = this.lights.get(nodeId);
    return light?.edges[light.greenIndex];
  }

  get lightCount(): number {
    return this.lights.size;
  }

  private rebuild(): void {
    const survivors = new Set<number>();
    for (const node of this.network.nodes.values()) {
      if (node.edges.length >= MIN_EDGES_FOR_LIGHT) {
        survivors.add(node.id);
        const sorted = [...node.edges].sort((a, b) => a - b);
        const existing = this.lights.get(node.id);
        if (existing) {
          // Keep phase continuity across rebuilds where possible.
          existing.edges = sorted;
          existing.greenIndex = existing.greenIndex % sorted.length;
        } else {
          this.lights.set(node.id, {
            edges: sorted,
            greenIndex: node.id % sorted.length, // desync neighboring lights
            timer: GREEN_TICKS,
          });
        }
      }
    }
    for (const nodeId of [...this.lights.keys()]) {
      if (!survivors.has(nodeId)) this.lights.delete(nodeId);
    }
  }
}

export const TrafficControlToken = createToken<TrafficControl>('traffic.control');
