import * as THREE from 'three';
import { System, SystemStage, type World } from '@/core/ecs';
import { Transform } from '@/engine/components';
import type { RendererService } from '@/engine/renderer/RendererService';
import {
  GROWABLES,
  SERVICES,
  SERVICE_ORDER,
  type ZoneId,
} from '@/data/buildingPrototypes';
import { Building, ServiceBuilding, UnderConstruction } from '../components';
import type { BuildingFactory } from '../BuildingFactory';

type Variant = 'house' | 'apartment' | 'shop' | 'factory' | 'office' | 'service' | 'site';
const VARIANTS: Variant[] = ['house', 'apartment', 'shop', 'factory', 'office', 'service', 'site'];

function makeVariantGeometry(variant: Variant): THREE.BufferGeometry {
  switch (variant) {
    case 'house': {
      const body = new THREE.BoxGeometry(1, 0.7, 1);
      body.translate(0, 0.35, 0);
      const roof = new THREE.ConeGeometry(0.78, 0.45, 4);
      roof.rotateY(Math.PI / 4);
      roof.translate(0, 0.925, 0);
      return mergeSimple([body, roof]);
    }
    case 'factory': {
      const hall = new THREE.BoxGeometry(1, 0.75, 1);
      hall.translate(0, 0.375, 0);
      const stack = new THREE.CylinderGeometry(0.08, 0.1, 0.6, 6);
      stack.translate(0.3, 1.0, 0.3);
      return mergeSimple([hall, stack]);
    }
    case 'site': {
      const slab = new THREE.BoxGeometry(1, 0.12, 1);
      slab.translate(0, 0.06, 0);
      const crane = new THREE.BoxGeometry(0.08, 1, 0.08);
      crane.translate(-0.3, 0.5, -0.3);
      return mergeSimple([slab, crane]);
    }
    default: {
      const tower = new THREE.BoxGeometry(1, 1, 1);
      tower.translate(0, 0.5, 0);
      return tower;
    }
  }
}

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of nonIndexed) total += g.attributes.position.count;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  let offset = 0;
  for (const g of nonIndexed) {
    positions.set(g.attributes.position.array as Float32Array, offset * 3);
    normals.set(g.attributes.normal.array as Float32Array, offset * 3);
    offset += g.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.computeBoundingSphere();
  for (const g of nonIndexed) g.dispose();
  return merged;
}

interface InstanceData {
  matrices: number[];
  colors: number[];
}

/**
 * Draws every building as GPU instances — one InstancedMesh (= one draw
 * call) per visual variant. Meshes are rebuilt from scratch whenever the
 * building set changes: buildings change a few times per second at most,
 * and recreating sidesteps WebGPURenderer's caching of instance counts and
 * late-added instanceColor attributes (mutating them on a live mesh renders
 * stale state on the WebGL2 backend).
 */
export class BuildingRenderSystem extends System {
  readonly name = 'BuildingRenderSystem';
  override readonly stage = SystemStage.Render;
  override readonly order = 10;

  private readonly geometries = new Map<Variant, THREE.BufferGeometry>();
  private readonly meshes = new Map<Variant, THREE.InstancedMesh>();
  private material!: THREE.MeshStandardMaterial;
  private lastVersion = -1;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();

  constructor(
    private readonly renderer: RendererService,
    private readonly factory: BuildingFactory,
  ) {
    super();
  }

  override init(): void {
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 });
    for (const variant of VARIANTS) {
      this.geometries.set(variant, makeVariantGeometry(variant));
    }
  }

  update(world: World): void {
    if (this.factory.version === this.lastVersion) return;
    this.lastVersion = this.factory.version;

    const data = new Map<Variant, InstanceData>();
    for (const variant of VARIANTS) data.set(variant, { matrices: [], colors: [] });

    const query = world.query({ all: [Building, Transform] });
    const buildings = world.soa(Building);
    const services = world.soa(ServiceBuilding);
    const transforms = world.soa(Transform);
    const entities = query.entities;
    const total = query.size;

    for (let i = 0; i < total; i++) {
      const entity = entities[i];
      const index = entity & 0xffffff;
      const b = buildings.denseIndexOf(index);
      const t = transforms.denseIndexOf(index);
      const zone = buildings.fields.zone[b];
      const level = buildings.fields.level[b];

      let variant: Variant;
      let width: number;
      let depth: number;
      let height: number;

      if (world.hasComponent(entity, UnderConstruction)) {
        variant = 'site';
        width = 7;
        depth = 7;
        height = 4;
        this.color.setHex(0xb0a58a);
      } else if (zone === 0) {
        variant = 'service';
        const s = services.denseIndexOf(index);
        const spec = SERVICES[SERVICE_ORDER[services.fields.serviceIndex[s]]];
        width = spec.size.w;
        depth = spec.size.d;
        height = spec.size.h;
        this.color.setHex(spec.color);
      } else {
        const spec = GROWABLES[zone as Exclude<ZoneId, 0>];
        variant = spec.variant === 'house' && level >= 3 ? 'apartment' : spec.variant;
        const levelSpec = spec.levels[level - 1];
        width = 6.4;
        depth = 6.4;
        height = levelSpec.height;
        // Higher levels shade brighter — reads as prosperity at a glance.
        this.color.setHex(spec.baseColor).multiplyScalar(0.75 + level * 0.06);
      }

      const bucket = data.get(variant)!;
      this.position.set(transforms.fields.x[t], transforms.fields.y[t], transforms.fields.z[t]);
      this.quaternion.setFromAxisAngle(this.up, transforms.fields.rot[t]);
      this.scale.set(width, height, depth);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      for (let m = 0; m < 16; m++) bucket.matrices.push(this.matrix.elements[m]);
      bucket.colors.push(this.color.r, this.color.g, this.color.b);
    }

    for (const variant of VARIANTS) {
      const previous = this.meshes.get(variant);
      if (previous) {
        this.renderer.scene.remove(previous);
        previous.dispose();
        this.meshes.delete(variant);
      }
      const bucket = data.get(variant)!;
      const count = bucket.colors.length / 3;
      if (count === 0) continue;
      const mesh = new THREE.InstancedMesh(this.geometries.get(variant)!, this.material, count);
      mesh.name = `buildings:${variant}`;
      (mesh.instanceMatrix.array as Float32Array).set(bucket.matrices);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(bucket.colors),
        3,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances span the whole city
      this.renderer.scene.add(mesh);
      this.meshes.set(variant, mesh);
    }
  }

  override dispose(): void {
    for (const mesh of this.meshes.values()) {
      this.renderer.scene.remove(mesh);
      mesh.dispose();
    }
    this.meshes.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    this.material?.dispose();
  }
}
