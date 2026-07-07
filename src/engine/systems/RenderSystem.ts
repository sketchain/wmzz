import { System, SystemStage, type World } from '@/core/ecs';
import type { RendererService } from '../renderer/RendererService';

/** Final stage: submit the frame. Everything visual must be synced before. */
export class RenderSystem extends System {
  readonly name = 'RenderSystem';
  override readonly stage = SystemStage.Render;
  override readonly order = 1000;

  constructor(private readonly renderer: RendererService) {
    super();
  }

  update(_world: World): void {
    this.renderer.render();
  }
}
