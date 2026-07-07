export const TerrainConfig = {
  /** Meters between height samples (grid cell edge). */
  cellSize: 2,
  /** Cells per chunk edge → chunk is 64 m square. */
  chunkCells: 32,
  /** Sea surface height in meters. */
  seaLevel: 14,
  /** World generation seed (deterministic). */
  seed: 20260707,

  /** Chunk streaming radius (in chunks) around the camera target. */
  streamRadius: 14,
  /** Chunks farther than streamRadius + margin get unloaded. */
  unloadMargin: 3,
  /** Max chunk meshes (re)built per frame — bounds frame spikes. */
  maxBuildsPerFrame: 6,

  /** LOD step sizes in cells; distance thresholds in meters. */
  lod: [
    { maxDistance: 220, step: 1 },
    { maxDistance: 480, step: 2 },
    { maxDistance: Infinity, step: 4 },
  ],

  editing: {
    minBrushRadius: 4,
    maxBrushRadius: 60,
    defaultBrushRadius: 16,
    /** Meters of height change per second at full brush strength. */
    brushStrength: 18,
  },

  trees: {
    /** Max trees scattered per chunk. */
    maxPerChunk: 96,
    /** Forest density noise threshold in [0,1]; higher = sparser forests. */
    densityThreshold: 0.52,
    minAltitude: 15.5,
    maxAltitude: 70,
    maxSlope: 0.55,
  },
} as const;

export const CHUNK_SIZE = TerrainConfig.cellSize * TerrainConfig.chunkCells;

/** Pack signed chunk coords into one number key (range ±32767 chunks). */
export function chunkKey(cx: number, cz: number): number {
  return ((cx + 0x8000) << 16) | (cz + 0x8000);
}

export function chunkKeyX(key: number): number {
  return ((key >>> 16) & 0xffff) - 0x8000;
}

export function chunkKeyZ(key: number): number {
  return (key & 0xffff) - 0x8000;
}
