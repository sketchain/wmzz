import { EventBus } from './EventBus';
import { createToken } from '../di/ServiceContainer';

/**
 * Central game event map. Feature modules (roads, buildings, simulation…)
 * extend this interface via declaration merging:
 *
 *   declare module '@/core/events/GameEvents' {
 *     interface GameEvents {
 *       'road:built': { roadId: number };
 *     }
 *   }
 */
export interface GameEvents {
  'game:paused': { paused: boolean };
  'game:speedChanged': { scale: number };
  'command:executed': { label: string };
  'command:undone': { label: string };
  'command:redone': { label: string };
}

export type GameEventBus = EventBus<GameEvents>;

export const EventBusToken = createToken<GameEventBus>('core.eventBus');

export function createGameEventBus(): GameEventBus {
  return new EventBus<GameEvents>();
}
