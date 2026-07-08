import { System, SystemStage, type World } from '@/core/ecs';
import type { Scheduler } from '@/core/ecs';
import { GameConfig } from '@/config/GameConfig';
import type { InputService } from '../input/InputService';

/**
 * Space toggles pause; , / . step the speed through the configured levels
 * (1× / 2× / 4×) — Cities: Skylines muscle memory.
 */
export class TimeControlSystem extends System {
  readonly name = 'TimeControlSystem';
  override readonly stage = SystemStage.Input;
  override readonly order = -50;

  private speedIndex = 0;

  constructor(
    private readonly scheduler: Scheduler,
    private readonly input: InputService,
  ) {
    super();
  }

  update(_world: World): void {
    if (this.input.keysPressed.has('Space')) {
      this.scheduler.setPaused(!this.scheduler.paused);
    }
    const levels = GameConfig.simulation.speedLevels;
    if (this.input.keysPressed.has('Comma') && this.speedIndex > 0) {
      this.speedIndex--;
      this.scheduler.setTimeScale(levels[this.speedIndex]);
    }
    if (this.input.keysPressed.has('Period') && this.speedIndex < levels.length - 1) {
      this.speedIndex++;
      this.scheduler.setTimeScale(levels[this.speedIndex]);
    }
  }
}
