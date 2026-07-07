import * as THREE from 'three';
import {
  ROAD_PROFILES,
  ROAD_SURFACE_LIFT,
} from './RoadTypes';
import {
  SAMPLE_BRIDGE,
  SAMPLE_TUNNEL,
  type RoadEdge,
  type RoadNode,
} from './RoadNetwork';
import type { HeightField } from '@/terrain/HeightField';

const COLOR_ASPHALT = new THREE.Color(0x3a3d42);
const COLOR_BRIDGE = new THREE.Color(0x484c54);
const COLOR_SIDEWALK = new THREE.Color(0x9b9b97);
const COLOR_WHITE = new THREE.Color(0xe8e8e6);
const COLOR_YELLOW = new THREE.Color(0xd8b13c);
const COLOR_PILLAR = new THREE.Color(0x767a82);
const COLOR_RAIL = new THREE.Color(0xb8bcc2);
const COLOR_PORTAL = new THREE.Color(0x55585e);

/** Incremental triangle-soup builder with position/normal/color streams. */
class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  /** Add a quad (a,b,c,d counter-clockwise seen from the normal side). */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    color: THREE.Color,
    nx = 0, ny = 1, nz = 0,
  ): void {
    const base = this.positions.length / 3;
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    for (let i = 0; i < 4; i++) {
      this.normals.push(nx, ny, nz);
      this.colors.push(color.r, color.g, color.b);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned box (for pillars/portals). */
  box(
    cx: number, y0: number, y1: number, cz: number,
    halfX: number, halfZ: number,
    color: THREE.Color,
  ): void {
    const x0 = cx - halfX;
    const x1 = cx + halfX;
    const z0 = cz - halfZ;
    const z1 = cz + halfZ;
    // top
    this.quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, color, 0, 1, 0);
    // sides
    this.quad(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0, color, 0, 0, -1);
    this.quad(x1, y0, z1, x1, y1, z1, x0, y1, z1, x0, y0, z1, color, 0, 0, 1);
    this.quad(x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0, color, -1, 0, 0);
    this.quad(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1, color, 1, 0, 0);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

interface StripSpec {
  offset: number; // lateral center offset from centerline
  width: number;
  lift: number;
  color: THREE.Color;
  /** Dash pattern [on, off] meters, or null for solid. */
  dash: [number, number] | null;
  /** Skip on bridges (sidewalks are replaced by rails). */
  onBridge: boolean;
}

/**
 * Extrudes a road edge into one vertex-colored geometry: asphalt bed,
 * sidewalks, lane markings, plus bridge rails/pillars and tunnel portals.
 * Tunnel samples emit no surface geometry (portal boxes mark transitions).
 */
export function buildEdgeGeometry(edge: RoadEdge, field: HeightField): THREE.BufferGeometry {
  const profile = ROAD_PROFILES[edge.kind];
  const half = profile.width / 2;
  const builder = new MeshBuilder();
  const points = edge.points;
  const deck = edge.deck;
  const count = points.length / 3;

  const strips: StripSpec[] = [
    { offset: 0, width: profile.width, lift: 0, color: COLOR_ASPHALT, dash: null, onBridge: true },
  ];
  if (profile.sidewalk > 0) {
    strips.push(
      { offset: half + profile.sidewalk / 2, width: profile.sidewalk, lift: 0.14, color: COLOR_SIDEWALK, dash: null, onBridge: false },
      { offset: -half - profile.sidewalk / 2, width: profile.sidewalk, lift: 0.14, color: COLOR_SIDEWALK, dash: null, onBridge: false },
    );
  }
  // Edge lines.
  strips.push(
    { offset: half - 0.35, width: 0.18, lift: 0.03, color: COLOR_WHITE, dash: null, onBridge: true },
    { offset: -half + 0.35, width: 0.18, lift: 0.03, color: COLOR_WHITE, dash: null, onBridge: true },
  );
  // Center separation: double yellow for two-way, none for one-way.
  if (!edge.oneWay) {
    strips.push(
      { offset: 0.14, width: 0.12, lift: 0.03, color: COLOR_YELLOW, dash: null, onBridge: true },
      { offset: -0.14, width: 0.12, lift: 0.03, color: COLOR_YELLOW, dash: null, onBridge: true },
    );
  }
  // Dashed lane boundaries inside each direction.
  const laneWidth = (half - 0.35) / profile.lanesPerDirection;
  for (let lane = 1; lane < profile.lanesPerDirection; lane++) {
    const off = lane * laneWidth;
    strips.push(
      { offset: off, width: 0.14, lift: 0.03, color: COLOR_WHITE, dash: [3, 3], onBridge: true },
      { offset: -off, width: 0.14, lift: 0.03, color: COLOR_WHITE, dash: [3, 3], onBridge: true },
    );
  }

  // Per-sample tangent/lateral frames.
  const lateralX = new Float32Array(count);
  const lateralZ = new Float32Array(count);
  const arc = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const i0 = Math.max(0, i - 1) * 3;
    const i1 = Math.min(count - 1, i + 1) * 3;
    let tx = points[i1] - points[i0];
    let tz = points[i1 + 2] - points[i0 + 2];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    lateralX[i] = -tz;
    lateralZ[i] = tx;
    if (i > 0) {
      arc[i] =
        arc[i - 1] +
        Math.hypot(
          points[i * 3] - points[(i - 1) * 3],
          points[i * 3 + 2] - points[(i - 1) * 3 + 2],
        );
    }
  }

  for (const strip of strips) {
    for (let i = 0; i < count - 1; i++) {
      if (deck[i] === SAMPLE_TUNNEL || deck[i + 1] === SAMPLE_TUNNEL) continue;
      const bridgeSeg = deck[i] === SAMPLE_BRIDGE || deck[i + 1] === SAMPLE_BRIDGE;
      if (bridgeSeg && !strip.onBridge) continue;
      if (strip.dash) {
        const [on, off] = strip.dash;
        const phase = arc[i] % (on + off);
        if (phase >= on) continue;
      }
      const halfW = strip.width / 2;
      const color =
        strip.color === COLOR_ASPHALT && bridgeSeg ? COLOR_BRIDGE : strip.color;
      const ax = points[i * 3] + lateralX[i] * (strip.offset - halfW);
      const az = points[i * 3 + 2] + lateralZ[i] * (strip.offset - halfW);
      const bx = points[i * 3] + lateralX[i] * (strip.offset + halfW);
      const bz = points[i * 3 + 2] + lateralZ[i] * (strip.offset + halfW);
      const cx = points[(i + 1) * 3] + lateralX[i + 1] * (strip.offset + halfW);
      const cz = points[(i + 1) * 3 + 2] + lateralZ[i + 1] * (strip.offset + halfW);
      const dx = points[(i + 1) * 3] + lateralX[i + 1] * (strip.offset - halfW);
      const dz = points[(i + 1) * 3 + 2] + lateralZ[i + 1] * (strip.offset - halfW);
      const ay = points[i * 3 + 1] + strip.lift;
      const cy = points[(i + 1) * 3 + 1] + strip.lift;
      builder.quad(ax, ay, az, bx, ay, bz, cx, cy, cz, dx, cy, dz, color);
    }
  }

  // Bridge furniture: side rails + pillars down to terrain.
  let sincePillar = 0;
  for (let i = 0; i < count - 1; i++) {
    const bridgeSeg = deck[i] === SAMPLE_BRIDGE && deck[i + 1] === SAMPLE_BRIDGE;
    if (!bridgeSeg) {
      sincePillar = 12; // place a pillar soon after entering the next bridge
      continue;
    }
    const y0 = points[i * 3 + 1];
    const y1 = points[(i + 1) * 3 + 1];
    for (const side of [half + 0.2, -half - 0.2]) {
      const ax = points[i * 3] + lateralX[i] * side;
      const az = points[i * 3 + 2] + lateralZ[i] * side;
      const bx = points[(i + 1) * 3] + lateralX[i + 1] * side;
      const bz = points[(i + 1) * 3 + 2] + lateralZ[i + 1] * side;
      builder.quad(
        ax, y0, az,
        ax, y0 + 1.1, az,
        bx, y1 + 1.1, bz,
        bx, y1, bz,
        COLOR_RAIL,
        lateralX[i] * Math.sign(side), 0, lateralZ[i] * Math.sign(side),
      );
    }
    sincePillar += arc[i + 1] - arc[i];
    if (sincePillar >= 24) {
      sincePillar = 0;
      const px = points[i * 3];
      const pz = points[i * 3 + 2];
      const ground = field.heightAt(px, pz) - 1;
      builder.box(px, ground, y0 - 0.2, pz, 0.9, 0.9, COLOR_PILLAR);
    }
  }

  // Tunnel portals at ground↔tunnel transitions.
  for (let i = 0; i < count - 1; i++) {
    const enter = deck[i] !== SAMPLE_TUNNEL && deck[i + 1] === SAMPLE_TUNNEL;
    const exit = deck[i] === SAMPLE_TUNNEL && deck[i + 1] !== SAMPLE_TUNNEL;
    if (!enter && !exit) continue;
    const at = enter ? i : i + 1;
    const px = points[at * 3];
    const py = points[at * 3 + 1];
    const pz = points[at * 3 + 2];
    builder.box(px, py - 0.5, py + 5, pz, half + 1.2, 2.2, COLOR_PORTAL);
  }

  return builder.build();
}

/** Intersection patch: asphalt disc sized to the widest incident road. */
export function buildNodeGeometry(
  node: RoadNode,
  incidentEdges: RoadEdge[],
): THREE.BufferGeometry {
  let radius = 4;
  for (const edge of incidentEdges) {
    const profile = ROAD_PROFILES[edge.kind];
    radius = Math.max(radius, profile.width / 2 + profile.sidewalk + 0.4);
  }
  const segments = 18;
  const positions: number[] = [node.x, node.y + ROAD_SURFACE_LIFT * 0.3 + 0.05, node.z];
  const normals: number[] = [0, 1, 0];
  const colors: number[] = [COLOR_ASPHALT.r, COLOR_ASPHALT.g, COLOR_ASPHALT.b];
  const indices: number[] = [];
  for (let s = 0; s <= segments; s++) {
    const angle = (s / segments) * Math.PI * 2;
    positions.push(
      node.x + Math.cos(angle) * radius,
      node.y + ROAD_SURFACE_LIFT * 0.3 + 0.05,
      node.z + Math.sin(angle) * radius,
    );
    normals.push(0, 1, 0);
    colors.push(COLOR_ASPHALT.r, COLOR_ASPHALT.g, COLOR_ASPHALT.b);
    if (s > 0) indices.push(0, s + 1, s);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
