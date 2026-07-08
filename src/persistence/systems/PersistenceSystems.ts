import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import { GameConfig } from '@/config/GameConfig';
import type { InputService } from '@/engine/input/InputService';
import type { SaveManager } from '../SaveManager';

/** Periodic background save into the "autosave" slot. */
export class AutoSaveSystem extends System {
  readonly name = 'AutoSaveSystem';
  override readonly stage = SystemStage.Update;
  override readonly order = 90;

  private sinceLastSave = 0;

  constructor(private readonly saves: SaveManager) {
    super();
  }

  update(_world: World, ctx: TickContext): void {
    this.sinceLastSave += ctx.dt;
    if (this.sinceLastSave >= GameConfig.persistence.autoSaveIntervalSeconds) {
      this.sinceLastSave = 0;
      void this.saves.save('autosave');
    }
  }
}

/** F5 quick-save, F9 quick-load. */
export class SaveHotkeySystem extends System {
  readonly name = 'SaveHotkeySystem';
  override readonly stage = SystemStage.Input;
  override readonly order = 20;

  constructor(
    private readonly saves: SaveManager,
    private readonly input: InputService,
  ) {
    super();
  }

  update(): void {
    if (this.input.keysPressed.has('F5')) void this.saves.save('quicksave');
    if (this.input.keysPressed.has('F9')) void this.saves.load('quicksave');
  }
}
