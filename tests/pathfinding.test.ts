import { describe, expect, it } from 'vitest';
import {
  HierarchicalPathfinder,
  RoadGraphIndex,
  type GraphSnapshot,
} from '../src/traffic/RoadGraphIndex';

/**
 * Grid test graph:
 *   1 - 2 - 3
 *   |   |   |
 *   4 - 5 - 6
 * Edge ids encode position; all length 100, speed 10 unless overridden.
 */
function gridSnapshot(): GraphSnapshot {
  const nodes: GraphSnapshot['nodes'] = [
    [1, 0, 0], [2, 100, 0], [3, 200, 0],
    [4, 0, 100], [5, 100, 100], [6, 200, 100],
  ];
  const edges: GraphSnapshot['edges'] = [
    [12, 1, 2, 100, 10, 0, 1],
    [23, 2, 3, 100, 10, 0, 1],
    [45, 4, 5, 100, 10, 0, 1],
    [56, 5, 6, 100, 10, 0, 1],
    [14, 1, 4, 100, 10, 0, 1],
    [25, 2, 5, 100, 10, 0, 1],
    [36, 3, 6, 100, 10, 0, 1],
  ];
  return { nodes, edges };
}

describe('RoadGraphIndex A*', () => {
  it('finds the shortest path on a grid', () => {
    const index = RoadGraphIndex.fromSnapshot(gridSnapshot());
    const path = index.findPath(1, 6);
    expect(path).not.toBeNull();
    expect(path!.nodes[0]).toBe(1);
    expect(path!.nodes[path!.nodes.length - 1]).toBe(6);
    expect(path!.nodes.length).toBe(4); // three hops
    expect(path!.cost).toBeCloseTo(30); // 300 m at 10 m/s
  });

  it('routes around congestion', () => {
    const snapshot = gridSnapshot();
    const index = RoadGraphIndex.fromSnapshot(snapshot);
    // Jam the top route 2-3 badly.
    index.setCongestion(23, 5);
    const path = index.findPath(1, 3);
    expect(path).not.toBeNull();
    // Any detour avoiding the jammed edge (cost 40 s) beats going through
    // it (20 s + 50 s jam = 70 s... direct 1-2-3 would be 10+50=60 s).
    expect(path!.edges).not.toContain(23);
    expect(path!.cost).toBeCloseTo(40);
  });

  it('respects one-way edges', () => {
    const snapshot = gridSnapshot();
    // Make 1→2 one-way (blocking 2→1).
    snapshot.edges[0] = [12, 1, 2, 100, 10, 1, 1];
    const index = RoadGraphIndex.fromSnapshot(snapshot);
    const forward = index.findPath(1, 2);
    expect(forward!.nodes).toEqual([1, 2]);
    const back = index.findPath(2, 1);
    // Must detour 2-5-4-1.
    expect(back!.nodes).toEqual([2, 5, 4, 1]);
  });

  it('returns null for unreachable goals', () => {
    const snapshot = gridSnapshot();
    snapshot.nodes.push([99, 999, 999]); // isolated node
    const index = RoadGraphIndex.fromSnapshot(snapshot);
    expect(index.findPath(1, 99)).toBeNull();
  });

  it('handles from === to', () => {
    const index = RoadGraphIndex.fromSnapshot(gridSnapshot());
    const path = index.findPath(3, 3);
    expect(path!.nodes).toEqual([3]);
    expect(path!.cost).toBe(0);
  });
});

describe('flow field', () => {
  it('gives every node an optimal next hop toward the target', () => {
    const index = RoadGraphIndex.fromSnapshot(gridSnapshot());
    const field = index.buildFlowField(6);
    // Walk from node 1 along the field; must reach 6 within 5 hops.
    let cursor = 1;
    const visited: number[] = [cursor];
    for (let i = 0; i < 5 && cursor !== 6; i++) {
      const step = field.get(cursor);
      expect(step).toBeDefined();
      cursor = step!.next;
      visited.push(cursor);
    }
    expect(cursor).toBe(6);
    expect(visited.length).toBeLessThanOrEqual(4);
  });

  it('flow field respects one-way restrictions', () => {
    const snapshot = gridSnapshot();
    snapshot.edges[3] = [56, 5, 6, 100, 10, 1, 1]; // 5→6 one-way
    const index = RoadGraphIndex.fromSnapshot(snapshot);
    const field = index.buildFlowField(5);
    // From 6, the only way to 5 is via 3-2 or via 6→3→2→5 (edge 56 is blocked backwards).
    const step = field.get(6);
    expect(step).toBeDefined();
    expect(step!.next).not.toBe(5);
  });
});

describe('HierarchicalPathfinder', () => {
  it('matches flat A* results on small graphs', () => {
    const snapshot = gridSnapshot();
    const index = RoadGraphIndex.fromSnapshot(snapshot);
    const hierarchical = new HierarchicalPathfinder(index, snapshot);
    const flat = index.findPath(1, 6)!;
    const hier = hierarchical.findPath(1, 6)!;
    expect(hier.cost).toBeCloseTo(flat.cost);
  });

  it('builds cluster abstraction for large graphs', () => {
    // 20×20 grid, 400 nodes → above the flat threshold.
    const nodes: GraphSnapshot['nodes'] = [];
    const edges: GraphSnapshot['edges'] = [];
    const id = (x: number, y: number): number => y * 20 + x + 1;
    let edgeId = 1;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        nodes.push([id(x, y), x * 100, y * 100]);
        if (x > 0) edges.push([edgeId++, id(x - 1, y), id(x, y), 100, 10, 0, 1]);
        if (y > 0) edges.push([edgeId++, id(x, y - 1), id(x, y), 100, 10, 0, 1]);
      }
    }
    const snapshot: GraphSnapshot = { nodes, edges };
    const index = RoadGraphIndex.fromSnapshot(snapshot);
    const hierarchical = new HierarchicalPathfinder(index, snapshot);
    const path = hierarchical.findPath(id(0, 0), id(19, 19));
    expect(path).not.toBeNull();
    expect(path!.nodes.length).toBe(39); // manhattan distance 38 hops
    expect(hierarchical.stats.clusters).toBeGreaterThan(1);
    expect(hierarchical.stats.borders).toBeGreaterThan(0);
  });
});
