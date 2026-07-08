import * as THREE from 'three';
import { createToken } from '@/core/di/ServiceContainer';

/**
 * RTS/city-builder camera model: an orbit rig around a ground target with
 * critically-damped smoothing. Controls mutate the *goal* state; `update`
 * eases the live state toward it, so all motion (pan, zoom, rotate) shares
 * one consistent feel.
 */
export class CameraRig {
  readonly target = new THREE.Vector3(0, 0, 0);
  yaw = Math.PI * 0.25;
  pitch = 0.9; // radians above horizon
  distance = 260;

  private readonly goalTarget = this.target.clone();
  private goalYaw = this.yaw;
  private goalPitch = this.pitch;
  private goalDistance = this.distance;

  minDistance = 20;
  maxDistance = 1500;
  minPitch = 0.25;
  maxPitch = 1.45;
  /** Smoothing half-life in seconds. */
  smoothing = 0.08;

  /** Optional terrain height provider so the target hugs the ground. */
  heightAt: ((x: number, z: number) => number) | null = null;

  pan(dx: number, dz: number): void {
    // Move in the camera's ground-plane frame.
    const sin = Math.sin(this.goalYaw);
    const cos = Math.cos(this.goalYaw);
    this.goalTarget.x += dx * cos - dz * sin;
    this.goalTarget.z += dx * sin + dz * cos;
  }

  rotate(deltaYaw: number, deltaPitch: number): void {
    this.goalYaw += deltaYaw;
    this.goalPitch = THREE.MathUtils.clamp(
      this.goalPitch + deltaPitch,
      this.minPitch,
      this.maxPitch,
    );
  }

  zoom(factor: number): void {
    this.goalDistance = THREE.MathUtils.clamp(
      this.goalDistance * factor,
      this.minDistance,
      this.maxDistance,
    );
  }

  jumpTo(x: number, z: number): void {
    this.goalTarget.set(x, 0, z);
  }

  /** Hard-set the full pose (save loading) — no smoothing. */
  teleport(x: number, z: number, yaw: number, pitch: number, distance: number): void {
    this.goalTarget.set(x, 0, z);
    this.target.copy(this.goalTarget);
    this.goalYaw = this.yaw = yaw;
    this.goalPitch = this.pitch = pitch;
    this.goalDistance = this.distance = distance;
  }

  /** Pan speed scales with zoom so screen-space speed feels constant. */
  get panSpeed(): number {
    return this.goalDistance * 0.9;
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    if (this.heightAt) {
      this.goalTarget.y = this.heightAt(this.goalTarget.x, this.goalTarget.z);
    }
    const t = 1 - Math.exp((-Math.LN2 * dt) / Math.max(this.smoothing, 1e-4));
    this.target.lerp(this.goalTarget, t);
    this.yaw += (this.goalYaw - this.yaw) * t;
    this.pitch += (this.goalPitch - this.pitch) * t;
    this.distance += (this.goalDistance - this.distance) * t;

    const horizontal = Math.cos(this.pitch) * this.distance;
    camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    camera.lookAt(this.target);
  }
}

export const CameraRigToken = createToken<CameraRig>('engine.cameraRig');
