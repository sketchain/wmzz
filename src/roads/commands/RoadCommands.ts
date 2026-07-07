import type { Command } from '@/core/commands/Command';
import type { RoadKind } from '../RoadTypes';
import type { NetworkChange, RoadNetwork } from '../RoadNetwork';

/** Build one road segment (with endpoint snapping/splitting). */
export class BuildRoadCommand implements Command {
  readonly label: string;
  private change: NetworkChange | null = null;

  constructor(
    private readonly network: RoadNetwork,
    private readonly ax: number,
    private readonly az: number,
    private readonly bx: number,
    private readonly bz: number,
    private readonly kind: RoadKind,
    private readonly control: { x: number; z: number } | null,
    private readonly oneWay: boolean,
  ) {
    this.label = `road.build.${kind}`;
  }

  execute(): void {
    if (this.change) {
      this.network.reapply(this.change);
      return;
    }
    this.change = this.network.addRoad(
      this.ax,
      this.az,
      this.bx,
      this.bz,
      this.kind,
      this.control,
      this.oneWay,
    );
  }

  undo(): void {
    if (this.change) this.network.revert(this.change);
  }
}

/** Demolish one road edge. */
export class BulldozeRoadCommand implements Command {
  readonly label = 'road.bulldoze';
  private change: NetworkChange | null = null;

  constructor(
    private readonly network: RoadNetwork,
    private readonly edgeId: number,
  ) {}

  execute(): void {
    if (this.change) {
      this.network.reapply(this.change);
      return;
    }
    this.change = this.network.removeEdge(this.edgeId);
  }

  undo(): void {
    if (this.change) this.network.revert(this.change);
  }
}

/** Place a roundabout (ring of one-way segments). */
export class BuildRoundaboutCommand implements Command {
  readonly label = 'road.roundabout';
  private change: NetworkChange | null = null;

  constructor(
    private readonly network: RoadNetwork,
    private readonly x: number,
    private readonly z: number,
  ) {}

  execute(): void {
    if (this.change) {
      this.network.reapply(this.change);
      return;
    }
    this.change = this.network.buildRoundabout(this.x, this.z);
  }

  undo(): void {
    if (this.change) this.network.revert(this.change);
  }
}
