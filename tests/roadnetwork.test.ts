import { beforeEach, describe, expect, it } from 'vitest';
import { HeightField } from '../src/terrain/HeightField';
import { RoadNetwork } from '../src/roads/RoadNetwork';

let field: HeightField;
let network: RoadNetwork;

beforeEach(() => {
  field = new HeightField(123);
  network = new RoadNetwork(field);
});

describe('RoadNetwork', () => {
  it('builds a road with two new nodes and one edge', () => {
    const change = network.addRoad(0, 0, 100, 0, 'street');
    expect(change.addedNodes.length).toBe(2);
    expect(change.addedEdges.length).toBe(1);
    expect(network.edges.size).toBe(1);
    const edge = network.edge(change.addedEdges[0])!;
    expect(edge.length).toBeGreaterThan(95);
    expect(edge.points.length / 3).toBeGreaterThan(2);
  });

  it('snaps endpoints to existing nodes', () => {
    const first = network.addRoad(0, 0, 100, 0, 'street');
    const second = network.addRoad(102, 2, 200, 0, 'street'); // within snap radius
    expect(second.addedNodes.length).toBe(1); // reused the existing end node
    const sharedNode = network.node(
      network.edge(second.addedEdges[0])!.a,
    )!;
    expect(sharedNode.edges.length).toBe(2);
    void first;
  });

  it('splits an edge when a road ends on it', () => {
    network.addRoad(0, 0, 200, 0, 'street');
    const change = network.addRoad(100, 80, 100, 2, 'street'); // T-junction
    // Original edge replaced by two halves + the new approach.
    expect(change.removedEdges.length).toBe(1);
    expect(network.edges.size).toBe(3);
    const junction = network.snapNode(100, 0, 12)!;
    expect(junction.edges.length).toBe(3);
  });

  it('revert/reapply round-trips a change including terrain grading', () => {
    network.addRoad(0, 0, 200, 0, 'street');
    const edgesBefore = network.edges.size;
    const deltasBefore = new Map(field.editDeltas);

    const change = network.addRoad(100, 80, 100, 2, 'street');
    expect(network.edges.size).toBe(3);
    expect(change.terrainEdits.length).toBeGreaterThan(0);

    network.revert(change);
    expect(network.edges.size).toBe(edgesBefore);
    expect(field.editDeltas.size).toBe(deltasBefore.size);
    for (const [key, value] of deltasBefore) {
      expect(field.editDeltas.get(key)).toBe(value);
    }

    network.reapply(change);
    expect(network.edges.size).toBe(3);
    expect(network.snapNode(100, 0, 12)!.edges.length).toBe(3);
  });

  it('roundabouts are one-way rings', () => {
    const change = network.buildRoundabout(0, 0);
    expect(change.addedNodes.length).toBe(8);
    expect(change.addedEdges.length).toBe(8);
    for (const id of change.addedEdges) {
      expect(network.edge(id)!.oneWay).toBe(true);
    }
  });

  it('removeEdge cleans up orphan nodes and can be reverted', () => {
    const built = network.addRoad(0, 0, 100, 0, 'street');
    const removal = network.removeEdge(built.addedEdges[0]);
    expect(network.edges.size).toBe(0);
    expect(network.nodes.size).toBe(0);
    expect(removal.removedNodes.length).toBe(2);

    network.revert(removal);
    expect(network.edges.size).toBe(1);
    expect(network.nodes.size).toBe(2);
  });

  it('serialize/deserialize round-trips the network', () => {
    network.addRoad(0, 0, 200, 0, 'avenue', { x: 100, z: 60 }, true);
    network.addRoad(200, 0, 300, 100, 'highway');
    const snapshot = network.serialize();

    // Real load order (SaveManager): terrain edits first, then roads —
    // centerlines resample against the graded terrain.
    const restoredField = new HeightField(123);
    for (const [key, value] of field.editDeltas) {
      restoredField.editDeltas.set(key, value);
    }
    const restored = new RoadNetwork(restoredField);
    restored.deserialize(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.edges.size).toBe(network.edges.size);
    expect(restored.nodes.size).toBe(network.nodes.size);
    for (const [id, edge] of network.edges) {
      const twin = restored.edge(id)!;
      expect(twin.kind).toBe(edge.kind);
      expect(twin.oneWay).toBe(edge.oneWay);
      // Restored centerlines resample against fully-graded terrain, while
      // originals were sampled pre-grading — allow a small length drift.
      expect(Math.abs(twin.length - edge.length) / edge.length).toBeLessThan(0.05);
    }
  });

  it('grades terrain flush with the roadbed', () => {
    const change = network.addRoad(0, 0, 120, 0, 'street');
    const edge = network.edge(change.addedEdges[0])!;
    // Sample mid-edge: terrain height must sit just below the deck.
    const mid = Math.floor(edge.points.length / 6) * 3;
    const x = edge.points[mid];
    const y = edge.points[mid + 1];
    const z = edge.points[mid + 2];
    expect(Math.abs(field.heightAt(x, z) - (y - 0.18))).toBeLessThan(0.35);
  });
});
