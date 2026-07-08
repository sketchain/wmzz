import { createToken } from '@/core/di/ServiceContainer';
import type { World } from '@/core/ecs';
import type { GameEventBus } from '@/core/events/GameEvents';
import { createLogger } from '@/core/utils/Logger';
import { GameConfig } from '@/config/GameConfig';
import type { CameraRig } from '@/engine/camera/CameraRig';
import type { HeightField } from '@/terrain/HeightField';
import type { RoadNetwork, RoadNetworkSnapshot } from '@/roads/RoadNetwork';

/** Structural terrain dependency — keeps saving testable headlessly. */
export interface TerrainLike {
  readonly field: HeightField;
  invalidateAll(): void;
}
import type { ZoneGrid } from '@/buildings/ZoneGrid';
import type { BuildingFactory, BuildingSnapshot } from '@/buildings/BuildingFactory';
import {
  Abandoned,
  Building,
  BuildingEcon,
  BuildingMeta,
  ServiceBuilding,
  UnderConstruction,
} from '@/buildings/components';
import { Transform } from '@/engine/components';
import type { CityStats } from '@/simulation/CityStats';
import type { GameCalendar } from '@/simulation/systems/CalendarSystem';
import { IndexedDbStore } from './IndexedDbStore';
import { migrateSave } from './migrations';

declare module '@/core/events/GameEvents' {
  interface GameEvents {
    'save:completed': { slot: string };
    'save:loaded': { slot: string };
    'save:failed': { slot: string; error: string };
  }
}

const log = createLogger('save');

/** Scalar CityStats fields that round-trip through saves. */
const STAT_KEYS = [
  'population', 'households', 'jobsTotal', 'jobsFilled', 'unemployment',
  'happiness', 'education', 'health', 'safety',
  'averagePollution', 'averageLandValue', 'garbageAccumulated', 'garbageCapacity',
  'powerSupply', 'powerDemand', 'waterSupply', 'waterDemand', 'poweredRatio', 'wateredRatio',
  'treasury', 'monthlyIncome', 'monthlyExpenses',
  'taxRateResidential', 'taxRateCommercial', 'taxRateIndustrial', 'taxRateOffice',
  'loanPrincipal', 'loanMonthlyPayment', 'economicCycle',
  'demandResidential', 'demandCommercial', 'demandIndustrial', 'demandOffice',
  'cityLevel',
] as const;

const CALENDAR_KEYS = [
  'minuteOfDay', 'day', 'month', 'year', 'weather', 'temperature', 'wind',
] as const;

export interface SaveData {
  version: number;
  savedAt: number;
  terrain: {
    seed: number;
    deltas: [number, number][];
    paint: [number, number][];
  };
  roads: RoadNetworkSnapshot;
  zones: [number, number, number, number][];
  buildings: BuildingSnapshot[];
  stats: Record<string, number>;
  calendar: Record<string, number | string>;
  camera: { x: number; z: number; yaw: number; pitch: number; distance: number };
}

/**
 * Whole-city snapshot pipeline over IndexedDB. The procedural terrain never
 * serializes — only the seed plus sparse player edits — so saves stay small
 * (kilobytes for large cities). `version` + migrations.ts keep old saves
 * loadable across schema changes.
 */
export class SaveManager {
  private readonly store = new IndexedDbStore();

  constructor(
    private readonly world: World,
    private readonly terrain: TerrainLike,
    private readonly roads: RoadNetwork,
    private readonly zoneGrid: ZoneGrid,
    private readonly factory: BuildingFactory,
    private readonly stats: CityStats,
    private readonly calendar: GameCalendar,
    private readonly rig: CameraRig,
    private readonly events: GameEventBus,
  ) {}

  collect(): SaveData {
    const buildings: BuildingSnapshot[] = [];
    // Building + Transform only: service buildings carry no BuildingEcon.
    const query = this.world.query({ all: [Building, Transform] });
    query.forEach((entity) => {
      const building = this.world.read(entity, Building)!;
      const econ = this.world.read(entity, BuildingEcon);
      const transform = this.world.read(entity, Transform)!;
      const service = this.world.hasComponent(entity, ServiceBuilding)
        ? this.world.read(entity, ServiceBuilding)!
        : undefined;
      buildings.push({
        transform,
        building,
        econ,
        service,
        name: this.world.getObject(entity, BuildingMeta)?.name ?? '',
        underConstruction: this.world.hasComponent(entity, UnderConstruction),
        abandoned: this.world.hasComponent(entity, Abandoned),
      });
    });

    const statsOut: Record<string, number> = {};
    for (const key of STAT_KEYS) statsOut[key] = this.stats[key] as number;
    const calendarOut: Record<string, number | string> = {};
    for (const key of CALENDAR_KEYS) {
      calendarOut[key] = this.calendar[key] as number | string;
    }

    return {
      version: GameConfig.persistence.saveVersion,
      savedAt: Date.now(),
      terrain: {
        seed: this.terrain.field.seed,
        deltas: [...this.terrain.field.editDeltas.entries()],
        paint: [...this.terrain.field.paintLayer.entries()],
      },
      roads: this.roads.serialize(),
      zones: this.zoneGrid.serialize(),
      buildings,
      stats: statsOut,
      calendar: calendarOut,
      camera: {
        x: this.rig.target.x,
        z: this.rig.target.z,
        yaw: this.rig.yaw,
        pitch: this.rig.pitch,
        distance: this.rig.distance,
      },
    };
  }

  apply(data: SaveData): void {
    // Order matters: terrain first (roads re-sample heights), then roads
    // (zones reference edges), then zones, then buildings (link cells).
    this.world.clear();
    this.factory.version++;

    this.terrain.field.editDeltas.clear();
    for (const [key, value] of data.terrain.deltas) {
      this.terrain.field.editDeltas.set(key, value);
    }
    this.terrain.field.paintLayer.clear();
    for (const [key, value] of data.terrain.paint) {
      this.terrain.field.paintLayer.set(key, value);
    }
    this.terrain.invalidateAll();

    this.roads.deserialize(data.roads);
    this.zoneGrid.deserialize(data.zones);
    for (const snapshot of data.buildings) {
      this.factory.restoreBuilding(snapshot);
    }

    for (const key of STAT_KEYS) {
      if (key in data.stats) {
        (this.stats as unknown as Record<string, number>)[key] = data.stats[key];
      }
    }
    for (const key of CALENDAR_KEYS) {
      if (key in data.calendar) {
        (this.calendar as unknown as Record<string, number | string>)[key] =
          data.calendar[key];
      }
    }

    this.rig.teleport(
      data.camera.x,
      data.camera.z,
      data.camera.yaw,
      data.camera.pitch,
      data.camera.distance,
    );
  }

  async save(slot: string): Promise<void> {
    try {
      const data = this.collect();
      await this.store.put(slot, data);
      log.info(`saved city to slot "${slot}" (${data.buildings.length} buildings)`);
      this.events.emit('save:completed', { slot });
    } catch (error) {
      log.error('save failed', error);
      this.events.emit('save:failed', { slot, error: String(error) });
    }
  }

  async load(slot: string): Promise<boolean> {
    try {
      const raw = await this.store.get<SaveData>(slot);
      if (!raw) return false;
      const data = migrateSave(raw);
      this.apply(data);
      log.info(`loaded city from slot "${slot}"`);
      this.events.emit('save:loaded', { slot });
      return true;
    } catch (error) {
      log.error('load failed', error);
      this.events.emit('save:failed', { slot, error: String(error) });
      return false;
    }
  }

  listSlots(): Promise<string[]> {
    return this.store.listSlots();
  }
}

export const SaveManagerToken = createToken<SaveManager>('persistence.saveManager');
