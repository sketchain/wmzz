import * as THREE from 'three';
import type { HeightField } from './HeightField';
import { CHUNK_SIZE, TerrainConfig } from './TerrainConfig';
import { createRng } from './createRng';

let sharedGeometry: THREE.BufferGeometry | null = null;
let sharedMaterial: THREE.Material | null = null;

/**
 * One merged low-poly tree (trunk + two foliage cones) with vertex colors —
 * a whole chunk's forest renders as a single InstancedMesh draw call.
 */
function treeGeometry(): THREE.BufferGeometry {
  if (sharedGeometry) return sharedGeometry;
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 5);
  trunk.translate(0, 0.8, 0);
  const lower = new THREE.ConeGeometry(1.7, 2.8, 6);
  lower.translate(0, 2.6, 0);
  const upper = new THREE.ConeGeometry(1.15, 2.2, 6);
  upper.translate(0, 4.2, 0);

  const paint = (geometry: THREE.BufferGeometry, color: THREE.Color): void => {
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  };
  paint(trunk, new THREE.Color(0x5a4430));
  paint(lower, new THREE.Color(0x2f5d33));
  paint(upper, new THREE.Color(0x3a7040));

  const merged = mergeGeometries([trunk, lower, upper]);
  trunk.dispose();
  lower.dispose();
  upper.dispose();
  sharedGeometry = merged;
  return merged;
}

/** Minimal non-indexed merge (avoids pulling in the whole BufferGeometryUtils). */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let vertexCount = 0;
  for (const g of nonIndexed) vertexCount += g.attributes.position.count;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  let offset = 0;
  for (const g of nonIndexed) {
    positions.set(g.attributes.position.array as Float32Array, offset * 3);
    normals.set(g.attributes.normal.array as Float32Array, offset * 3);
    colors.set(g.attributes.color.array as Float32Array, offset * 3);
    offset += g.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

function treeMaterial(): THREE.Material {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      flatShading: true,
    });
  }
  return sharedMaterial;
}

/**
 * Scatter trees for one chunk from the forest-density noise channel.
 * Deterministic per chunk (seeded by chunk coords). Returns null when the
 * chunk grows no forest. Positions respect player height edits.
 */
export function buildChunkTrees(
  field: HeightField,
  cx: number,
  cz: number,
): THREE.InstancedMesh | null {
  const cfg = TerrainConfig.trees;
  const rng = createRng((cx * 73856093) ^ (cz * 19349663) ^ field.seed);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  const placements: THREE.Matrix4[] = [];
  for (let i = 0; i < cfg.maxPerChunk; i++) {
    const lx = rng() * CHUNK_SIZE;
    const lz = rng() * CHUNK_SIZE;
    const x = cx * CHUNK_SIZE + lx;
    const z = cz * CHUNK_SIZE + lz;
    const density = field.forestDensity(x, z);
    if (density < cfg.densityThreshold) continue;
    // Denser forest → higher chance each candidate survives.
    if (rng() > (density - cfg.densityThreshold) * 4) continue;
    const height = field.heightAt(x, z);
    if (height < cfg.minAltitude || height > cfg.maxAltitude) continue;
    if (field.slopeAt(x, z) > cfg.maxSlope) continue;

    const s = 0.8 + rng() * 0.9;
    position.set(lx, height, lz);
    scale.set(s, s * (0.9 + rng() * 0.3), s);
    quaternion.setFromAxisAngle(up, rng() * Math.PI * 2);
    placements.push(matrix.compose(position, quaternion, scale).clone());
  }
  if (placements.length === 0) return null;

  const mesh = new THREE.InstancedMesh(treeGeometry(), treeMaterial(), placements.length);
  for (let i = 0; i < placements.length; i++) mesh.setMatrixAt(i, placements[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}
