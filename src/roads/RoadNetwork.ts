import { createToken } from '@/core/di/ServiceContainer';
import type { HeightField } from '@/terrain/HeightField';
import {
  BRIDGE_CLEARANCE,
  EDGE_SNAP_RADIUS,
  NODE_SNAP_RADIUS,
  ROAD_PROFILES,
  ROAD_SAMPLE_SPACING,
  ROAD_SURFACE_LIFT,
  TUNNEL_DEPTH,
  type RoadKind,
} from './RoadTypes';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  y: number;
  /** Incident edge ids. */
  edges: number[];
}

/** Per-sample deck flags. */
export const SAMPLE_GROUND = 0;
export const SAMPLE_BRIDGE = 1;
export const SAMPLE_TUNNEL = 2;

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  kind: RoadKind;
  oneWay: boolean;
  /** Quadratic bezier control point, or null for a straight segment. */
  control: { x: number; z: number } | null;
  /** Sampled centerline [x,y,z] triplets from a→b. */
  points: Float32Array;
  /** Per-sample flag: ground / bridge / tunnel. */
  deck: Uint8Array;
  length: number;
  /** Live congestion factor updated by traffic (1 = free flow). */
  congestion: number;
}

export interface EdgeSpec {
  a: number;
  b: number;
  kind: RoadKind;
  oneWay: boolean;
  control: { x: number; z: number } | null;
}

/** Invertible mutation record — commands replay/reverse these. */
export interface NetworkChange {
  addedNodes: number[];
  addedEdges: number[];
  /** Edges removed by this change, with enough data to restore them. */
  removedEdges: { id: number; spec: EdgeSpec }[];
  /** Nodes removed by this change. */
  removedNodes: { id: number; x: number; z: number }[];
  /** Terrain height-delta edits from roadbed grading (vertexKey→values). */
  terrainEdits: { key: number; before: number | undefined; after: number | undefined }[];
}

const HASH_CELL = 48;

function hashKey(x: number, z: number): number {
  return ((Math.floor(x / HASH_CELL) + 0x8000) << 16) | ((Math.floor(z / HASH_CELL) + 0x8000) & 0xffff);
}

/**
 * Topological road graph + geometry sampling + spatial snapping.
 *
 * Mutations happen through `addRoad` / `removeEdge` / `buildRoundabout`,
 * each returning an invertible NetworkChange consumed by undo commands.
 * Rendering and pathfinding read the graph; they never mutate it.
 */
export class RoadNetwork {
  readonly nodes = new Map<number, RoadNode>();
  readonly edges = new Map<number, RoadEdge>();
  /** Bumped on every structural change (renderer/pathfinding cache key). */
  version = 0;

  private nextNodeId = 1;
  private nextEdgeId = 1;
  private readonly nodeHash = new Map<number, Set<number>>();
  private readonly edgeHash = new Map<number, Set<number>>();

  constructor(private readonly field: HeightField) {}

  // ── Queries ─────────────────────────────────────────────────────────────

  node(id: number): RoadNode | undefined {
    return this.nodes.get(id);
  }

  edge(id: number): RoadEdge | undefined {
    return this.edges.get(id);
  }

  /** Nearest node within radius, or null. */
  snapNode(x: number, z: number, radius = NODE_SNAP_RADIUS): RoadNode | null {
    let best: RoadNode | null = null;
    let bestD2 = radius * radius;
    this.forEachInHash(this.nodeHash, x, z, radius, (id) => {
      const node = this.nodes.get(id);
      if (!node) return;
      const d2 = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = node;
      }
    });
    return best;
  }

  /** Nearest point on any edge centerline within radius. */
  snapEdge(
    x: number,
    z: number,
    radius = EDGE_SNAP_RADIUS,
  ): { edge: RoadEdge; x: number; z: number; t: number } | null {
    let best: { edge: RoadEdge; x: number; z: number; t: number } | null = null;
    let bestD2 = radius * radius;
    this.forEachInHash(this.edgeHash, x, z, radius + HASH_CELL, (id) => {
      const edge = this.edges.get(id);
      if (!edge) return;
      const pts = edge.points;
      const count = pts.length / 3;
      for (let i = 0; i < count - 1; i++) {
        const ax = pts[i * 3];
        const az = pts[i * 3 + 2];
        const bx = pts[(i + 1) * 3];
        const bz = pts[(i + 1) * 3 + 2];
        const dx = bx - ax;
        const dz = bz - az;
        const len2 = dx * dx + dz * dz;
        let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
        t = Math.min(1, Math.max(0, t));
        const px = ax + dx * t;
        const pz = az + dz * t;
        const d2 = (px - x) ** 2 + (pz - z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = { edge, x: px, z: pz, t: (i + t) / (count - 1) };
        }
      }
    });
    return best;
  }

  // ── Mutations ───────────────────────────────────────────────────────────

  /**
   * Build a road from (ax,az) to (bx,bz), snapping endpoints to existing
   * nodes/edges (splitting edges where needed).
   */
  addRoad(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    kind: RoadKind,
    control: { x: number; z: number } | null = null,
    oneWay = false,
  ): NetworkChange {
    const change: NetworkChange = {
      addedNodes: [],
      addedEdges: [],
      removedEdges: [],
      removedNodes: [],
      terrainEdits: [],
    };
    const start = this.resolveEndpoint(ax, az, change);
    const end = this.resolveEndpoint(bx, bz, change);
    if (start.id === end.id) return change;
    const edge = this.createEdge({ a: start.id, b: end.id, kind, oneWay, control });
    change.addedEdges.push(edge.id);
    this.gradeTerrain(edge, change);
    this.version++;
    return change;
  }

  removeEdge(edgeId: number): NetworkChange {
    const change: NetworkChange = {
      addedNodes: [],
      addedEdges: [],
      removedEdges: [],
      removedNodes: [],
      terrainEdits: [],
    };
    const edge = this.edges.get(edgeId);
    if (!edge) return change;
    change.removedEdges.push({ id: edge.id, spec: this.specOf(edge) });
    this.deleteEdge(edge);
    // Clean up orphaned endpoints.
    for (const nodeId of [edge.a, edge.b]) {
      const node = this.nodes.get(nodeId);
      if (node && node.edges.length === 0) {
        change.removedNodes.push({ id: node.id, x: node.x, z: node.z });
        this.deleteNode(node);
      }
    }
    this.version++;
    return change;
  }

  /** Ring of one-way street edges around (cx,cz). */
  buildRoundabout(cx: number, cz: number, radius = 18, segments = 8): NetworkChange {
    const change: NetworkChange = {
      addedNodes: [],
      addedEdges: [],
      removedEdges: [],
      removedNodes: [],
      terrainEdits: [],
    };
    const ring: number[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const node = this.createNode(cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius);
      change.addedNodes.push(node.id);
      ring.push(node.id);
    }
    for (let i = 0; i < segments; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % segments];
      const na = this.nodes.get(a)!;
      const nb = this.nodes.get(b)!;
      const mid = {
        x: cx + ((na.x + nb.x) / 2 - cx) * 1.12,
        z: cz + ((na.z + nb.z) / 2 - cz) * 1.12,
      };
      const edge = this.createEdge({ a, b, kind: 'street', oneWay: true, control: mid });
      change.addedEdges.push(edge.id);
      this.gradeTerrain(edge, change);
    }
    this.version++;
    return change;
  }

  /** Reverse a change produced by addRoad/removeEdge/buildRoundabout. */
  revert(change: NetworkChange): void {
    for (const id of change.addedEdges) {
      const edge = this.edges.get(id);
      if (edge) this.deleteEdge(edge);
    }
    for (const id of change.addedNodes) {
      const node = this.nodes.get(id);
      if (node && node.edges.length === 0) this.deleteNode(node);
    }
    for (const removed of change.removedNodes) {
      this.restoreNode(removed.id, removed.x, removed.z);
    }
    for (const removed of change.removedEdges) {
      this.restoreEdge(removed.id, removed.spec);
    }
    this.applyTerrainEdits(change, 'before');
    this.version++;
  }

  /** Re-apply a previously reverted change (redo). */
  reapply(change: NetworkChange): void {
    for (const removed of change.removedEdges) {
      const edge = this.edges.get(removed.id);
      if (edge) this.deleteEdge(edge);
    }
    for (const removed of change.removedNodes) {
      const node = this.nodes.get(removed.id);
      if (node && node.edges.length === 0) this.deleteNode(node);
    }
    for (const id of change.addedNodes) {
      const spec = this.rememberedNodes.get(id);
      if (spec) this.restoreNode(id, spec.x, spec.z);
    }
    for (const id of change.addedEdges) {
      const spec = this.rememberedEdges.get(id);
      if (spec) this.restoreEdge(id, spec);
    }
    this.applyTerrainEdits(change, 'after');
    this.version++;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /** Specs of everything ever created, for redo restoration. */
  private readonly rememberedEdges = new Map<number, EdgeSpec>();
  private readonly rememberedNodes = new Map<number, { x: number; z: number }>();

  /** Wired by composition root: invalidates terrain chunk meshes. */
  onTerrainChanged: ((minX: number, minZ: number, maxX: number, maxZ: number) => void) | null =
    null;

  /**
   * Grade the roadbed: pull terrain vertices under (and blended around)
   * ground-deck samples to deck height, recording invertible edits. This is
   * what keeps roads flush with the rendered terrain at every LOD.
   */
  private gradeTerrain(edge: RoadEdge, change: NetworkChange): void {
    const profile = ROAD_PROFILES[edge.kind];
    const halfWidth = profile.width / 2 + profile.sidewalk;
    const blend = 5;
    const reach = halfWidth + blend;
    const cell = 2; // TerrainConfig.cellSize — kept literal to avoid the import cycle
    const points = edge.points;
    const deck = edge.deck;
    const count = points.length / 3;
    const touched = new Map<number, number>(); // key -> target blended height
    const weights = new Map<number, number>();

    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < count; i++) {
      if (deck[i] !== SAMPLE_GROUND) continue;
      const px = points[i * 3];
      const py = points[i * 3 + 1] - ROAD_SURFACE_LIFT;
      const pz = points[i * 3 + 2];
      const v0x = Math.floor((px - reach) / cell);
      const v1x = Math.ceil((px + reach) / cell);
      const v0z = Math.floor((pz - reach) / cell);
      const v1z = Math.ceil((pz + reach) / cell);
      for (let vz = v0z; vz <= v1z; vz++) {
        for (let vx = v0x; vx <= v1x; vx++) {
          const d = Math.hypot(vx * cell - px, vz * cell - pz);
          if (d > reach) continue;
          const w = d <= halfWidth ? 1 : 1 - (d - halfWidth) / blend;
          const key = ((vx + 0x8000) << 16) | ((vz + 0x8000) & 0xffff);
          const prevW = weights.get(key) ?? 0;
          if (w > prevW) {
            weights.set(key, w);
            touched.set(key, py);
          }
        }
      }
      minX = Math.min(minX, px - reach);
      minZ = Math.min(minZ, pz - reach);
      maxX = Math.max(maxX, px + reach);
      maxZ = Math.max(maxZ, pz + reach);
    }

    for (const [key, target] of touched) {
      const w = weights.get(key)!;
      const vx = ((key >>> 16) & 0xffff) - 0x8000;
      const vz = (key & 0xffff) - 0x8000;
      const before = this.field.editDeltas.get(key);
      const base = this.field.baseHeight(vx * cell, vz * cell);
      const current = base + (before ?? 0);
      const graded = current + (target - current) * w;
      const after = graded - base;
      if (Math.abs(after) < 1e-4) this.field.editDeltas.delete(key);
      else this.field.editDeltas.set(key, after);
      change.terrainEdits.push({ key, before, after: this.field.editDeltas.get(key) });
    }

    if (touched.size > 0 && this.onTerrainChanged && minX < Infinity) {
      this.onTerrainChanged(minX, minZ, maxX, maxZ);
    }
  }

  private applyTerrainEdits(change: NetworkChange, which: 'before' | 'after'): void {
    if (change.terrainEdits.length === 0) return;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const cell = 2;
    for (const edit of change.terrainEdits) {
      const value = edit[which];
      if (value === undefined) this.field.editDeltas.delete(edit.key);
      else this.field.editDeltas.set(edit.key, value);
      const vx = ((edit.key >>> 16) & 0xffff) - 0x8000;
      const vz = (edit.key & 0xffff) - 0x8000;
      minX = Math.min(minX, vx * cell);
      minZ = Math.min(minZ, vz * cell);
      maxX = Math.max(maxX, vx * cell);
      maxZ = Math.max(maxZ, vz * cell);
    }
    this.onTerrainChanged?.(minX, minZ, maxX, maxZ);
  }

  private specOf(edge: RoadEdge): EdgeSpec {
    return {
      a: edge.a,
      b: edge.b,
      kind: edge.kind,
      oneWay: edge.oneWay,
      control: edge.control,
    };
  }

  private resolveEndpoint(
    x: number,
    z: number,
    change: NetworkChange,
  ): RoadNode {
    const snapped = this.snapNode(x, z);
    if (snapped) return snapped;
    const onEdge = this.snapEdge(x, z);
    if (onEdge) {
      return this.splitEdge(onEdge.edge, onEdge.x, onEdge.z, change);
    }
    const node = this.createNode(x, z);
    change.addedNodes.push(node.id);
    return node;
  }

  /** Split an edge at (x,z): remove it, insert a node, add both halves. */
  private splitEdge(
    edge: RoadEdge,
    x: number,
    z: number,
    change: NetworkChange,
  ): RoadNode {
    change.removedEdges.push({ id: edge.id, spec: this.specOf(edge) });
    this.deleteEdge(edge);
    const node = this.createNode(x, z);
    change.addedNodes.push(node.id);
    // Control points: subdividing a quadratic bezier exactly needs
    // de Casteljau; a straight-segment approximation of each half keeps the
    // network watertight and is visually indistinguishable at street scale.
    const half1 = this.createEdge({
      a: edge.a,
      b: node.id,
      kind: edge.kind,
      oneWay: edge.oneWay,
      control: null,
    });
    const half2 = this.createEdge({
      a: node.id,
      b: edge.b,
      kind: edge.kind,
      oneWay: edge.oneWay,
      control: null,
    });
    change.addedEdges.push(half1.id, half2.id);
    return node;
  }

  private createNode(x: number, z: number): RoadNode {
    const node: RoadNode = {
      id: this.nextNodeId++,
      x,
      z,
      y: this.field.heightAt(x, z) + ROAD_SURFACE_LIFT,
      edges: [],
    };
    this.nodes.set(node.id, node);
    this.rememberedNodes.set(node.id, { x, z });
    this.hashAdd(this.nodeHash, hashKey(x, z), node.id);
    return node;
  }

  private restoreNode(id: number, x: number, z: number): void {
    if (this.nodes.has(id)) return;
    const node: RoadNode = {
      id,
      x,
      z,
      y: this.field.heightAt(x, z) + ROAD_SURFACE_LIFT,
      edges: [],
    };
    this.nodes.set(id, node);
    this.hashAdd(this.nodeHash, hashKey(x, z), id);
  }

  private createEdge(spec: EdgeSpec): RoadEdge {
    const id = this.nextEdgeId++;
    return this.instantiateEdge(id, spec);
  }

  private restoreEdge(id: number, spec: EdgeSpec): void {
    if (this.edges.has(id)) return;
    if (!this.nodes.has(spec.a) || !this.nodes.has(spec.b)) return;
    this.instantiateEdge(id, spec);
  }

  private instantiateEdge(id: number, spec: EdgeSpec): RoadEdge {
    const a = this.nodes.get(spec.a)!;
    const b = this.nodes.get(spec.b)!;
    const { points, deck, length } = this.sampleCenterline(a, b, spec.control);
    const edge: RoadEdge = {
      id,
      a: spec.a,
      b: spec.b,
      kind: spec.kind,
      oneWay: spec.oneWay,
      control: spec.control,
      points,
      deck,
      length,
      congestion: 1,
    };
    this.edges.set(id, edge);
    this.rememberedEdges.set(id, spec);
    a.edges.push(id);
    b.edges.push(id);
    // Register every sample cell so snapEdge only scans nearby edges.
    const cells = new Set<number>();
    for (let i = 0; i < points.length; i += 3) {
      cells.add(hashKey(points[i], points[i + 2]));
    }
    for (const cell of cells) this.hashAdd(this.edgeHash, cell, id);
    return edge;
  }

  private deleteEdge(edge: RoadEdge): void {
    this.edges.delete(edge.id);
    for (const nodeId of [edge.a, edge.b]) {
      const node = this.nodes.get(nodeId);
      if (node) {
        const at = node.edges.indexOf(edge.id);
        if (at >= 0) node.edges.splice(at, 1);
      }
    }
    const cells = new Set<number>();
    for (let i = 0; i < edge.points.length; i += 3) {
      cells.add(hashKey(edge.points[i], edge.points[i + 2]));
    }
    for (const cell of cells) this.hashRemove(this.edgeHash, cell, edge.id);
  }

  private deleteNode(node: RoadNode): void {
    this.nodes.delete(node.id);
    this.hashRemove(this.nodeHash, hashKey(node.x, node.z), node.id);
  }

  /**
   * Sample the centerline (straight or quadratic bezier) and classify each
   * sample: the deck follows terrain where close, becomes a bridge where
   * terrain falls away (valleys, water) and a tunnel where terrain rises
   * far above the chord line — bridges and tunnels emerge from context,
   * exactly like Cities: Skylines.
   */
  private sampleCenterline(
    a: RoadNode,
    b: RoadNode,
    control: { x: number; z: number } | null,
  ): { points: Float32Array; deck: Uint8Array; length: number } {
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    const approx = control
      ? Math.hypot(control.x - a.x, control.z - a.z) +
        Math.hypot(b.x - control.x, b.z - control.z)
      : chord;
    const samples = Math.max(2, Math.ceil(approx / ROAD_SAMPLE_SPACING) + 1);
    const points = new Float32Array(samples * 3);
    const deck = new Uint8Array(samples);

    const ya = a.y;
    const yb = b.y;
    let length = 0;
    let prevX = 0;
    let prevY = 0;
    let prevZ = 0;
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      let x: number;
      let z: number;
      if (control) {
        const u = 1 - t;
        x = u * u * a.x + 2 * u * t * control.x + t * t * b.x;
        z = u * u * a.z + 2 * u * t * control.z + t * t * b.z;
      } else {
        x = a.x + (b.x - a.x) * t;
        z = a.z + (b.z - a.z) * t;
      }
      const terrain = this.field.heightAt(x, z) + ROAD_SURFACE_LIFT;
      const chordY = ya + (yb - ya) * t;
      let y: number;
      if (terrain < chordY - BRIDGE_CLEARANCE) {
        y = chordY;
        deck[i] = SAMPLE_BRIDGE;
      } else if (terrain > chordY + TUNNEL_DEPTH) {
        y = chordY;
        deck[i] = SAMPLE_TUNNEL;
      } else {
        y = terrain;
        deck[i] = SAMPLE_GROUND;
      }
      points[i * 3] = x;
      points[i * 3 + 1] = y;
      points[i * 3 + 2] = z;
      if (i > 0) length += Math.hypot(x - prevX, y - prevY, z - prevZ);
      prevX = x;
      prevY = y;
      prevZ = z;
    }
    return { points, deck, length };
  }

  private hashAdd(map: Map<number, Set<number>>, key: number, id: number): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  }

  private hashRemove(map: Map<number, Set<number>>, key: number, id: number): void {
    const set = map.get(key);
    if (set) {
      set.delete(id);
      if (set.size === 0) map.delete(key);
    }
  }

  private forEachInHash(
    map: Map<number, Set<number>>,
    x: number,
    z: number,
    radius: number,
    fn: (id: number) => void,
  ): void {
    const c0x = Math.floor((x - radius) / HASH_CELL);
    const c1x = Math.floor((x + radius) / HASH_CELL);
    const c0z = Math.floor((z - radius) / HASH_CELL);
    const c1z = Math.floor((z + radius) / HASH_CELL);
    const seen = new Set<number>();
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const set = map.get(((cx + 0x8000) << 16) | ((cz + 0x8000) & 0xffff));
        if (!set) continue;
        for (const id of set) {
          if (!seen.has(id)) {
            seen.add(id);
            fn(id);
          }
        }
      }
    }
  }

  /** Estimated build cost of a prospective segment. */
  estimateCost(lengthMeters: number, kind: RoadKind): number {
    return Math.round(lengthMeters * ROAD_PROFILES[kind].costPerMeter);
  }
}

export const RoadNetworkToken = createToken<RoadNetwork>('roads.network');
