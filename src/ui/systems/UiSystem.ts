import * as THREE from 'three';
import { System, SystemStage, type World } from '@/core/ecs';
import type { InputService } from '@/engine/input/InputService';
import type { PickingService } from '@/engine/picking/PickingService';
import { TerrainEditSystem } from '@/terrain/systems/TerrainEditSystem';
import type { InfoBar } from '../panels/InfoBar';
import type { ToolBar } from '../panels/ToolBar';
import type { BudgetWindow } from '../panels/BudgetWindow';
import type { StatsWindow } from '../panels/StatsWindow';
import type { InspectorWindow } from '../panels/InspectorWindow';
import type { MiniMap } from '../panels/MiniMap';
import type { OverlayRenderer } from '../OverlayRenderer';

const REFRESH_MS = 250;

/**
 * Drives all UI panels: throttled data refresh, inspector picking, and the
 * world-space overlay renderer. Runs in the Update stage so it reads the
 * state the current frame will render.
 */
export class UiSystem extends System {
  readonly name = 'UiSystem';
  override readonly stage = SystemStage.Update;
  override readonly order = 50;

  private lastRefresh = 0;
  private readonly hit = new THREE.Vector3();

  constructor(
    private readonly panels: {
      infoBar: InfoBar;
      toolBar: ToolBar;
      budget: BudgetWindow;
      stats: StatsWindow;
      inspector: InspectorWindow;
      miniMap: MiniMap;
      overlay: OverlayRenderer;
    },
    private readonly input: InputService,
    private readonly picking: PickingService,
  ) {
    super();
  }

  override init(): void {
    const { toolBar, budget, stats, inspector, overlay } = this.panels;
    toolBar.onToggleWindow = (name) => {
      const target =
        name === 'budget' ? budget.window : name === 'stats' ? stats.window : inspector.window;
      target.toggle();
      if (name === 'inspector') {
        inspector.active = inspector.window.isVisible;
        TerrainEditSystem.toolLock = inspector.active ? 'inspector' : null;
      }
      toolBar.setWindowActive(name, target.isVisible);
    };
    toolBar.onOverlay = (mode) => overlay.setMode(mode);
  }

  update(_world: World): void {
    const now = performance.now();

    // Inspector picking: left click while the inspector window is open and
    // the pointer isn't over a UI element.
    const inspector = this.panels.inspector;
    if (
      inspector.window.isVisible &&
      this.input.pressed.left &&
      this.input.pointerInside &&
      this.picking.pickGround(this.input.pointerX, this.input.pointerY, this.hit)
    ) {
      inspector.pick(this.hit.x, this.hit.z);
    }
    if (!inspector.window.isVisible && inspector.active) {
      inspector.active = false;
      if (TerrainEditSystem.toolLock === 'inspector') TerrainEditSystem.toolLock = null;
      this.panels.toolBar.setWindowActive('inspector', false);
    }

    this.panels.overlay.update(now);
    this.panels.miniMap.refresh(now);

    if (now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    this.panels.infoBar.refresh();
    this.panels.budget.refresh();
    this.panels.stats.refresh();
    inspector.refresh();
  }
}
