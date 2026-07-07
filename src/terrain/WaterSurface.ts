import * as THREE from 'three';
import type { RendererService } from '@/engine/renderer/RendererService';
import { TerrainConfig } from './TerrainConfig';

/**
 * Sea/river/lake surface: one large translucent plane at sea level that
 * follows the camera target, so water is "infinite" without geometry
 * management. Gentle time-based opacity shimmer stands in for real waves
 * until the polish phase.
 */
export class WaterSurface {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(private readonly renderer: RendererService) {
    const geometry = new THREE.PlaneGeometry(6000, 6000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x2d5f8a,
      transparent: true,
      opacity: 0.82,
      roughness: 0.15,
      metalness: 0.1,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = TerrainConfig.seaLevel;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    renderer.scene.add(this.mesh);
  }

  update(centerX: number, centerZ: number, elapsed: number): void {
    this.mesh.position.x = centerX;
    this.mesh.position.z = centerZ;
    this.mesh.position.y = TerrainConfig.seaLevel + Math.sin(elapsed * 0.8) * 0.05;
  }

  dispose(): void {
    this.renderer.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
