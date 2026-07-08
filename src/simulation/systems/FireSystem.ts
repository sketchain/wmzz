import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { Transform } from '@/engine/components';
import { createRng } from '@/terrain/createRng';
import type { GameEventBus } from '@/core/events/GameEvents';
import {
  Building,
  BuildingEcon,
  OnFire,
  UnderConstruction,
} from '@/buildings/components';
import type { BuildingFactory } from '@/buildings/BuildingFactory';
import { COVER_FIRE, EnvironmentFields } from '../EnvironmentFields';

declare module '@/core/events/GameEvents' {
  interface GameEvents {
    'fire:ignited': { entity: number };
    'fire:extinguished': { entity: number; burnedDown: boolean };
  }
}

const INTERVAL = 240; // 8 s of sim
const PHASE = 101;
/** Base ignition probability per eligible building per pass. */
const IGNITION_CHANCE = 0.0035;
/** Passes a fire burns before resolving. */
const BURN_PASSES_COVERED = 2;
const BURN_PASSES_UNCOVERED = 4;

/**
 * Fire risk & response. Buildings outside fire coverage ignite more often,
 * burn longer, and burn down (demolished) instead of being saved. Burning
 * wrecks the building's condition so the population reacts immediately.
 */
export class FireSystem extends System {
  readonly name = 'FireSystem';
  override readonly stage = SystemStage.Simulation;
  override readonly order = 27;

  private readonly rng = createRng(0xf1fe);
  private readonly burning = new Map<number, { passes: number; covered: boolean }>();

  constructor(
    private readonly fields: EnvironmentFields,
    private readonly factory: BuildingFactory,
    private readonly events: GameEventBus,
  ) {
    super();
  }

  update(world: World, ctx: TickContext): void {
    if (ctx.tick % INTERVAL !== PHASE % INTERVAL) return;

    const buildings = world.soa(Building);
    const econ = world.soa(BuildingEcon);
    const transforms = world.soa(Transform);

    // Progress active fires.
    for (const [entity, state] of [...this.burning]) {
      if (!world.isAlive(entity)) {
        this.burning.delete(entity);
        continue;
      }
      state.passes--;
      const e = econ.denseIndexOf(entity & 0xffffff);
      if (e >= 0) econ.fields.condition[e] = 0;
      if (state.passes <= 0) {
        this.burning.delete(entity);
        const burnedDown = !state.covered;
        world.defer(() => {
          if (!world.isAlive(entity)) return;
          world.removeComponent(entity, OnFire);
          if (burnedDown) this.factory.demolish(entity);
        });
        this.events.enqueue('fire:extinguished', { entity, burnedDown });
      }
    }

    // Roll new ignitions.
    const query = world.query({
      all: [Building, BuildingEcon, Transform],
      none: [UnderConstruction, OnFire],
    });
    const entities = query.entities;
    for (let i = 0; i < query.size; i++) {
      const entity = entities[i];
      const index = entity & 0xffffff;
      const b = buildings.denseIndexOf(index);
      const level = buildings.fields.level[b];
      const t = transforms.denseIndexOf(index);
      const covered =
        (this.fields.coverageAt(transforms.fields.x[t], transforms.fields.z[t]) &
          COVER_FIRE) !== 0;
      const risk = IGNITION_CHANCE * (1 + level * 0.3) * (covered ? 0.35 : 1);
      if (this.rng() < risk) {
        this.burning.set(entity, {
          passes: covered ? BURN_PASSES_COVERED : BURN_PASSES_UNCOVERED,
          covered,
        });
        world.defer(() => world.addComponent(entity, OnFire));
        this.events.enqueue('fire:ignited', { entity });
      }
    }
  }
}
