import * as THREE from 'three';
import { createToken } from '@/core/di/ServiceContainer';
import type { RendererService } from '../renderer/RendererService';

/**
 * Converts screen-space pointer positions into world positions / hit objects.
 * Terrain picking uses the height field's own raymarcher once terrain exists
 * (Phase 3 injects `groundRaycast`); until then a y=0 plane stands in.
 */
export class PickingService {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly planeHit = new THREE.Vector3();

  /** Injected by the terrain module: precise ray→heightfield intersection. */
  groundRaycast: ((ray: THREE.Ray, out: THREE.Vector3) => boolean) | null = null;

  constructor(private readonly renderer: RendererService) {}

  private updateRay(screenX: number, screenY: number): void {
    const canvas = this.renderer.canvas;
    this.ndc.set(
      (screenX / canvas.clientWidth) * 2 - 1,
      -(screenY / canvas.clientHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.renderer.camera);
  }

  /** World position where the pointer ray hits the ground. */
  pickGround(screenX: number, screenY: number, out: THREE.Vector3): boolean {
    this.updateRay(screenX, screenY);
    if (this.groundRaycast) {
      return this.groundRaycast(this.raycaster.ray, out);
    }
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.planeHit);
    if (!hit) return false;
    out.copy(this.planeHit);
    return true;
  }

  /** Raycast against explicit scene objects (service buildings, props…). */
  pickObjects(
    screenX: number,
    screenY: number,
    objects: THREE.Object3D[],
  ): THREE.Intersection | null {
    this.updateRay(screenX, screenY);
    const hits = this.raycaster.intersectObjects(objects, true);
    return hits.length > 0 ? hits[0] : null;
  }

  get ray(): THREE.Ray {
    return this.raycaster.ray;
  }
}

export const PickingToken = createToken<PickingService>('engine.picking');
