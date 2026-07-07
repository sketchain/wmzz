import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import type { CameraRig } from '../camera/CameraRig';
import type { InputService } from '../input/InputService';
import type { RendererService } from '../renderer/RendererService';

const ZOOM_STEP = 1.12;
const ROTATE_SPEED = 0.005;
const KEY_ROTATE_SPEED = 1.6;

/**
 * Keyboard/mouse camera controls:
 *  WASD / arrows  pan          wheel        zoom
 *  Q / E          rotate       R / F        tilt
 *  middle or right drag        rotate + tilt
 */
export class CameraControlSystem extends System {
  readonly name = 'CameraControlSystem';
  override readonly stage = SystemStage.Update;
  override readonly order = -50;

  constructor(
    private readonly rig: CameraRig,
    private readonly input: InputService,
    private readonly renderer: RendererService,
  ) {
    super();
  }

  update(_world: World, ctx: TickContext): void {
    const input = this.input;
    const rig = this.rig;
    const dt = ctx.dt;

    let panX = 0;
    let panZ = 0;
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) panX -= 1;
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) panX += 1;
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) panZ -= 1;
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) panZ += 1;
    if (panX !== 0 || panZ !== 0) {
      const speed = rig.panSpeed * dt;
      rig.pan(panX * speed, panZ * speed);
    }

    let yawDelta = 0;
    let pitchDelta = 0;
    if (input.keys.has('KeyQ')) yawDelta += KEY_ROTATE_SPEED * dt;
    if (input.keys.has('KeyE')) yawDelta -= KEY_ROTATE_SPEED * dt;
    if (input.keys.has('KeyR')) pitchDelta += KEY_ROTATE_SPEED * dt * 0.6;
    if (input.keys.has('KeyF')) pitchDelta -= KEY_ROTATE_SPEED * dt * 0.6;

    if (input.buttons.middle || input.buttons.right) {
      yawDelta -= input.pointerDeltaX * ROTATE_SPEED;
      pitchDelta += input.pointerDeltaY * ROTATE_SPEED;
    }
    if (yawDelta !== 0 || pitchDelta !== 0) rig.rotate(yawDelta, pitchDelta);

    if (input.wheelDelta !== 0) {
      rig.zoom(input.wheelDelta > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    }

    rig.update(dt, this.renderer.camera);

    // Keep the shadow frustum centered on the view target so shadows stay
    // sharp wherever the player looks.
    const sun = this.renderer.sun;
    sun.target.position.copy(rig.target);
    sun.position.set(rig.target.x + 300, rig.target.y + 400, rig.target.z + 200);
  }
}
