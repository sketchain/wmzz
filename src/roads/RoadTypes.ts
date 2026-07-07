/**
 * Data-driven road profiles. All road behavior (geometry widths, lanes,
 * speeds, costs) reads from these records — adding a road class is a data
 * change, not a code change.
 */
export type RoadKind = 'street' | 'avenue' | 'highway';

export interface RoadProfile {
  readonly kind: RoadKind;
  readonly label: string;
  /** Total asphalt width in meters. */
  readonly width: number;
  /** Sidewalk width each side (0 = none). */
  readonly sidewalk: number;
  /** Lanes per direction. */
  readonly lanesPerDirection: number;
  /** Design speed m/s (used by pathfinding cost). */
  readonly speed: number;
  /** Build cost per meter. */
  readonly costPerMeter: number;
  /** Upkeep per meter per month. */
  readonly upkeepPerMeter: number;
  /** Whether zoning cells attach to this road class. */
  readonly zoneable: boolean;
}

export const ROAD_PROFILES: Record<RoadKind, RoadProfile> = {
  street: {
    kind: 'street',
    label: '双向街道',
    width: 8,
    sidewalk: 2,
    lanesPerDirection: 1,
    speed: 11,
    costPerMeter: 12,
    upkeepPerMeter: 0.08,
    zoneable: true,
  },
  avenue: {
    kind: 'avenue',
    label: '四车道大道',
    width: 14,
    sidewalk: 2.5,
    lanesPerDirection: 2,
    speed: 16,
    costPerMeter: 26,
    upkeepPerMeter: 0.16,
    zoneable: true,
  },
  highway: {
    kind: 'highway',
    label: '高速公路',
    width: 12,
    sidewalk: 0,
    lanesPerDirection: 3,
    speed: 28,
    costPerMeter: 40,
    upkeepPerMeter: 0.25,
    zoneable: false,
  },
};

/** Sample spacing along centerlines in meters. */
export const ROAD_SAMPLE_SPACING = 6;
/** Road surface hovers this far above terrain to avoid z-fighting. */
export const ROAD_SURFACE_LIFT = 0.18;
/** A sample this far above terrain becomes a bridge (pillars + rails). */
export const BRIDGE_CLEARANCE = 2.5;
/** Terrain this far above the deck line turns the sample into tunnel. */
export const TUNNEL_DEPTH = 7;
/** Node snap radius in meters. */
export const NODE_SNAP_RADIUS = 9;
/** Edge snap (split) radius in meters. */
export const EDGE_SNAP_RADIUS = 6;
/** Max grade (rise/run) before a placement is rejected. */
export const MAX_ROAD_GRADE = 0.28;
