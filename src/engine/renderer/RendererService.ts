import * as THREE from 'three';
import { PostProcessing, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { createLogger } from '@/core/utils/Logger';
import { createToken, type Disposable } from '@/core/di/ServiceContainer';
import { GameConfig } from '@/config/GameConfig';

const log = createLogger('renderer');

/**
 * Owns the Three.js renderer, root scene and lighting rig.
 *
 * Uses WebGPURenderer, which drives a native WebGPU backend when
 * `navigator.gpu` is available and transparently falls back to its WebGL2
 * backend otherwise — one scene graph and one (node-)material set serve both
 * paths, which is why we take it over the classic WebGLRenderer.
 */
export class RendererService implements Disposable {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: WebGPURenderer;
  readonly canvas: HTMLCanvasElement;
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;

  private resizeObserver?: ResizeObserver;
  private postProcessing: PostProcessing | null = null;
  backend: 'webgpu' | 'webgl2' = 'webgl2';

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    host.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(
      55,
      1,
      0.5,
      GameConfig.rendering.farPlane,
    );
    this.camera.position.set(120, 140, 160);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      forceWebGL: !GameConfig.rendering.preferWebGPU,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene.background = new THREE.Color(0x87b5d9);
    this.scene.fog = new THREE.Fog(0x9cc0dc, 800, GameConfig.rendering.farPlane);

    this.ambient = new THREE.HemisphereLight(0xbfd6f0, 0x6b7a5a, 0.9);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.position.set(300, 400, 200);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1500;
    const shadowExtent = 400;
    this.sun.shadow.camera.left = -shadowExtent;
    this.sun.shadow.camera.right = shadowExtent;
    this.sun.shadow.camera.top = shadowExtent;
    this.sun.shadow.camera.bottom = -shadowExtent;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.backend =
      (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
        ? 'webgpu'
        : 'webgl2';
    log.info(`renderer backend: ${this.backend}`);

    this.applySize();
    this.resizeObserver = new ResizeObserver(() => this.applySize());
    this.resizeObserver.observe(this.host);

    if (GameConfig.rendering.postProcessing) {
      try {
        // TSL post chain works on both backends: scene → bloom → FXAA.
        // Tone mapping/color space are applied by PostProcessing's output.
        const scenePass = pass(this.scene, this.camera);
        const bloomed = scenePass.add(bloom(scenePass, 0.25, 0.4, 0.85));
        this.postProcessing = new PostProcessing(this.renderer);
        this.postProcessing.outputNode = fxaa(bloomed);
        log.info('post-processing enabled (bloom + FXAA)');
      } catch (error) {
        log.warn('post-processing unavailable, using direct render', error);
        this.postProcessing = null;
      }
    }
  }

  render(): void {
    if (this.postProcessing) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private applySize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

export const RendererToken = createToken<RendererService>('engine.renderer');
