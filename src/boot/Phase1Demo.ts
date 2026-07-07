import {
  defineComponent,
  defineTag,
  System,
  SystemStage,
  type TickContext,
  type World,
} from '@/core/ecs';

/**
 * Phase 1 smoke-test content: a headless particle swarm that exercises the
 * full ECS hot path (SoA iteration, fixed-timestep simulation, queries,
 * structural changes) at six-figure entity counts. Replaced by real game
 * content from Phase 2 onward; kept under src/boot/ so nothing in src/core
 * depends on it.
 */

export const Position = defineComponent('demo.Position', {
  x: 'f32',
  y: 'f32',
  z: 'f32',
});

export const Velocity = defineComponent('demo.Velocity', {
  x: 'f32',
  y: 'f32',
  z: 'f32',
});

export const Lifetime = defineComponent('demo.Lifetime', { remaining: 'f32' });

export const Expired = defineTag('demo.Expired');

const WORLD_EXTENT = 1024;

/** Deterministic PRNG (mulberry32) — the simulation must never rely on Math.random. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function spawnParticles(world: World, count: number, seed = 1337): void {
  const rng = createRng(seed);
  for (let i = 0; i < count; i++) {
    const entity = world.createEntity();
    world.addComponent(entity, Position, {
      x: (rng() * 2 - 1) * WORLD_EXTENT,
      y: rng() * 200,
      z: (rng() * 2 - 1) * WORLD_EXTENT,
    });
    world.addComponent(entity, Velocity, {
      x: (rng() * 2 - 1) * 20,
      y: (rng() * 2 - 1) * 5,
      z: (rng() * 2 - 1) * 20,
    });
    world.addComponent(entity, Lifetime, { remaining: 30 + rng() * 90 });
  }
}

/** Integrates positions over the fixed timestep; wraps at world bounds. */
export class MovementSystem extends System {
  readonly name = 'MovementSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 0;

  update(world: World, ctx: TickContext): void {
    const query = world.query({ all: [Position, Velocity] });
    const positions = world.soa(Position);
    const velocities = world.soa(Velocity);
    const px = positions.fields.x;
    const py = positions.fields.y;
    const pz = positions.fields.z;
    const vx = velocities.fields.x;
    const vy = velocities.fields.y;
    const vz = velocities.fields.z;
    const dt = ctx.dt;

    const entities = query.entities;
    const count = query.size;
    for (let i = 0; i < count; i++) {
      const index = entities[i] & 0xffffff;
      const p = positions.denseIndexOf(index);
      const v = velocities.denseIndexOf(index);
      px[p] += vx[v] * dt;
      py[p] += vy[v] * dt;
      pz[p] += vz[v] * dt;
      if (px[p] > WORLD_EXTENT) px[p] -= WORLD_EXTENT * 2;
      else if (px[p] < -WORLD_EXTENT) px[p] += WORLD_EXTENT * 2;
      if (pz[p] > WORLD_EXTENT) pz[p] -= WORLD_EXTENT * 2;
      else if (pz[p] < -WORLD_EXTENT) pz[p] += WORLD_EXTENT * 2;
    }
  }
}

/** Ages lifetimes; tags expired entities for structural cleanup. */
export class LifetimeSystem extends System {
  readonly name = 'LifetimeSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 10;

  update(world: World, ctx: TickContext): void {
    const query = world.query({ all: [Lifetime], none: [Expired] });
    const lifetimes = world.soa(Lifetime);
    const remaining = lifetimes.fields.remaining;
    const dt = ctx.dt;

    const entities = query.entities;
    const count = query.size;
    for (let i = 0; i < count; i++) {
      const entity = entities[i];
      const dense = lifetimes.denseIndexOf(entity & 0xffffff);
      remaining[dense] -= dt;
      if (remaining[dense] <= 0) {
        world.defer(() => world.addComponent(entity, Expired));
      }
    }
  }
}

/**
 * Destroys expired entities and respawns replacements, keeping the swarm at
 * a constant population — a continuous churn test for entity recycling.
 */
export class RespawnSystem extends System {
  readonly name = 'RespawnSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 20;

  private seedCounter = 7_000_003;

  update(world: World, _ctx: TickContext): void {
    const query = world.query({ all: [Expired] });
    if (query.size === 0) return;
    const doomed: number[] = [];
    query.forEach((entity) => doomed.push(entity));
    for (const entity of doomed) {
      world.destroyEntity(entity);
    }
    spawnParticles(world, doomed.length, this.seedCounter++);
  }
}
