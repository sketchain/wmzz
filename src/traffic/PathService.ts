import { createToken, type Disposable } from '@/core/di/ServiceContainer';
import { createLogger } from '@/core/utils/Logger';
import type { RoadNetwork } from '@/roads/RoadNetwork';
import { ROAD_PROFILES } from '@/roads/RoadTypes';
import {
  RoadGraphIndex,
  type GraphSnapshot,
  type PathResult,
} from './RoadGraphIndex';

const log = createLogger('paths');

/**
 * Main-thread facade over the path worker.
 *
 * - Mirrors the road graph into the worker whenever the network version
 *   changes (debounced), and streams live congestion updates.
 * - `findPath` resolves asynchronously from the worker; when the worker is
 *   unavailable (tests, SSR) it computes synchronously on a local index.
 * - Keeps a local index anyway for synchronous callers (tools, previews).
 */
export class PathService implements Disposable {
  private worker: Worker | null = null;
  private localIndex: RoadGraphIndex | null = null;
  private syncedVersion = -1;
  private localVersion = -1;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    (result: PathResult | null) => void
  >();
  private readonly pendingFlow = new Map<
    number,
    (field: Map<number, { next: number; edge: number }>) => void
  >();

  /** Requests answered since start (debug overlay). */
  answered = 0;

  constructor(private readonly network: RoadNetwork) {
    try {
      this.worker = new Worker(new URL('../workers/path.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (event) => this.onWorkerMessage(event.data);
      this.worker.onerror = (event) => {
        log.warn('path worker failed, falling back to main thread', event.message);
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  /** Call once per frame: pushes graph/congestion changes to the worker. */
  sync(): void {
    if (this.network.version !== this.syncedVersion) {
      this.syncedVersion = this.network.version;
      const snapshot = this.snapshot();
      this.worker?.postMessage({ type: 'graph', snapshot });
      this.localIndex = RoadGraphIndex.fromSnapshot(snapshot);
      this.localVersion = this.network.version;
    }
  }

  /** Push live congestion (called by TrafficFlowSystem after each pass). */
  pushCongestion(): void {
    const updates: [number, number][] = [];
    for (const edge of this.network.edges.values()) {
      updates.push([edge.id, edge.congestion]);
    }
    this.worker?.postMessage({ type: 'congestion', updates });
    if (this.localIndex) {
      for (const [edgeId, congestion] of updates) {
        this.localIndex.setCongestion(edgeId, congestion);
      }
    }
  }

  /** Async path query (worker-backed). */
  findPath(from: number, to: number): Promise<PathResult | null> {
    this.sync();
    if (!this.worker) {
      return Promise.resolve(this.findPathSync(from, to));
    }
    return new Promise((resolve) => {
      const id = this.nextRequestId++;
      this.pending.set(id, resolve);
      this.worker!.postMessage({ type: 'path', id, from, to });
    });
  }

  /** Synchronous path on the local mirror (tools, previews, tests). */
  findPathSync(from: number, to: number): PathResult | null {
    this.ensureLocalIndex();
    return this.localIndex!.findPath(from, to);
  }

  /** Flow field to a target node (async, worker-backed). */
  buildFlowField(
    target: number,
  ): Promise<Map<number, { next: number; edge: number }>> {
    this.sync();
    if (!this.worker) {
      this.ensureLocalIndex();
      return Promise.resolve(this.localIndex!.buildFlowField(target));
    }
    return new Promise((resolve) => {
      const id = this.nextRequestId++;
      this.pendingFlow.set(id, resolve);
      this.worker!.postMessage({ type: 'flow', id, target });
    });
  }

  private ensureLocalIndex(): void {
    if (!this.localIndex || this.localVersion !== this.network.version) {
      this.localIndex = RoadGraphIndex.fromSnapshot(this.snapshot());
      this.localVersion = this.network.version;
    }
  }

  private snapshot(): GraphSnapshot {
    const nodes: GraphSnapshot['nodes'] = [];
    for (const node of this.network.nodes.values()) {
      nodes.push([node.id, node.x, node.z]);
    }
    const edges: GraphSnapshot['edges'] = [];
    for (const edge of this.network.edges.values()) {
      edges.push([
        edge.id,
        edge.a,
        edge.b,
        edge.length,
        ROAD_PROFILES[edge.kind].speed,
        edge.oneWay ? 1 : 0,
        edge.congestion,
      ]);
    }
    return { nodes, edges };
  }

  private onWorkerMessage(message: {
    type: string;
    id: number;
    nodes?: number[] | null;
    edges?: number[];
    cost?: number;
    field?: [number, number, number][];
  }): void {
    if (message.type === 'path') {
      const resolve = this.pending.get(message.id);
      if (resolve) {
        this.pending.delete(message.id);
        this.answered++;
        resolve(
          message.nodes
            ? { nodes: message.nodes, edges: message.edges!, cost: message.cost! }
            : null,
        );
      }
    } else if (message.type === 'flow') {
      const resolve = this.pendingFlow.get(message.id);
      if (resolve && message.field) {
        this.pendingFlow.delete(message.id);
        const field = new Map<number, { next: number; edge: number }>();
        for (const [node, next, edge] of message.field) {
          field.set(node, { next, edge });
        }
        resolve(field);
      }
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }
}

export const PathServiceToken = createToken<PathService>('traffic.pathService');
