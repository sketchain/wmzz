import { defineComponent, defineObjectComponent, defineTag } from '@/core/ecs';

/** Growable (zoned) building core data. */
export const Building = defineComponent('building.Building', {
  /** ZoneId (1-4) for growables; 0 for service buildings. */
  zone: 'u8',
  /** 1-based level. */
  level: 'u8',
  /** Zone-grid cell coordinates the lot occupies. */
  cellX: 'i32',
  cellZ: 'i32',
  /** Nearest road edge id (0 = detached). */
  edgeId: 'u32',
  /** Ticks remaining until construction completes (0 = built). */
  buildTicks: 'u16',
});

/** Economy & occupancy numbers, updated by the simulation. */
export const BuildingEcon = defineComponent('building.Econ', {
  capacity: 'u16',
  occupants: 'u16',
  /** Monthly tax at full occupancy (from prototype). */
  taxBase: 'f32',
  powerDemand: 'f32',
  waterDemand: 'f32',
  /** Local environment caches, refreshed by simulation fields. */
  landValue: 'f32',
  pollution: 'f32',
  noise: 'f32',
  /** Happiness/health composite in [0,1] driving upgrades. */
  condition: 'f32',
});

/** Service buildings (school, power plant…). */
export const ServiceBuilding = defineComponent('building.Service', {
  /** Index into SERVICE_ORDER. */
  serviceIndex: 'u8',
  radius: 'f32',
  jobs: 'u16',
  upkeep: 'f32',
  power: 'f32',
  water: 'f32',
});

export interface BuildingMetaData {
  /** Display name shown by the inspector. */
  name: string;
}

export const BuildingMeta = defineObjectComponent<BuildingMetaData>('building.Meta');

export const UnderConstruction = defineTag('building.UnderConstruction');
export const Abandoned = defineTag('building.Abandoned');
export const PowerShortage = defineTag('building.PowerShortage');
export const WaterShortage = defineTag('building.WaterShortage');
export const OnFire = defineTag('building.OnFire');
