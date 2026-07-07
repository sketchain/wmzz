import * as THREE from 'three';
import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import type { RendererService } from '@/engine/renderer/RendererService';
import { Position, Velocity } from './Phase1Demo';

/**
 * Phase 2 smoke content: draws the Phase 1 particle swarm as one
 * InstancedMesh — the same ECS-SoA → instance-buffer path that buildings,
 * vehicles and trees use in later phases. One draw call for the whole swarm.
 */
export class ParticleRenderSystem extends System {
  readonly name = 'ParticleRenderSystem';
  override readonly stage = SystemStage.Render;
  override readonly order = 0;

  private mesh: THREE.InstancedMesh | null = null;
  private capacity = 0;
  private readonly matrix = new THREE.Matrix4();

  constructor(
    private readonly renderer: RendererService,
    private readonly maxInstances: number,
  ) {
    super();
  }

  override init(_world: World): void {
    const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const material = new THREE.MeshStandardMaterial({ color: 0x69a8ff, roughness: 0.55 });
    this.capacity = this.maxInstances;
    this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.renderer.scene.add(this.mesh);
  }

  update(world: World, _ctx: TickContext): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const query = world.query({ all: [Position, Velocity] });
    const store = world.soa(Position);
    const px = store.fields.x;
    const py = store.fields.y;
    const pz = store.fields.z;

    const count = Math.min(query.size, this.capacity);
    const entities = query.entities;
    const m = this.matrix;
    const array = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const dense = store.denseIndexOf(entities[i] & 0xffffff);
      m.makeTranslation(px[dense], py[dense], pz[dense]);
      m.toArray(array, i * 16);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  override dispose(_world: World): void {
    if (this.mesh) {
      this.renderer.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
  }
}
