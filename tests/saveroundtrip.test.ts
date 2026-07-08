import { describe, expect, it } from 'vitest';
import { World } from '../src/core/ecs';
import { EventBus } from '../src/core/events/EventBus';
import type { GameEventBus } from '../src/core/events/GameEvents';
import { HeightField } from '../src/terrain/HeightField';
import { RoadNetwork } from '../src/roads/RoadNetwork';
import { ZoneGrid, ZONE_CELL_SIZE } from '../src/buildings/ZoneGrid';
import { BuildingFactory } from '../src/buildings/BuildingFactory';
import { CityStats } from '../src/simulation/CityStats';
import { GameCalendar } from '../src/simulation/systems/CalendarSystem';
import { CameraRig } from '../src/engine/camera/CameraRig';
import { SaveManager, type TerrainLike } from '../src/persistence/SaveManager';
import { migrateSave } from '../src/persistence/migrations';
import { ZONE_RESIDENTIAL } from '../src/data/buildingPrototypes';
import { Building, BuildingEcon } from '../src/buildings/components';

function makeStack(): {
  world: World;
  field: HeightField;
  roads: RoadNetwork;
  zones: ZoneGrid;
  factory: BuildingFactory;
  stats: CityStats;
  calendar: GameCalendar;
  rig: CameraRig;
  saves: SaveManager;
} {
  const world = new World(256);
  const field = new HeightField(555);
  const terrain: TerrainLike = { field, invalidateAll: () => {} };
  const roads = new RoadNetwork(field);
  const zones = new ZoneGrid(roads);
  const factory = new BuildingFactory(world, zones, field, roads);
  const stats = new CityStats();
  const calendar = new GameCalendar();
  const rig = new CameraRig();
  const events = new EventBus() as GameEventBus;
  const saves = new SaveManager(
    world, terrain, roads, zones, factory, stats, calendar, rig, events,
  );
  return { world, field, roads, zones, factory, stats, calendar, rig, saves };
}

describe('save/load round-trip (data level)', () => {
  it('collect → serialize → apply restores the city exactly', () => {
    const a = makeStack();

    // Build a small city. The hand edit sits far from the road corridor so
    // roadbed grading can't legitimately rewrite it.
    a.field.editDeltas.set(HeightField.vertexKey(150, 150), 3.5);
    a.roads.addRoad(0, 0, 160, 0, 'avenue', { x: 80, z: 40 }, false);
    a.zones.paint(2, 1, ZONE_RESIDENTIAL);
    const cell = a.zones.cellAt(2, 1)!;
    const building = a.factory.spawnGrowable(cell);
    a.world.write(building, BuildingEcon, { occupants: 3, condition: 0.77 });
    a.factory.spawnService('school', 60, 30, 0.5);
    a.stats.treasury = 12345.67;
    a.stats.population = 3;
    a.calendar.month = 7;
    a.calendar.minuteOfDay = 620;
    a.rig.teleport(50, -20, 1.1, 0.8, 300);

    const data = JSON.parse(JSON.stringify(a.saves.collect()));

    // Apply into a FRESH stack (same seed) — simulates reload.
    const b = makeStack();
    b.saves.apply(migrateSave(data));

    expect(b.roads.edges.size).toBe(1);
    expect(b.roads.nodes.size).toBe(2);
    const edge = [...b.roads.edges.values()][0];
    expect(edge.kind).toBe('avenue');
    expect(edge.control).not.toBeNull();

    expect(b.field.editDeltas.get(HeightField.vertexKey(150, 150))).toBeCloseTo(3.5);

    expect(b.zones.cells.size).toBe(1);
    const query = b.world.query({ all: [Building] });
    expect(query.size).toBe(2); // house + school

    // Building state restored exactly.
    let matched = false;
    query.forEach((entity) => {
      const info = b.world.read(entity, Building)!;
      if (info.zone === ZONE_RESIDENTIAL) {
        const econ = b.world.read(entity, BuildingEcon)!;
        expect(econ.occupants).toBe(3);
        expect(econ.condition).toBeCloseTo(0.77, 4);
        // Cell link restored: the zone cell points at this entity.
        expect(b.zones.cellAt(info.cellX, info.cellZ)!.building).toBe(entity);
        matched = true;
      }
    });
    expect(matched).toBe(true);

    expect(b.stats.treasury).toBeCloseTo(12345.67);
    expect(b.calendar.month).toBe(7);
    expect(b.calendar.minuteOfDay).toBe(620);
    expect(b.rig.target.x).toBeCloseTo(50);
    expect(b.rig.distance).toBeCloseTo(300);
    void ZONE_CELL_SIZE;
  });

  it('rejects saves newer than the build', () => {
    const a = makeStack();
    const data = a.saves.collect();
    data.version = 999;
    expect(() => migrateSave(data)).toThrow(/newer/);
  });
});
