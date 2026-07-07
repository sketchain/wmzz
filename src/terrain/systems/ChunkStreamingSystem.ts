import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import type { CameraRig } from '@/engine/camera/CameraRig';
import type { TerrainService } from '../TerrainService';
import type { WaterSurface } from '../WaterSurface';

/** Streams terrain chunks and slides the water plane under the camera. */
export class ChunkStreamingSystem extends System {
  readonly name = 'ChunkStreamingSystem';
  override readonly stage = SystemStage.Update;
  override readonly order = 0;

  constructor(
    private readonly terrain: TerrainService,
    private readonly water: WaterSurface,
    private readonly rig: CameraRig,
  ) {
    super();
  }

  update(_world: World, ctx: TickContext): void {
    const target = this.rig.target;
    this.terrain.updateStreaming(target.x, target.z);
    this.water.update(target.x, target.z, ctx.elapsed);
  }
}
