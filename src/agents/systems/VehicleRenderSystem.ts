import * as THREE from 'three';
import { System, SystemStage, type World } from '@/core/ecs';
import { Transform } from '@/engine/components';
import type { RendererService } from '@/engine/renderer/RendererService';
import { Vehicle, VehicleState } from '../components';

const CAPACITY_STEP = 2048;
const CAR_COLORS = [0xd8d8d8, 0x374757, 0x8a2f2f, 0x2f5d8a, 0xc9a53f, 0x3f6b3f];

/**
 * Instanced car rendering. The mesh is created at a fixed capacity and every
 * instance slot is written each frame — unused slots collapse to zero scale
 * instead of mutating `count` (WebGPURenderer caches instance counts, see
 * BuildingRenderSystem). Capacity grows by recreation when exceeded.
 */
export class VehicleRenderSystem extends System {
  readonly name = 'VehicleRenderSystem';
  override readonly stage = SystemStage.Render;
  override readonly order = 20;

  private mesh: THREE.InstancedMesh | null = null;
  private capacity = 0;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.MeshStandardMaterial;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  visibleCount = 0;

  constructor(private readonly renderer: RendererService) {
    super();
  }

  override init(): void {
    // Simple two-box car silhouette.
    const body = new THREE.BoxGeometry(1.8, 0.9, 4.2);
    body.translate(0, 0.45, 0);
    const cabin = new THREE.BoxGeometry(1.6, 0.7, 2.0);
    cabin.translate(0, 1.15, -0.2);
    const bodyNI = body.toNonIndexed();
    const cabinNI = cabin.toNonIndexed();
    const total = bodyNI.attributes.position.count + cabinNI.attributes.position.count;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    positions.set(bodyNI.attributes.position.array as Float32Array, 0);
    positions.set(
      cabinNI.attributes.position.array as Float32Array,
      bodyNI.attributes.position.count * 3,
    );
    normals.set(bodyNI.attributes.normal.array as Float32Array, 0);
    normals.set(
      cabinNI.attributes.normal.array as Float32Array,
      bodyNI.attributes.position.count * 3,
    );
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.computeBoundingSphere();
    body.dispose();
    cabin.dispose();
    bodyNI.dispose();
    cabinNI.dispose();
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5 });
    this.ensureCapacity(CAPACITY_STEP);
  }

  update(world: World): void {
    const vehicles = world.soa(Vehicle);
    const transforms = world.soa(Transform);
    const query = world.query({ all: [Vehicle, Transform] });
    const entities = query.entities;
    const count = query.size;
    if (count > this.capacity) this.ensureCapacity(count + CAPACITY_STEP);
    const mesh = this.mesh!;
    const array = mesh.instanceMatrix.array as Float32Array;

    let written = 0;
    for (let i = 0; i < count; i++) {
      const index = entities[i] & 0xffffff;
      const v = vehicles.denseIndexOf(index);
      if (vehicles.fields.state[v] === VehicleState.Parked) continue;
      const t = transforms.denseIndexOf(index);
      this.position.set(
        transforms.fields.x[t],
        transforms.fields.y[t],
        transforms.fields.z[t],
      );
      this.quaternion.setFromAxisAngle(this.up, transforms.fields.rot[t]);
      this.scale.setScalar(1);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.matrix.toArray(array, written * 16);
      written++;
    }
    this.visibleCount = written;
    for (let i = written; i < this.capacity; i++) {
      this.zero.toArray(array, i * 16);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.capacity && this.mesh) return;
    let capacity = Math.max(this.capacity, CAPACITY_STEP);
    while (capacity < needed) capacity += CAPACITY_STEP;
    if (this.mesh) {
      this.renderer.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.name = 'vehicles';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Deterministic per-slot paint colors, assigned once.
    const color = new THREE.Color();
    for (let i = 0; i < capacity; i++) {
      color.setHex(CAR_COLORS[i % CAR_COLORS.length]);
      this.mesh.setColorAt(i, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    const array = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < capacity; i++) this.zero.toArray(array, i * 16);
    this.renderer.scene.add(this.mesh);
    this.capacity = capacity;
  }

  override dispose(): void {
    if (this.mesh) {
      this.renderer.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    this.geometry?.dispose();
    this.material?.dispose();
  }
}
