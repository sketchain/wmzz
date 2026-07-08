/**
 * Central tuning constants. Data-driven gameplay definitions (building
 * prototypes, road profiles, economy curves) will live in src/data/ as the
 * corresponding phases land; this file only holds engine-level knobs.
 */
export const GameConfig = {
  simulation: {
    /** Fixed simulation ticks per second. */
    tickRate: 30,
    /** Max fixed ticks per rendered frame before time is dropped. */
    maxCatchUpTicks: 5,
    /** Selectable game speeds (Cities: Skylines style 1×/2×/4×). */
    speedLevels: [1, 2, 4] as readonly number[],
  },
  world: {
    /** Initial entity capacity hint (storages grow beyond this on demand). */
    initialEntityCapacity: 65536,
    /** Terrain chunk edge length in meters (Phase 3). */
    chunkSize: 64,
  },
  rendering: {
    /** Camera far plane in meters (Phase 2). */
    farPlane: 4000,
    /** Prefer WebGPU, transparently fall back to WebGL2 (Phase 2). */
    preferWebGPU: true,
    /** Bloom + FXAA post chain (TSL, both backends). */
    postProcessing: true,
  },
  persistence: {
    databaseName: 'wmzz-city',
    /** Bumped on breaking save-schema changes; migrations keyed off this. */
    saveVersion: 1,
    autoSaveIntervalSeconds: 120,
  },
  commands: {
    undoHistoryLimit: 256,
  },
} as const;

export type GameConfigType = typeof GameConfig;
