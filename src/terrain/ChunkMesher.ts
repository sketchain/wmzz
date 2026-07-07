import * as THREE from 'three';
import type { HeightField } from './HeightField';
import { TerrainConfig } from './TerrainConfig';

const COLOR_SAND = new THREE.Color(0xcfc08a);
const COLOR_GRASS = new THREE.Color(0x5d8a4a);
const COLOR_DRY = new THREE.Color(0x8a9a52);
const COLOR_ROCK = new THREE.Color(0x8a8378);
const COLOR_SNOW = new THREE.Color(0xe8ecf0);
const COLOR_DIRT = new THREE.Color(0x7a6242);
const COLOR_PAVEMENT = new THREE.Color(0x9a9a98);
const tmpColor = new THREE.Color();

function biomeColor(height: number, slope: number, out: THREE.Color): THREE.Color {
  const sea = TerrainConfig.seaLevel;
  if (height < sea + 1.2) {
    out.copy(COLOR_SAND);
  } else if (height > 85) {
    out.copy(COLOR_SNOW);
  } else if (height > 55) {
    out.copy(COLOR_ROCK).lerp(COLOR_SNOW, (height - 55) / 60);
  } else {
    out.copy(COLOR_GRASS).lerp(COLOR_DRY, Math.min(1, Math.max(0, (height - 30) / 30)));
  }
  if (slope > 0.45 && height >= sea + 1.2) {
    out.lerp(COLOR_ROCK, Math.min(1, (slope - 0.45) / 0.5));
  }
  return out;
}

/**
 * Builds one chunk's ground geometry at a given LOD step.
 *
 * The height field is sampled exactly once into a padded grid; positions,
 * normals (central differences) and slope all derive from that grid — noise
 * evaluation dominates build cost, so the sample count is the budget.
 * Vertex colors carry biome + paint. A one-ring skirt sinks below the border
 * to mask cracks between neighboring chunks at different LOD steps.
 */
export function buildChunkGeometry(
  field: HeightField,
  cx: number,
  cz: number,
  step: number,
): THREE.BufferGeometry {
  const cells = TerrainConfig.chunkCells;
  const cellSize = TerrainConfig.cellSize;
  const verts = cells / step + 1; // interior grid per edge
  const total = verts + 2; // plus skirt ring
  const skirtDepth = 3 + step * 2;
  const spacing = step * cellSize;

  const baseVX = cx * cells;
  const baseVZ = cz * cells;

  // Padded sample grid: interior coords -1..verts (one beyond each side).
  const pad = verts + 2;
  const samples = new Float64Array(pad * pad);
  for (let gz = 0; gz < pad; gz++) {
    for (let gx = 0; gx < pad; gx++) {
      samples[gz * pad + gx] = field.vertexHeight(
        baseVX + (gx - 1) * step,
        baseVZ + (gz - 1) * step,
      );
    }
  }
  const sampleAt = (ix: number, iz: number): number =>
    samples[(iz + 1) * pad + (ix + 1)];

  const positions = new Float32Array(total * total * 3);
  const colors = new Float32Array(total * total * 3);
  const normals = new Float32Array(total * total * 3);
  const indices =
    total * total < 65536
      ? new Uint16Array((total - 1) * (total - 1) * 6)
      : new Uint32Array((total - 1) * (total - 1) * 6);

  for (let gz = 0; gz < total; gz++) {
    for (let gx = 0; gx < total; gx++) {
      // Skirt ring clones the border vertex, sunk by skirtDepth.
      const ix = Math.min(Math.max(gx - 1, 0), verts - 1);
      const iz = Math.min(Math.max(gz - 1, 0), verts - 1);
      const isSkirt = gx === 0 || gz === 0 || gx === total - 1 || gz === total - 1;

      const height = sampleAt(ix, iz);
      const i3 = (gz * total + gx) * 3;
      positions[i3] = ix * spacing;
      positions[i3 + 1] = isSkirt ? height - skirtDepth : height;
      positions[i3 + 2] = iz * spacing;

      const hL = sampleAt(ix - 1, iz);
      const hR = sampleAt(ix + 1, iz);
      const hD = sampleAt(ix, iz - 1);
      const hU = sampleAt(ix, iz + 1);
      const nx = hL - hR;
      const ny = 2 * spacing;
      const nz = hD - hU;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      normals[i3] = nx * invLen;
      normals[i3 + 1] = ny * invLen;
      normals[i3 + 2] = nz * invLen;

      const slope = Math.hypot(hR - hL, hU - hD) / (4 * spacing);
      biomeColor(height, slope, tmpColor);
      const paint = field.paintAt(baseVX + ix * step, baseVZ + iz * step);
      if (paint === 1) tmpColor.lerp(COLOR_DIRT, 0.85);
      else if (paint === 2) tmpColor.lerp(COLOR_PAVEMENT, 0.9);
      colors[i3] = tmpColor.r;
      colors[i3 + 1] = tmpColor.g;
      colors[i3 + 2] = tmpColor.b;
    }
  }

  let write = 0;
  for (let gz = 0; gz < total - 1; gz++) {
    for (let gx = 0; gx < total - 1; gx++) {
      const a = gz * total + gx;
      const b = a + 1;
      const c = a + total;
      const d = c + 1;
      indices[write++] = a;
      indices[write++] = c;
      indices[write++] = b;
      indices[write++] = b;
      indices[write++] = c;
      indices[write++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
