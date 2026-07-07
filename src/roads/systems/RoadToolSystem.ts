import * as THREE from 'three';
import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import type { CommandStack } from '@/core/commands/CommandStack';
import type { GameEventBus } from '@/core/events/GameEvents';
import type { InputService } from '@/engine/input/InputService';
import type { PickingService } from '@/engine/picking/PickingService';
import type { RendererService } from '@/engine/renderer/RendererService';
import { TerrainEditSystem } from '@/terrain/systems/TerrainEditSystem';
import { MAX_ROAD_GRADE, type RoadKind } from '../RoadTypes';
import type { RoadNetwork } from '../RoadNetwork';
import {
  BuildRoadCommand,
  BuildRoundaboutCommand,
  BulldozeRoadCommand,
} from '../commands/RoadCommands';

export type RoadToolMode = RoadKind | 'roundabout' | 'bulldoze' | null;

declare module '@/core/events/GameEvents' {
  interface GameEvents {
    'road:toolChanged': {
      mode: RoadToolMode;
      curved: boolean;
      oneWay: boolean;
    };
    'road:built': { cost: number };
  }
}

const MODE_KEYS: Record<string, Exclude<RoadToolMode, null>> = {
  Digit6: 'street',
  Digit7: 'avenue',
  Digit8: 'highway',
  Digit9: 'roundabout',
  Digit0: 'bulldoze',
};

/**
 * Road placement tool.
 *  6/7/8 street/avenue/highway · 9 roundabout · 0 bulldoze (again = off)
 *  C toggle curved (3-click bezier) · V toggle one-way · Esc cancel
 * Straight mode chains: each placement continues from the last endpoint.
 */
export class RoadToolSystem extends System {
  readonly name = 'RoadToolSystem';
  override readonly stage = SystemStage.Input;
  override readonly order = 5;

  private mode: RoadToolMode = null;
  private curved = false;
  private oneWay = false;
  private anchor: { x: number; z: number } | null = null;
  private control: { x: number; z: number } | null = null;

  private readonly hit = new THREE.Vector3();
  private previewLine: THREE.Line | null = null;
  private readonly previewMaterial = new THREE.LineBasicMaterial({ color: 0x44dd66 });
  private readonly previewGeometry = new THREE.BufferGeometry();
  private readonly previewPositions = new Float32Array(48 * 3);

  constructor(
    private readonly network: RoadNetwork,
    private readonly input: InputService,
    private readonly picking: PickingService,
    private readonly commands: CommandStack,
    private readonly renderer: RendererService,
    private readonly events: GameEventBus,
  ) {
    super();
  }

  override init(): void {
    this.previewGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.previewPositions, 3),
    );
    this.previewGeometry.setDrawRange(0, 0);
    this.previewLine = new THREE.Line(this.previewGeometry, this.previewMaterial);
    this.previewLine.frustumCulled = false;
    this.previewLine.visible = false;
    this.renderer.scene.add(this.previewLine);
  }

  update(_world: World, _ctx: TickContext): void {
    const input = this.input;

    for (const [code, mode] of Object.entries(MODE_KEYS)) {
      if (input.keysPressed.has(code)) {
        this.setMode(this.mode === mode ? null : mode);
      }
    }
    if (input.keysPressed.has('KeyC')) {
      this.curved = !this.curved;
      this.resetPlacement();
      this.emitToolChanged();
    }
    if (input.keysPressed.has('KeyV')) {
      this.oneWay = !this.oneWay;
      this.emitToolChanged();
    }
    if (input.keysPressed.has('Escape')) {
      if (this.anchor) this.resetPlacement();
      else this.setMode(null);
    }

    if (this.mode === null) return;

    const hasGround =
      input.pointerInside &&
      this.picking.pickGround(input.pointerX, input.pointerY, this.hit);

    if (this.mode === 'bulldoze') {
      if (hasGround && input.pressed.left) {
        const snap = this.network.snapEdge(this.hit.x, this.hit.z, 8);
        if (snap) this.commands.execute(new BulldozeRoadCommand(this.network, snap.edge.id));
      }
      return;
    }

    if (this.mode === 'roundabout') {
      if (hasGround && input.pressed.left) {
        this.commands.execute(
          new BuildRoundaboutCommand(this.network, this.hit.x, this.hit.z),
        );
      }
      return;
    }

    // Segment placement (street/avenue/highway).
    if (!hasGround) {
      if (this.previewLine) this.previewLine.visible = false;
      return;
    }
    const snapped = this.applySnap(this.hit.x, this.hit.z);

    if (input.pressed.left) {
      if (!this.anchor) {
        this.anchor = snapped;
      } else if (this.curved && !this.control) {
        this.control = snapped;
      } else {
        const valid = this.gradeOk(this.anchor, snapped);
        if (valid) {
          const length = Math.hypot(snapped.x - this.anchor.x, snapped.z - this.anchor.z);
          this.commands.execute(
            new BuildRoadCommand(
              this.network,
              this.anchor.x,
              this.anchor.z,
              snapped.x,
              snapped.z,
              this.mode,
              this.control,
              this.oneWay,
            ),
          );
          this.events.emit('road:built', {
            cost: this.network.estimateCost(length, this.mode),
          });
          this.anchor = snapped; // chain next segment
          this.control = null;
        }
      }
    }
    if (input.pressed.right && this.anchor) {
      this.resetPlacement();
    }

    this.updatePreview(snapped);
  }

  private setMode(mode: RoadToolMode): void {
    this.mode = mode;
    this.resetPlacement();
    TerrainEditSystem.toolLock = mode === null ? null : 'roads';
    this.emitToolChanged();
  }

  private resetPlacement(): void {
    this.anchor = null;
    this.control = null;
    if (this.previewLine) this.previewLine.visible = false;
  }

  private applySnap(x: number, z: number): { x: number; z: number } {
    const node = this.network.snapNode(x, z);
    if (node) return { x: node.x, z: node.z };
    const edge = this.network.snapEdge(x, z);
    if (edge) return { x: edge.x, z: edge.z };
    return { x, z };
  }

  private gradeOk(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 4) return false;
    const ya = this.terrainHeight(a.x, a.z);
    const yb = this.terrainHeight(b.x, b.z);
    return Math.abs(yb - ya) / length <= MAX_ROAD_GRADE;
  }

  /** Injected by main wiring (avoids direct terrain dependency). */
  terrainHeight: (x: number, z: number) => number = () => 0;

  private updatePreview(cursor: { x: number; z: number }): void {
    const line = this.previewLine;
    if (!line) return;
    if (!this.anchor) {
      line.visible = false;
      return;
    }
    const a = this.anchor;
    const c = this.curved ? (this.control ?? null) : null;
    const samples = 48;
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      let x: number;
      let z: number;
      if (c) {
        const u = 1 - t;
        x = u * u * a.x + 2 * u * t * c.x + t * t * cursor.x;
        z = u * u * a.z + 2 * u * t * c.z + t * t * cursor.z;
      } else {
        x = a.x + (cursor.x - a.x) * t;
        z = a.z + (cursor.z - a.z) * t;
      }
      this.previewPositions[i * 3] = x;
      this.previewPositions[i * 3 + 1] = this.terrainHeight(x, z) + 0.6;
      this.previewPositions[i * 3 + 2] = z;
    }
    this.previewGeometry.attributes.position.needsUpdate = true;
    this.previewGeometry.setDrawRange(0, samples);
    this.previewMaterial.color.set(this.gradeOk(a, cursor) ? 0x44dd66 : 0xdd4444);
    line.visible = true;
  }

  private emitToolChanged(): void {
    this.events.emit('road:toolChanged', {
      mode: this.mode,
      curved: this.curved,
      oneWay: this.oneWay,
    });
  }

  override dispose(): void {
    if (this.previewLine) {
      this.renderer.scene.remove(this.previewLine);
      this.previewGeometry.dispose();
      this.previewMaterial.dispose();
    }
  }
}

/** Syncs road meshes with the network once per frame. */
export class RoadSyncSystem extends System {
  readonly name = 'RoadSyncSystem';
  override readonly stage = SystemStage.Update;
  override readonly order = 10;

  constructor(private readonly sync: () => void) {
    super();
  }

  update(): void {
    this.sync();
  }
}
