import { describe, expect, it } from 'vitest';
import { Scheduler, World } from '../src/core/ecs';
import { EventBus } from '../src/core/events/EventBus';
import type { GameEventBus } from '../src/core/events/GameEvents';
import { HeightField } from '../src/terrain/HeightField';
import { RoadNetwork } from '../src/roads/RoadNetwork';
import { ZoneGrid } from '../src/buildings/ZoneGrid';
import { BuildingFactory } from '../src/buildings/BuildingFactory';
import { GrowthSystem } from '../src/buildings/systems/GrowthSystem';
import { CityStats } from '../src/simulation/CityStats';
import { EnvironmentFields } from '../src/simulation/EnvironmentFields';
import { GameCalendar } from '../src/simulation/systems/CalendarSystem';
import {
  POWER_CONFIG,
  UtilityGridSystem,
  WATER_CONFIG,
} from '../src/simulation/systems/UtilityGridSystem';
import { EnvironmentSystem } from '../src/simulation/systems/EnvironmentSystem';
import { PopulationSystem } from '../src/simulation/systems/PopulationSystem';
import { EconomySystem } from '../src/simulation/systems/EconomySystem';
import { SanitationSystem } from '../src/simulation/systems/SanitationSystem';
import { ZONE_RESIDENTIAL, ZONE_COMMERCIAL } from '../src/data/buildingPrototypes';
import { Building, BuildingEcon } from '../src/buildings/components';
import { Transform } from '../src/engine/components';

/**
 * The core determinism contract: identical seed + identical operations ⇒
 * identical simulation state. Runs the full headless simulation stack
 * (utilities, environment, population, economy, growth) twice and compares
 * state hashes tick-for-tick-aligned at the end.
 */
function runCity(ticks: number): string {
  const world = new World(1024);
  const events = new EventBus() as GameEventBus;
  const field = new HeightField(777);
  const roads = new RoadNetwork(field);
  const zones = new ZoneGrid(roads);
  const factory = new BuildingFactory(world, zones, field, roads);
  const stats = new CityStats();
  const fields = new EnvironmentFields();
  const calendar = new GameCalendar();

  const scheduler = new Scheduler(world, events, { fixedDelta: 1 / 30 });
  const economy = new EconomySystem(stats, roads, calendar, events);
  const growth = new GrowthSystem(zones, factory);
  growth.demandProvider = economy;
  scheduler.add(new UtilityGridSystem(POWER_CONFIG, roads, stats));
  scheduler.add(new UtilityGridSystem(WATER_CONFIG, roads, stats));
  scheduler.add(new EnvironmentSystem(fields, roads, stats));
  scheduler.add(new PopulationSystem(stats, fields));
  scheduler.add(new SanitationSystem(stats));
  scheduler.add(economy);
  scheduler.add(growth);
  scheduler.start();

  // Identical player operations: one road, zoned strips, two plants.
  roads.addRoad(0, 0, 400, 0, 'street');
  for (let cx = 1; cx < 40; cx += 2) {
    zones.paint(cx, 1, ZONE_RESIDENTIAL);
    zones.paint(cx, -2, ZONE_COMMERCIAL);
  }
  factory.spawnService('powerPlant', 380, 30, 0);
  factory.spawnService('waterPlant', 350, 30, 0);

  for (let i = 0; i < ticks; i++) {
    scheduler.frameUpdate(1 / 30);
  }

  // State hash: building set + econ numbers + aggregate stats.
  const rows: string[] = [];
  const buildings = world.soa(Building);
  const econ = world.soa(BuildingEcon);
  const transforms = world.soa(Transform);
  const query = world.query({ all: [Building, BuildingEcon, Transform] });
  query.forEach((entity) => {
    const index = entity & 0xffffff;
    const b = buildings.denseIndexOf(index);
    const e = econ.denseIndexOf(index);
    const t = transforms.denseIndexOf(index);
    rows.push(
      [
        buildings.fields.zone[b],
        buildings.fields.level[b],
        transforms.fields.x[t].toFixed(2),
        transforms.fields.z[t].toFixed(2),
        econ.fields.occupants[e],
        econ.fields.condition[e].toFixed(4),
      ].join(','),
    );
  });
  rows.sort();
  rows.push(
    `stats:${stats.population},${stats.treasury.toFixed(2)},${stats.happiness.toFixed(4)},${stats.demandResidential.toFixed(4)}`,
  );
  return rows.join('|');
}

describe('simulation determinism', () => {
  it('same seed + same operations ⇒ identical state after 900 ticks', () => {
    const first = runCity(900);
    const second = runCity(900);
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(100); // sanity: a city actually grew
    expect(first).toContain('stats:');
  });

  it('the city actually develops (buildings spawned, people moved in)', () => {
    const state = runCity(1200);
    const statsPart = state.split('|').pop()!;
    const population = Number(statsPart.split(':')[1].split(',')[0]);
    expect(population).toBeGreaterThan(0);
  });
});
