import { System, SystemStage, type World } from '@/core/ecs';
import type { InputService } from '../input/InputService';

/** Promotes pending DOM input events into the per-frame snapshot. */
export class InputSystem extends System {
  readonly name = 'InputSystem';
  override readonly stage = SystemStage.Input;
  override readonly order = -100;

  constructor(private readonly input: InputService) {
    super();
  }

  update(_world: World): void {
    this.input.beginFrame();
  }
}
