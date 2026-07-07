import { beforeEach, describe, expect, it } from 'vitest';
import {
  defineComponent,
  defineObjectComponent,
  defineTag,
  entityGeneration,
  entityIndex,
  resetComponentRegistry,
  Scheduler,
  System,
  SystemStage,
  World,
  type TickContext,
} from '../src/core/ecs';

describe('World', () => {
  beforeEach(() => {
    resetComponentRegistry();
  });

  it('creates and destroys entities with generation-checked handles', () => {
    const world = new World(16);
    const a = world.createEntity();
    const b = world.createEntity();
    expect(world.entityCount).toBe(2);
    expect(world.isAlive(a)).toBe(true);

    world.destroyEntity(a);
    expect(world.isAlive(a)).toBe(false);
    expect(world.entityCount).toBe(1);

    // Recycled index gets a bumped generation; the stale handle stays dead.
    const c = world.createEntity();
    expect(entityIndex(c)).toBe(entityIndex(a));
    expect(entityGeneration(c)).toBe(entityGeneration(a) + 1);
    expect(world.isAlive(a)).toBe(false);
    expect(world.isAlive(c)).toBe(true);
    expect(world.isAlive(b)).toBe(true);
  });

  it('stores SoA component data with defaults and overrides', () => {
    const Position = defineComponent('Position', { x: 'f32', y: 'f32' }, { y: 5 });
    const world = new World(16);
    const e = world.createEntity();
    world.addComponent(e, Position, { x: 3 });

    expect(world.hasComponent(e, Position)).toBe(true);
    expect(world.read(e, Position)).toEqual({ x: 3, y: 5 });

    world.write(e, Position, { y: -2 });
    expect(world.read(e, Position)).toEqual({ x: 3, y: -2 });

    world.removeComponent(e, Position);
    expect(world.hasComponent(e, Position)).toBe(false);
  });

  it('keeps SoA dense arrays hole-free across swap-removes', () => {
    const Value = defineComponent('Value', { v: 'f32' });
    const world = new World(16);
    const entities = Array.from({ length: 5 }, (_, i) => {
      const e = world.createEntity();
      world.addComponent(e, Value, { v: i * 10 });
      return e;
    });

    world.removeComponent(entities[1], Value);
    world.destroyEntity(entities[3]);

    const store = world.soa(Value);
    expect(store.size).toBe(3);
    const seen = new Set<number>();
    for (let i = 0; i < store.size; i++) {
      seen.add(store.fields.v[i]);
    }
    expect(seen).toEqual(new Set([0, 20, 40]));
  });

  it('supports tag and object components', () => {
    const Selected = defineTag('Selected');
    const Name = defineObjectComponent<{ value: string }>('Name');
    const world = new World(16);
    const e = world.createEntity();

    world.addComponent(e, Selected);
    world.addComponent(e, Name, { value: 'city-hall' });

    expect(world.hasComponent(e, Selected)).toBe(true);
    expect(world.getObject(e, Name)?.value).toBe('city-hall');

    world.removeComponent(e, Selected);
    expect(world.hasComponent(e, Selected)).toBe(false);
    expect(world.getObject(e, Name)?.value).toBe('city-hall');
  });

  it('updates queries incrementally on structural changes', () => {
    const A = defineComponent('A', { v: 'f32' });
    const B = defineTag('B');
    const C = defineTag('C');
    const world = new World(16);

    const query = world.query({ all: [A, B], none: [C] });

    const e1 = world.createEntity();
    world.addComponent(e1, A, { v: 1 });
    expect(query.size).toBe(0);

    world.addComponent(e1, B);
    expect(query.size).toBe(1);

    world.addComponent(e1, C);
    expect(query.size).toBe(0);

    world.removeComponent(e1, C);
    expect(query.size).toBe(1);

    world.destroyEntity(e1);
    expect(query.size).toBe(0);
  });

  it('backfills queries created after entities exist', () => {
    const A = defineComponent('A', { v: 'f32' });
    const world = new World(16);
    for (let i = 0; i < 10; i++) {
      const e = world.createEntity();
      if (i % 2 === 0) world.addComponent(e, A, { v: i });
    }
    const query = world.query({ all: [A] });
    expect(query.size).toBe(5);
  });

  it('honors any-of query constraints', () => {
    const A = defineTag('A');
    const B = defineTag('B');
    const world = new World(16);
    const query = world.query({ any: [A, B] });

    const e1 = world.createEntity();
    world.addComponent(e1, A);
    const e2 = world.createEntity();
    world.addComponent(e2, B);
    world.createEntity(); // matches nothing

    expect(query.size).toBe(2);
  });

  it('flushes deferred structural changes', () => {
    const A = defineTag('A');
    const world = new World(16);
    const e = world.createEntity();
    world.defer(() => world.addComponent(e, A));
    expect(world.hasComponent(e, A)).toBe(false);
    world.flushDeferred();
    expect(world.hasComponent(e, A)).toBe(true);
  });
});

describe('Scheduler', () => {
  beforeEach(() => {
    resetComponentRegistry();
  });

  class CountingSystem extends System {
    readonly name: string;
    override readonly stage: SystemStage;
    calls = 0;
    lastDt = 0;

    constructor(name: string, stage: SystemStage) {
      super();
      this.name = name;
      this.stage = stage;
    }

    update(_world: World, ctx: TickContext): void {
      this.calls++;
      this.lastDt = ctx.dt;
    }
  }

  it('runs fixed-timestep simulation from the frame accumulator', () => {
    const world = new World(16);
    const scheduler = new Scheduler(world, undefined, { fixedDelta: 0.1 });
    const sim = new CountingSystem('sim', SystemStage.Simulation);
    const update = new CountingSystem('update', SystemStage.Update);
    scheduler.add(sim).add(update);
    scheduler.start();

    scheduler.frameUpdate(0.25); // 2 fixed ticks, 0.05 left over
    expect(sim.calls).toBe(2);
    expect(sim.lastDt).toBeCloseTo(0.1);
    expect(update.calls).toBe(1);
    expect(update.lastDt).toBeCloseTo(0.25);

    scheduler.frameUpdate(0.06); // leftover 0.05 + 0.06 > fixedDelta → 1 more tick
    expect(sim.calls).toBe(3);
    expect(scheduler.tick).toBe(3);
  });

  it('clamps catch-up ticks to avoid the spiral of death', () => {
    const world = new World(16);
    const scheduler = new Scheduler(world, undefined, {
      fixedDelta: 0.1,
      maxCatchUpTicks: 3,
    });
    const sim = new CountingSystem('sim', SystemStage.Simulation);
    scheduler.add(sim);
    scheduler.start();

    scheduler.frameUpdate(10); // would be 100 ticks unclamped
    expect(sim.calls).toBe(3);
  });

  it('pausing stops simulation but not frame stages', () => {
    const world = new World(16);
    const scheduler = new Scheduler(world, undefined, { fixedDelta: 0.1 });
    const sim = new CountingSystem('sim', SystemStage.Simulation);
    const render = new CountingSystem('render', SystemStage.Render);
    scheduler.add(sim).add(render);
    scheduler.start();
    scheduler.setPaused(true);

    scheduler.frameUpdate(1);
    expect(sim.calls).toBe(0);
    expect(render.calls).toBe(1);
  });

  it('orders systems within a stage by `order`', () => {
    const world = new World(16);
    const scheduler = new Scheduler(world, undefined, { fixedDelta: 0.1 });
    const sequence: string[] = [];

    class Ordered extends System {
      readonly name: string;
      override readonly stage = SystemStage.Update;
      override readonly order: number;
      constructor(name: string, order: number) {
        super();
        this.name = name;
        this.order = order;
      }
      update(): void {
        sequence.push(this.name);
      }
    }

    scheduler.add(new Ordered('c', 30));
    scheduler.add(new Ordered('a', 10));
    scheduler.add(new Ordered('b', 20));
    scheduler.start();
    scheduler.frameUpdate(0.016);

    expect(sequence).toEqual(['a', 'b', 'c']);
  });
});
