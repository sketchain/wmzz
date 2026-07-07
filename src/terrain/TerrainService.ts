import * as THREE from 'three';
import { createToken, type Disposable } from '@/core/di/ServiceContainer';
import { createLogger } from '@/core/utils/Logger';
import type { RendererService } from '@/engine/renderer/RendererService';
import { buildChunkGeometry } from './ChunkMesher';
import { buildChunkTrees } from './TreeScatter';
import { HeightField } from './HeightField';
import {
  CHUNK_SIZE,
  TerrainConfig,
  chunkKey,
  chunkKeyX,
  chunkKeyZ,
} from './TerrainConfig';

const log = createLogger('terrain');

interface LoadedChunk {
  key: number;
  cx: number;
  cz: number;
  lodStep: number;
  mesh: THREE.Mesh;
  trees: THREE.InstancedMesh | null;
  dirty: boolean;
}

/**
 * Owns loaded terrain chunks: streaming window, LOD selection, dirty
 * rebuilds after edits. The ChunkStreamingSystem drives `updateStreaming`
 * once per frame with the camera target; heavy mesh builds are budgeted per
 * frame to avoid spikes.
 */
export class TerrainService implements Disposable {
  readonly field: HeightField;
  readonly group = new THREE.Group();

  private readonly chunks = new Map<number, LoadedChunk>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly buildQueue: number[] = [];
  private readonly queued = new Set<number>();

  constructor(private readonly renderer: RendererService, field?: HeightField) {
    this.field = field ?? new HeightField();
    this.group.name = 'terrain';
    this.renderer.scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
  }

  get loadedChunkCount(): number {
    return this.chunks.size;
  }

  get pendingBuilds(): number {
    return this.buildQueue.length;
  }

  heightAt(x: number, z: number): number {
    return this.field.heightAt(x, z);
  }

  /** Stream chunks around (centerX, centerZ); call once per frame. */
  updateStreaming(centerX: number, centerZ: number): void {
    const ccx = Math.floor(centerX / CHUNK_SIZE);
    const ccz = Math.floor(centerZ / CHUNK_SIZE);
    const radius = TerrainConfig.streamRadius;

    // Enqueue missing / re-LOD chunks in the window.
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = chunkKey(cx, cz);
        const wanted = this.lodStepFor(cx, cz, centerX, centerZ);
        const existing = this.chunks.get(key);
        if (existing && existing.lodStep === wanted && !existing.dirty) continue;
        if (!this.queued.has(key)) {
          this.queued.add(key);
          this.buildQueue.push(key);
        }
      }
    }

    // Unload far chunks.
    const unloadRadius = radius + TerrainConfig.unloadMargin;
    for (const chunk of this.chunks.values()) {
      const dx = chunk.cx - ccx;
      const dz = chunk.cz - ccz;
      if (dx * dx + dz * dz > unloadRadius * unloadRadius) {
        this.unload(chunk.key);
      }
    }

    // Budgeted builds, nearest first.
    if (this.buildQueue.length > 0) {
      this.buildQueue.sort((a, b) => {
        const da = (chunkKeyX(a) - ccx) ** 2 + (chunkKeyZ(a) - ccz) ** 2;
        const db = (chunkKeyX(b) - ccx) ** 2 + (chunkKeyZ(b) - ccz) ** 2;
        return db - da; // farthest last → pop() takes nearest
      });
      let budget = TerrainConfig.maxBuildsPerFrame;
      while (budget > 0 && this.buildQueue.length > 0) {
        const key = this.buildQueue.pop()!;
        this.queued.delete(key);
        const cx = chunkKeyX(key);
        const cz = chunkKeyZ(key);
        // Skip if it left the window while queued.
        const dx = cx - ccx;
        const dz = cz - ccz;
        if (dx * dx + dz * dz > radius * radius) continue;
        this.buildChunk(cx, cz, this.lodStepFor(cx, cz, centerX, centerZ));
        budget--;
      }
    }
  }

  /** Mark chunks intersecting a world-space rectangle as needing rebuild. */
  invalidateRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const c0x = Math.floor((minX - 2) / CHUNK_SIZE);
    const c0z = Math.floor((minZ - 2) / CHUNK_SIZE);
    const c1x = Math.floor((maxX + 2) / CHUNK_SIZE);
    const c1z = Math.floor((maxZ + 2) / CHUNK_SIZE);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const chunk = this.chunks.get(chunkKey(cx, cz));
        if (chunk) chunk.dirty = true;
      }
    }
  }

  private lodStepFor(cx: number, cz: number, centerX: number, centerZ: number): number {
    const chunkCenterX = (cx + 0.5) * CHUNK_SIZE;
    const chunkCenterZ = (cz + 0.5) * CHUNK_SIZE;
    const distance = Math.hypot(chunkCenterX - centerX, chunkCenterZ - centerZ);
    for (const level of TerrainConfig.lod) {
      if (distance <= level.maxDistance) return level.step;
    }
    return TerrainConfig.lod[TerrainConfig.lod.length - 1].step;
  }

  private buildChunk(cx: number, cz: number, lodStep: number): void {
    const key = chunkKey(cx, cz);
    const previous = this.chunks.get(key);
    const geometry = buildChunkGeometry(this.field, cx, cz, lodStep);

    if (previous) {
      previous.mesh.geometry.dispose();
      previous.mesh.geometry = geometry;
      previous.lodStep = lodStep;
      previous.dirty = false;
      if (previous.trees) {
        this.group.remove(previous.trees);
        previous.trees.dispose();
      }
      previous.trees = this.attachTrees(cx, cz);
      return;
    }

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    this.chunks.set(key, {
      key,
      cx,
      cz,
      lodStep,
      mesh,
      trees: this.attachTrees(cx, cz),
      dirty: false,
    });
  }

  private attachTrees(cx: number, cz: number): THREE.InstancedMesh | null {
    const trees = buildChunkTrees(this.field, cx, cz);
    if (trees) {
      trees.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      this.group.add(trees);
    }
    return trees;
  }

  private unload(key: number): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.group.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    if (chunk.trees) {
      this.group.remove(chunk.trees);
      chunk.trees.dispose();
    }
    this.chunks.delete(key);
  }

  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.unload(key);
    this.material.dispose();
    this.renderer.scene.remove(this.group);
    log.info('terrain disposed');
  }
}

export const TerrainToken = createToken<TerrainService>('terrain.service');
