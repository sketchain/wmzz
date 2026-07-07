import * as THREE from 'three';
import { System, SystemStage, type TickContext, type World } from '@/core/ecs';
import type { CommandStack } from '@/core/commands/CommandStack';
import type { GameEventBus } from '@/core/events/GameEvents';
import type { InputService } from '@/engine/input/InputService';
import type { PickingService } from '@/engine/picking/PickingService';
import { TerrainEditSystem } from '@/terrain/systems/TerrainEditSystem';
import {
  SERVICES,
  SERVICE_ORDER,
  ZONE_COMMERCIAL,
  ZONE_INDUSTRIAL,
  ZONE_LABELS,
  ZONE_NONE,
  ZONE_OFFICE,
  ZONE_RESIDENTIAL,
  type ServiceKind,
  type ZoneId,
} from '@/data/buildingPrototypes';
import { ZoneGrid } from '../ZoneGrid';
import type { ZoneOverlay } from '../ZoneOverlay';
import type { BuildingFactory } from '../BuildingFactory';
import {
  PaintZoneCommand,
  PlaceServiceCommand,
  type ZoneCellEdit,
} from '../commands/BuildingCommands';

declare module '@/core/events/GameEvents' {
  interface GameEvents {
    'zone:toolChanged': { zone: ZoneId | null; erase: boolean };
    'service:toolChanged': { kind: ServiceKind | null };
  }
}

const ZONE_CYCLE: ZoneId[] = [
  ZONE_RESIDENTIAL,
  ZONE_COMMERCIAL,
  ZONE_INDUSTRIAL,
  ZONE_OFFICE,
];

/**
 * Zoning & service placement tool.
 *  Z cycles zone type (R→C→I→O→off) · hold Alt while painting to erase
 *  B cycles service building · click places it · Esc exits tool
 */
export class ZoneToolSystem extends System {
  readonly name = 'ZoneToolSystem';
  override readonly stage = SystemStage.Input;
  override readonly order = 8;

  private zoneIndex = -1; // -1 = off
  private serviceIndex = -1; // -1 = off
  private readonly hit = new THREE.Vector3();
  private strokeEdits = new Map<number, ZoneCellEdit>();
  private strokeZone: ZoneId = ZONE_NONE;

  constructor(
    private readonly grid: ZoneGrid,
    private readonly overlay: ZoneOverlay,
    private readonly factory: BuildingFactory,
    private readonly input: InputService,
    private readonly picking: PickingService,
    private readonly commands: CommandStack,
    private readonly events: GameEventBus,
  ) {
    super();
  }

  update(_world: World, _ctx: TickContext): void {
    const input = this.input;
    const ctrlHeld = input.keys.has('ControlLeft') || input.keys.has('ControlRight');

    if (!ctrlHeld && input.keysPressed.has('KeyZ')) {
      this.zoneIndex = this.zoneIndex + 1 >= ZONE_CYCLE.length ? -1 : this.zoneIndex + 1;
      this.serviceIndex = -1;
      this.syncToolState();
    }
    if (input.keysPressed.has('KeyB')) {
      this.serviceIndex =
        this.serviceIndex + 1 >= SERVICE_ORDER.length ? -1 : this.serviceIndex + 1;
      this.zoneIndex = -1;
      this.syncToolState();
    }
    if (input.keysPressed.has('Escape') && (this.zoneIndex >= 0 || this.serviceIndex >= 0)) {
      this.zoneIndex = -1;
      this.serviceIndex = -1;
      this.syncToolState();
    }

    if (this.serviceIndex >= 0) {
      this.updateServicePlacement();
      return;
    }
    if (this.zoneIndex < 0) return;

    const erase = input.keys.has('AltLeft') || input.keys.has('AltRight');
    const zone = erase ? ZONE_NONE : ZONE_CYCLE[this.zoneIndex];

    if (
      input.buttons.left &&
      input.pointerInside &&
      this.picking.pickGround(input.pointerX, input.pointerY, this.hit)
    ) {
      if (this.strokeEdits.size === 0) this.strokeZone = zone;
      // 3×3 cell dab around the cursor.
      const ccx = ZoneGrid.worldToCell(this.hit.x);
      const ccz = ZoneGrid.worldToCell(this.hit.z);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ccx + dx;
          const cz = ccz + dz;
          const key = ((cx + 0x8000) << 16) | ((cz + 0x8000) & 0xffff);
          if (this.strokeEdits.has(key)) continue;
          const result = this.grid.paint(cx, cz, zone);
          if (result) {
            this.strokeEdits.set(key, { cx, cz, before: result.previous, after: zone });
          }
        }
      }
    } else if (this.strokeEdits.size > 0) {
      this.commands.execute(
        new PaintZoneCommand(this.grid, [...this.strokeEdits.values()], this.strokeZone),
      );
      this.strokeEdits.clear();
    }
  }

  private updateServicePlacement(): void {
    const input = this.input;
    if (
      input.pressed.left &&
      input.pointerInside &&
      this.picking.pickGround(input.pointerX, input.pointerY, this.hit)
    ) {
      const kind = SERVICE_ORDER[this.serviceIndex];
      this.commands.execute(
        new PlaceServiceCommand(this.factory, kind, this.hit.x, this.hit.z, 0),
      );
    }
  }

  private syncToolState(): void {
    const zoneActive = this.zoneIndex >= 0;
    const serviceActive = this.serviceIndex >= 0;
    this.overlay.visible = zoneActive;
    this.overlay.invalidate();
    TerrainEditSystem.toolLock = zoneActive || serviceActive ? 'zoning' : null;
    this.events.emit('zone:toolChanged', {
      zone: zoneActive ? ZONE_CYCLE[this.zoneIndex] : null,
      erase: false,
    });
    this.events.emit('service:toolChanged', {
      kind: serviceActive ? SERVICE_ORDER[this.serviceIndex] : null,
    });
  }
}

export { ZONE_LABELS, SERVICES };
