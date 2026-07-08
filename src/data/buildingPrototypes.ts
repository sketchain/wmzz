/**
 * Data-driven building definitions. Gameplay code never hardcodes building
 * numbers — growth, economy, utilities and rendering all read from here.
 */

export type ZoneId = 0 | 1 | 2 | 3 | 4; // none, residential, commercial, industrial, office
export const ZONE_NONE = 0 satisfies ZoneId;
export const ZONE_RESIDENTIAL = 1 satisfies ZoneId;
export const ZONE_COMMERCIAL = 2 satisfies ZoneId;
export const ZONE_INDUSTRIAL = 3 satisfies ZoneId;
export const ZONE_OFFICE = 4 satisfies ZoneId;

export const ZONE_LABELS: Record<ZoneId, string> = {
  0: '无',
  1: '住宅',
  2: '商业',
  3: '工业',
  4: '办公',
};

export interface LevelSpec {
  /** Residents (residential) or jobs (others) at this level. */
  capacity: number;
  /** Visual height in meters. */
  height: number;
  /** Monthly tax income at full occupancy. */
  tax: number;
  /** Power demand in kW. */
  power: number;
  /** Water demand in units. */
  water: number;
}

export interface GrowableSpec {
  zone: Exclude<ZoneId, 0>;
  /** Mesh archetype used by the renderer. */
  variant: 'house' | 'apartment' | 'shop' | 'factory' | 'office';
  levels: LevelSpec[]; // index 0 = level 1
  /** Pollution emitted at any level (industrial mostly). */
  pollution: number;
  /** Noise emitted. */
  noise: number;
  baseColor: number;
}

export const GROWABLES: Record<Exclude<ZoneId, 0>, GrowableSpec> = {
  [ZONE_RESIDENTIAL]: {
    zone: ZONE_RESIDENTIAL,
    variant: 'house',
    levels: [
      { capacity: 4, height: 5, tax: 10, power: 2, water: 2 },
      { capacity: 10, height: 9, tax: 28, power: 5, water: 5 },
      { capacity: 24, height: 16, tax: 70, power: 12, water: 12 },
      { capacity: 48, height: 26, tax: 150, power: 24, water: 24 },
      { capacity: 90, height: 40, tax: 300, power: 45, water: 45 },
    ],
    pollution: 0,
    noise: 0.2,
    baseColor: 0x8fbf6f,
  },
  [ZONE_COMMERCIAL]: {
    zone: ZONE_COMMERCIAL,
    variant: 'shop',
    levels: [
      { capacity: 6, height: 5, tax: 16, power: 4, water: 2 },
      { capacity: 14, height: 9, tax: 40, power: 9, water: 4 },
      { capacity: 30, height: 15, tax: 95, power: 18, water: 8 },
      { capacity: 60, height: 24, tax: 200, power: 34, water: 15 },
      { capacity: 110, height: 36, tax: 380, power: 60, water: 26 },
    ],
    pollution: 0.2,
    noise: 0.8,
    baseColor: 0x6f9fd8,
  },
  [ZONE_INDUSTRIAL]: {
    zone: ZONE_INDUSTRIAL,
    variant: 'factory',
    levels: [
      { capacity: 10, height: 6, tax: 22, power: 8, water: 4 },
      { capacity: 22, height: 8, tax: 52, power: 16, water: 8 },
      { capacity: 45, height: 11, tax: 115, power: 30, water: 14 },
      { capacity: 80, height: 14, tax: 220, power: 52, water: 22 },
      { capacity: 130, height: 18, tax: 400, power: 85, water: 34 },
    ],
    pollution: 3,
    noise: 2.5,
    baseColor: 0xc9a35b,
  },
  [ZONE_OFFICE]: {
    zone: ZONE_OFFICE,
    variant: 'office',
    levels: [
      { capacity: 8, height: 8, tax: 20, power: 5, water: 2 },
      { capacity: 18, height: 14, tax: 48, power: 11, water: 4 },
      { capacity: 38, height: 24, tax: 110, power: 22, water: 8 },
      { capacity: 75, height: 38, tax: 230, power: 40, water: 14 },
      { capacity: 140, height: 58, tax: 430, power: 70, water: 24 },
    ],
    pollution: 0,
    noise: 0.8,
    baseColor: 0x7fc8c8,
  },
};

export const MAX_BUILDING_LEVEL = 5;

// ── Service buildings ───────────────────────────────────────────────────────

export type ServiceKind =
  | 'school'
  | 'hospital'
  | 'fire'
  | 'police'
  | 'park'
  | 'powerPlant'
  | 'waterPlant'
  | 'landfill'
  | 'airport'
  | 'harbor';

export interface ServiceSpec {
  kind: ServiceKind;
  label: string;
  /** Effect radius in meters. */
  radius: number;
  cost: number;
  upkeep: number;
  /** kW produced (power plant) or consumed (others). */
  power: number;
  /** Water produced (water plant) or consumed. */
  water: number;
  /** Jobs provided. */
  jobs: number;
  size: { w: number; d: number; h: number };
  color: number;
  /** Garbage processing capacity (landfill). */
  garbage?: number;
}

export const SERVICES: Record<ServiceKind, ServiceSpec> = {
  school: { kind: 'school', label: '学校', radius: 260, cost: 12000, upkeep: 400, power: -20, water: -8, jobs: 24, size: { w: 22, d: 16, h: 8 }, color: 0xd8c26a },
  hospital: { kind: 'hospital', label: '医院', radius: 320, cost: 24000, upkeep: 800, power: -40, water: -16, jobs: 60, size: { w: 26, d: 20, h: 16 }, color: 0xe8e8ee },
  fire: { kind: 'fire', label: '消防局', radius: 300, cost: 14000, upkeep: 500, power: -15, water: -20, jobs: 30, size: { w: 18, d: 14, h: 9 }, color: 0xc95545 },
  police: { kind: 'police', label: '警察局', radius: 300, cost: 14000, upkeep: 500, power: -15, water: -6, jobs: 30, size: { w: 18, d: 14, h: 10 }, color: 0x5570c9 },
  park: { kind: 'park', label: '公园', radius: 160, cost: 3000, upkeep: 80, power: 0, water: -2, jobs: 4, size: { w: 16, d: 16, h: 1 }, color: 0x55a055 },
  powerPlant: { kind: 'powerPlant', label: '燃煤电厂', radius: 0, cost: 40000, upkeep: 1600, power: 4000, water: -10, jobs: 50, size: { w: 30, d: 24, h: 18 }, color: 0x77706a },
  waterPlant: { kind: 'waterPlant', label: '水厂', radius: 0, cost: 24000, upkeep: 900, power: -60, water: 3000, jobs: 25, size: { w: 22, d: 18, h: 8 }, color: 0x5f9fc9 },
  landfill: { kind: 'landfill', label: '垃圾填埋场', radius: 0, cost: 16000, upkeep: 600, power: -10, water: 0, jobs: 20, size: { w: 28, d: 28, h: 3 }, color: 0x8a7f5f, garbage: 2000 },
  airport: { kind: 'airport', label: '机场', radius: 0, cost: 120000, upkeep: 4000, power: -200, water: -60, jobs: 220, size: { w: 60, d: 40, h: 12 }, color: 0xb9bec9 },
  harbor: { kind: 'harbor', label: '港口', radius: 0, cost: 80000, upkeep: 2600, power: -120, water: -20, jobs: 150, size: { w: 44, d: 30, h: 10 }, color: 0x7f8a99 },
};

export const SERVICE_ORDER: ServiceKind[] = [
  'school',
  'hospital',
  'fire',
  'police',
  'park',
  'powerPlant',
  'waterPlant',
  'landfill',
  'airport',
  'harbor',
];
