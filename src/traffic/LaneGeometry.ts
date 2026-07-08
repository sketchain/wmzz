import type { RoadEdge } from '@/roads/RoadNetwork';
import { ROAD_PROFILES } from '@/roads/RoadTypes';

/**
 * Lane-level geometry over edge centerlines.
 *
 * Vehicles travel at a lateral offset from the centerline determined by
 * their lane and direction (right-hand traffic). `samplePosition` maps
 * (edge, arc-length s, direction, lane) → world position + heading.
 */

export interface LaneSample {
  x: number;
  y: number;
  z: number;
  /** Heading in radians (atan2(dx, dz) convention, matches Transform.rot). */
  heading: number;
}

/** Lateral offset in meters for a lane index (0 = innermost). */
export function laneOffset(edge: RoadEdge, lane: number): number {
  const profile = ROAD_PROFILES[edge.kind];
  const laneWidth = (profile.width / 2 - 0.4) / profile.lanesPerDirection;
  return laneWidth * (lane + 0.5) + 0.2;
}

export function lanesOf(edge: RoadEdge): number {
  return ROAD_PROFILES[edge.kind].lanesPerDirection;
}

export function speedOf(edge: RoadEdge): number {
  return ROAD_PROFILES[edge.kind].speed;
}

/**
 * Sample the lane position at arc-length `s` (meters from node `a`).
 * `forward` = travelling a→b. Right-hand traffic: offset flips with
 * direction so opposing flows use opposite sides of the centerline.
 */
export function samplePosition(
  edge: RoadEdge,
  s: number,
  forward: boolean,
  lane: number,
  out: LaneSample,
): LaneSample {
  const points = edge.points;
  const count = points.length / 3;
  const total = edge.length;
  const clamped = Math.min(Math.max(forward ? s : total - s, 0), total);

  // Uniform-ish samples: locate the segment by proportional arc length.
  const fIndex = (clamped / total) * (count - 1);
  const i0 = Math.min(Math.floor(fIndex), count - 2);
  const t = fIndex - i0;
  const i3 = i0 * 3;
  const j3 = i3 + 3;

  const x = points[i3] + (points[j3] - points[i3]) * t;
  const y = points[i3 + 1] + (points[j3 + 1] - points[i3 + 1]) * t;
  const z = points[i3 + 2] + (points[j3 + 2] - points[i3 + 2]) * t;

  let dx = points[j3] - points[i3];
  let dz = points[j3 + 2] - points[i3 + 2];
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  if (!forward) {
    dx = -dx;
    dz = -dz;
  }

  // Right side of travel direction: (dz, -dx).
  const offset = laneOffset(edge, lane);
  out.x = x + dz * offset;
  out.z = z - dx * offset;
  out.y = y + 0.25;
  out.heading = Math.atan2(dx, dz);
  return out;
}
