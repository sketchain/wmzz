import type { Command } from '@/core/commands/Command';
import type { Entity } from '@/core/ecs';
import { NULL_ENTITY } from '@/core/ecs';
import type { ServiceKind, ZoneId } from '@/data/buildingPrototypes';
import type { BuildingFactory } from '../BuildingFactory';
import type { ZoneGrid } from '../ZoneGrid';

export interface ZoneCellEdit {
  cx: number;
  cz: number;
  before: ZoneId;
  after: ZoneId;
}

/**
 * One zoning brush stroke. Like terrain strokes, edits are applied live for
 * feedback and the command is pushed on pointer release, so the first
 * execute is a no-op.
 */
export class PaintZoneCommand implements Command {
  readonly label: string;
  private applied = true;

  constructor(
    private readonly grid: ZoneGrid,
    private readonly edits: ZoneCellEdit[],
    zone: ZoneId,
  ) {
    this.label = `zone.paint.${zone}`;
  }

  execute(): void {
    if (this.applied) return;
    for (const edit of this.edits) this.grid.restore(edit.cx, edit.cz, edit.after);
  }

  undo(): void {
    this.applied = false;
    for (const edit of this.edits) this.grid.restore(edit.cx, edit.cz, edit.before);
  }
}

/** Place one service building. */
export class PlaceServiceCommand implements Command {
  readonly label: string;
  private entity: Entity = NULL_ENTITY;

  constructor(
    private readonly factory: BuildingFactory,
    private readonly kind: ServiceKind,
    private readonly x: number,
    private readonly z: number,
    private readonly rotation: number,
  ) {
    this.label = `service.place.${kind}`;
  }

  execute(): void {
    this.entity = this.factory.spawnService(this.kind, this.x, this.z, this.rotation);
  }

  undo(): void {
    if (this.entity !== NULL_ENTITY) {
      this.factory.demolish(this.entity);
      this.entity = NULL_ENTITY;
    }
  }
}

/**
 * Demolish a building. Redo re-demolishes; undo cannot resurrect the exact
 * occupants (they re-grow), matching city-builder convention where bulldoze
 * undo restores the lot, not the residents.
 */
export class DemolishBuildingCommand implements Command {
  readonly label = 'building.demolish';

  constructor(
    private readonly factory: BuildingFactory,
    private readonly grid: ZoneGrid,
    private entity: Entity,
    private readonly cellX: number,
    private readonly cellZ: number,
  ) {}

  execute(): void {
    if (this.entity !== NULL_ENTITY) {
      this.factory.demolish(this.entity);
      this.entity = NULL_ENTITY;
    }
  }

  undo(): void {
    // The zone cell stays painted; growth will redevelop the lot.
    this.grid.clearBuilding(this.cellX, this.cellZ);
  }
}
