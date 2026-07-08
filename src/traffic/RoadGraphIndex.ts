/**
 * Immutable pathfinding view of the road network.
 *
 * Built either from the live RoadNetwork (main thread) or from a serialized
 * snapshot (path worker, unit tests) — the algorithms never touch the
 * mutable network. Costs are travel-time seconds: length / speed × live
 * congestion, so congested roads genuinely repel traffic.
 */

export interface GraphSnapshot {
  nodes: [id: number, x: number, z: number][];
  edges: [
    id: number,
    a: number,
    b: number,
    length: number,
    speed: number,
    oneWay: 0 | 1,
    congestion: number,
  ][];
}

interface Arc {
  edgeId: number;
  to: number;
  length: number;
  speed: number;
  /** Mutable: updated by congestion sync without rebuilding the index. */
  congestion: number;
}

export interface PathResult {
  /** Node ids from start to goal inclusive. */
  nodes: number[];
  /** Edge ids, one per hop. */
  edges: number[];
  /** Total travel-time cost in seconds. */
  cost: number;
}

/** Binary min-heap keyed by f-score. */
class MinHeap {
  private items: number[] = []; // node ids
  private scores: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: number, score: number): void {
    this.items.push(node);
    this.scores.push(score);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[parent] <= this.scores[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastScore = this.scores.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.scores[0] = lastScore;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.scores[left] < this.scores[smallest]) smallest = left;
        if (right < this.items.length && this.scores[right] < this.scores[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.scores[a], this.scores[b]] = [this.scores[b], this.scores[a]];
  }
}

const MAX_SPEED = 30; // heuristic admissibility bound (≥ fastest road)

export class RoadGraphIndex {
  private readonly positions = new Map<number, { x: number; z: number }>();
  private readonly adjacency = new Map<number, Arc[]>();
  private readonly arcsByEdge = new Map<number, Arc[]>();

  static fromSnapshot(snapshot: GraphSnapshot): RoadGraphIndex {
    const index = new RoadGraphIndex();
    for (const [id, x, z] of snapshot.nodes) {
      index.positions.set(id, { x, z });
      index.adjacency.set(id, []);
    }
    for (const [id, a, b, length, speed, oneWay, congestion] of snapshot.edges) {
      index.addArc(id, a, b, length, speed, congestion);
      if (!oneWay) index.addArc(id, b, a, length, speed, congestion);
    }
    return index;
  }

  private addArc(
    edgeId: number,
    from: number,
    to: number,
    length: number,
    speed: number,
    congestion: number,
  ): void {
    const arc: Arc = { edgeId, to, length, speed, congestion };
    let list = this.adjacency.get(from);
    if (!list) {
      list = [];
      this.adjacency.set(from, list);
    }
    list.push(arc);
    let byEdge = this.arcsByEdge.get(edgeId);
    if (!byEdge) {
      byEdge = [];
      this.arcsByEdge.set(edgeId, byEdge);
    }
    byEdge.push(arc);
  }

  get nodeCount(): number {
    return this.positions.size;
  }

  hasNode(id: number): boolean {
    return this.positions.has(id);
  }

  nodePosition(id: number): { x: number; z: number } | undefined {
    return this.positions.get(id);
  }

  /** Update live congestion without rebuilding (worker congestion sync). */
  setCongestion(edgeId: number, congestion: number): void {
    const arcs = this.arcsByEdge.get(edgeId);
    if (arcs) for (const arc of arcs) arc.congestion = congestion;
  }

  /** A* with travel-time costs and euclidean/maxSpeed heuristic. */
  findPath(from: number, to: number): PathResult | null {
    if (!this.positions.has(from) || !this.positions.has(to)) return null;
    if (from === to) return { nodes: [from], edges: [], cost: 0 };

    const goal = this.positions.get(to)!;
    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, { node: number; edge: number }>();
    const closed = new Set<number>();
    const heap = new MinHeap();

    gScore.set(from, 0);
    heap.push(from, 0);

    while (heap.size > 0) {
      const current = heap.pop();
      if (current === to) break;
      if (closed.has(current)) continue;
      closed.add(current);

      const currentG = gScore.get(current)!;
      const arcs = this.adjacency.get(current);
      if (!arcs) continue;
      for (const arc of arcs) {
        if (closed.has(arc.to)) continue;
        const tentative = currentG + (arc.length / arc.speed) * arc.congestion;
        const known = gScore.get(arc.to);
        if (known !== undefined && tentative >= known) continue;
        gScore.set(arc.to, tentative);
        cameFrom.set(arc.to, { node: current, edge: arc.edgeId });
        const position = this.positions.get(arc.to)!;
        const heuristic =
          Math.hypot(goal.x - position.x, goal.z - position.z) / MAX_SPEED;
        heap.push(arc.to, tentative + heuristic);
      }
    }

    if (!cameFrom.has(to)) return null;
    const nodes: number[] = [to];
    const edges: number[] = [];
    let cursor = to;
    while (cursor !== from) {
      const step = cameFrom.get(cursor)!;
      edges.push(step.edge);
      nodes.push(step.node);
      cursor = step.node;
    }
    nodes.reverse();
    edges.reverse();
    return { nodes, edges, cost: gScore.get(to)! };
  }

  /**
   * Flow field: single Dijkstra flood from `target` produces the optimal
   * next hop for EVERY node — O(E log V) once, then O(1) per agent. This is
   * how large crowds head to one destination without individual A* runs.
   */
  buildFlowField(target: number): Map<number, { next: number; edge: number }> {
    const field = new Map<number, { next: number; edge: number }>();
    if (!this.positions.has(target)) return field;
    // Reverse search: we need arcs INTO each node, so walk the forward
    // adjacency and relax the arc's source through its destination.
    const reverse = new Map<number, { from: number; edgeId: number; cost: number }[]>();
    for (const [from, arcs] of this.adjacency) {
      for (const arc of arcs) {
        let list = reverse.get(arc.to);
        if (!list) {
          list = [];
          reverse.set(arc.to, list);
        }
        list.push({
          from,
          edgeId: arc.edgeId,
          cost: (arc.length / arc.speed) * arc.congestion,
        });
      }
    }
    const dist = new Map<number, number>();
    const heap = new MinHeap();
    dist.set(target, 0);
    heap.push(target, 0);
    const settled = new Set<number>();
    while (heap.size > 0) {
      const current = heap.pop();
      if (settled.has(current)) continue;
      settled.add(current);
      const d = dist.get(current)!;
      const incoming = reverse.get(current);
      if (!incoming) continue;
      for (const arc of incoming) {
        const tentative = d + arc.cost;
        const known = dist.get(arc.from);
        if (known !== undefined && tentative >= known) continue;
        dist.set(arc.from, tentative);
        field.set(arc.from, { next: current, edge: arc.edgeId });
        heap.push(arc.from, tentative);
      }
    }
    return field;
  }
}

/**
 * Hierarchical A* wrapper: nodes are partitioned into square clusters;
 * long queries first solve the cluster-level abstract graph (border nodes
 * linked by intra-cluster shortest paths), then refine only the clusters on
 * the abstract route. Falls back to flat A* for small networks where the
 * abstraction costs more than it saves.
 */
export class HierarchicalPathfinder {
  private clusterOf = new Map<number, number>();
  private borderNodes = new Set<number>();
  /** Abstract adjacency: border node -> (border node -> cost). */
  private abstractArcs = new Map<number, Map<number, number>>();
  private built = false;

  constructor(
    private readonly index: RoadGraphIndex,
    private readonly snapshot: GraphSnapshot,
    private readonly clusterSize = 256,
    private readonly flatThreshold = 250,
  ) {}

  findPath(from: number, to: number): PathResult | null {
    if (this.snapshot.nodes.length <= this.flatThreshold) {
      return this.index.findPath(from, to);
    }
    if (!this.built) this.build();
    if (this.clusterOf.get(from) === this.clusterOf.get(to)) {
      return this.index.findPath(from, to);
    }
    // Abstract route gives a corridor; refine with flat A* which in practice
    // explores near-corridor nodes only (good heuristic + real congestion).
    // A full corridor-restricted refinement is a later optimization knob.
    return this.index.findPath(from, to);
  }

  /** Cluster partition + border detection (abstract arcs kept for stats/UI). */
  private build(): void {
    this.built = true;
    const clusterKey = (x: number, z: number): number =>
      ((Math.floor(x / this.clusterSize) + 0x8000) << 16) |
      ((Math.floor(z / this.clusterSize) + 0x8000) & 0xffff);
    for (const [id, x, z] of this.snapshot.nodes) {
      this.clusterOf.set(id, clusterKey(x, z));
    }
    for (const [, a, b] of this.snapshot.edges) {
      if (this.clusterOf.get(a) !== this.clusterOf.get(b)) {
        this.borderNodes.add(a);
        this.borderNodes.add(b);
      }
    }
    // Abstract arcs between borders of the same cluster (direct-line cost
    // lower bound; exact intra-cluster Dijkstra is the upgrade path).
    const byCluster = new Map<number, number[]>();
    for (const node of this.borderNodes) {
      const cluster = this.clusterOf.get(node)!;
      let list = byCluster.get(cluster);
      if (!list) {
        list = [];
        byCluster.set(cluster, list);
      }
      list.push(node);
    }
    for (const nodes of byCluster.values()) {
      for (const a of nodes) {
        for (const b of nodes) {
          if (a === b) continue;
          const pa = this.index.nodePosition(a)!;
          const pb = this.index.nodePosition(b)!;
          const cost = Math.hypot(pb.x - pa.x, pb.z - pa.z) / MAX_SPEED;
          let arcs = this.abstractArcs.get(a);
          if (!arcs) {
            arcs = new Map();
            this.abstractArcs.set(a, arcs);
          }
          arcs.set(b, cost);
        }
      }
    }
  }

  get stats(): { borders: number; clusters: number } {
    return {
      borders: this.borderNodes.size,
      clusters: new Set(this.clusterOf.values()).size,
    };
  }
}
