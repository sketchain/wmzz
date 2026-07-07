import * as THREE from 'three';
import { createToken, type Disposable } from '@/core/di/ServiceContainer';
import type { RendererService } from '@/engine/renderer/RendererService';
import type { HeightField } from '@/terrain/HeightField';
import { buildEdgeGeometry, buildNodeGeometry } from './RoadMesher';
import type { RoadNetwork } from './RoadNetwork';

/**
 * Keeps one mesh per road edge / intersection node in sync with the
 * network. Edges are immutable after creation, so sync is pure id diffing;
 * node patches rebuild when their incident-edge signature changes.
 */
export class RoadRenderer implements Disposable {
  readonly group = new THREE.Group();

  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide, // rails/pillars stay visible from both banks
  });
  private readonly edgeMeshes = new Map<number, THREE.Mesh>();
  private readonly nodeMeshes = new Map<number, THREE.Mesh>();
  private readonly nodeSignatures = new Map<number, string>();
  private lastVersion = -1;

  constructor(
    private readonly renderer: RendererService,
    private readonly network: RoadNetwork,
    private readonly field: HeightField,
  ) {
    this.group.name = 'roads';
    renderer.scene.add(this.group);
  }

  /** Diff meshes against the network; cheap no-op when version unchanged. */
  sync(): void {
    if (this.network.version === this.lastVersion) return;
    this.lastVersion = this.network.version;

    for (const [id, mesh] of this.edgeMeshes) {
      if (!this.network.edges.has(id)) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.edgeMeshes.delete(id);
      }
    }
    for (const edge of this.network.edges.values()) {
      if (!this.edgeMeshes.has(edge.id)) {
        const mesh = new THREE.Mesh(buildEdgeGeometry(edge, this.field), this.material);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.edgeMeshes.set(edge.id, mesh);
      }
    }

    for (const [id, mesh] of this.nodeMeshes) {
      if (!this.network.nodes.has(id)) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.nodeMeshes.delete(id);
        this.nodeSignatures.delete(id);
      }
    }
    for (const node of this.network.nodes.values()) {
      const signature = [...node.edges].sort((a, b) => a - b).join(',');
      if (this.nodeSignatures.get(node.id) === signature) continue;
      const previous = this.nodeMeshes.get(node.id);
      if (previous) {
        this.group.remove(previous);
        previous.geometry.dispose();
      }
      const incident = node.edges
        .map((id) => this.network.edges.get(id))
        .filter((edge): edge is NonNullable<typeof edge> => edge !== undefined);
      const mesh = new THREE.Mesh(buildNodeGeometry(node, incident), this.material);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.nodeMeshes.set(node.id, mesh);
      this.nodeSignatures.set(node.id, signature);
    }
  }

  dispose(): void {
    for (const mesh of this.edgeMeshes.values()) mesh.geometry.dispose();
    for (const mesh of this.nodeMeshes.values()) mesh.geometry.dispose();
    this.edgeMeshes.clear();
    this.nodeMeshes.clear();
    this.material.dispose();
    this.renderer.scene.remove(this.group);
  }
}

export const RoadRendererToken = createToken<RoadRenderer>('roads.renderer');
