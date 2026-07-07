import * as THREE from 'three';
import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import type { CommandStack } from '@/core/commands/CommandStack';
import type { GameEventBus } from '@/core/events/GameEvents';
import type { InputService } from '@/engine/input/InputService';
import type { PickingService } from '@/engine/picking/PickingService';
import { TerrainConfig } from '../TerrainConfig';
import type { BrushMode, TerrainEditor } from '../editing/TerrainEditor';

declare module '@/core/events/GameEvents' {
  interface GameEvents {
    'terrain:brushChanged': { mode: BrushMode | null; radius: number };
  }
}

const MODE_KEYS: Record<string, BrushMode> = {
  Digit1: 'raise',
  Digit2: 'lower',
  Digit3: 'flatten',
  Digit4: 'smooth',
  Digit5: 'paint',
};

/**
 * Pointer/keyboard front-end for the terrain editor.
 *  1-5 select brush (again to deselect) · [ ] resize · left-drag apply
 *  Ctrl+Z / Ctrl+Y undo / redo. Strokes land on the CommandStack.
 * Inactive while another tool (roads/zoning, later phases) owns the pointer.
 */
export class TerrainEditSystem extends System {
  readonly name = 'TerrainEditSystem';
  override readonly stage = SystemStage.Input;
  override readonly order = 10;

  /** Other tools set this to suppress terrain editing. */
  static toolLock: string | null = null;

  private readonly hit = new THREE.Vector3();
  private active: BrushMode | null = null;

  constructor(
    private readonly editor: TerrainEditor,
    private readonly input: InputService,
    private readonly picking: PickingService,
    private readonly commands: CommandStack,
    private readonly events: GameEventBus,
  ) {
    super();
  }

  update(_world: World, ctx: TickContext): void {
    const input = this.input;

    // Undo/redo shortcuts are global.
    if (input.keys.has('ControlLeft') || input.keys.has('ControlRight')) {
      if (input.keysPressed.has('KeyZ')) this.commands.undo();
      if (input.keysPressed.has('KeyY')) this.commands.redo();
    }

    for (const [code, mode] of Object.entries(MODE_KEYS)) {
      if (input.keysPressed.has(code)) {
        this.active = this.active === mode ? null : mode;
        this.editor.mode = mode;
        this.emitBrushChanged();
      }
    }
    if (input.keysPressed.has('Escape')) {
      this.finishStroke();
      this.active = null;
      this.emitBrushChanged();
    }

    if (input.keysPressed.has('BracketLeft')) {
      this.editor.radius = Math.max(
        TerrainConfig.editing.minBrushRadius,
        this.editor.radius * 0.8,
      );
      this.emitBrushChanged();
    }
    if (input.keysPressed.has('BracketRight')) {
      this.editor.radius = Math.min(
        TerrainConfig.editing.maxBrushRadius,
        this.editor.radius * 1.25,
      );
      this.emitBrushChanged();
    }

    if (this.active === null || TerrainEditSystem.toolLock !== null) {
      this.finishStroke();
      return;
    }

    if (input.buttons.left && input.pointerInside) {
      if (this.picking.pickGround(input.pointerX, input.pointerY, this.hit)) {
        if (!this.editor.isStroking) this.editor.beginStroke(this.hit.x, this.hit.z);
        this.editor.applyDab(this.hit.x, this.hit.z, ctx.dt);
      }
    } else {
      this.finishStroke();
    }
  }

  private finishStroke(): void {
    const command = this.editor.endStroke();
    if (command) this.commands.execute(command);
  }

  private emitBrushChanged(): void {
    this.events.emit('terrain:brushChanged', {
      mode: this.active,
      radius: this.editor.radius,
    });
  }
}
