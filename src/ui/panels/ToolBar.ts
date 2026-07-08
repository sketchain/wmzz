import type { GameEventBus } from '@/core/events/GameEvents';
import { SERVICES } from '@/data/buildingPrototypes';
import { el, type UiShell } from '../UiShell';
import type { OverlayMode } from '../OverlayRenderer';

/**
 * Bottom toolbar. Tool buttons dispatch the same synthetic key events the
 * keyboard shortcuts use, so UI and hotkeys exercise identical code paths;
 * active-state highlighting comes back through the event bus.
 */
export class ToolBar {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private overlayMode: OverlayMode = 'none';

  onToggleWindow: ((name: 'budget' | 'stats' | 'inspector') => void) | null = null;
  onOverlay: ((mode: OverlayMode) => void) | null = null;

  constructor(shell: UiShell, events: GameEventBus) {
    const bar = el('div', 'wui-toolbar wui-panel');

    const key = (label: string, code: string, id: string): HTMLButtonElement => {
      const button = el('button', 'wui-btn', label);
      button.addEventListener('click', () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      });
      bar.appendChild(button);
      this.buttons.set(id, button);
      return button;
    };
    const sep = (): void => {
      bar.appendChild(el('div', 'wui-sep'));
    };

    // Terrain brushes.
    key('抬升', 'Digit1', 'brush:raise');
    key('降低', 'Digit2', 'brush:lower');
    key('平整', 'Digit3', 'brush:flatten');
    key('平滑', 'Digit4', 'brush:smooth');
    sep();
    // Roads.
    key('街道', 'Digit6', 'road:street');
    key('大道', 'Digit7', 'road:avenue');
    key('高速', 'Digit8', 'road:highway');
    key('环岛', 'Digit9', 'road:roundabout');
    key('拆除', 'Digit0', 'road:bulldoze').classList.add('danger');
    key('曲线', 'KeyC', 'road:curve');
    key('单向', 'KeyV', 'road:oneway');
    sep();
    // Zoning + services.
    key('区划', 'KeyZ', 'zone:cycle');
    key('设施', 'KeyB', 'service:cycle');
    sep();

    // Overlays.
    const overlays: [OverlayMode, string][] = [
      ['traffic', '交通'],
      ['pollution', '污染'],
      ['landValue', '地价'],
      ['power', '电力'],
      ['water', '供水'],
      ['crime', '治安'],
    ];
    for (const [mode, label] of overlays) {
      const button = el('button', 'wui-btn', label);
      button.addEventListener('click', () => {
        this.overlayMode = this.overlayMode === mode ? 'none' : mode;
        this.onOverlay?.(this.overlayMode);
        this.refreshOverlayButtons();
      });
      bar.appendChild(button);
      this.buttons.set(`overlay:${mode}`, button);
    }
    sep();

    // Windows.
    for (const [id, label] of [
      ['budget', '预算'],
      ['stats', '图表'],
      ['inspector', '检查'],
    ] as const) {
      const button = el('button', 'wui-btn', label);
      button.addEventListener('click', () => this.onToggleWindow?.(id));
      bar.appendChild(button);
      this.buttons.set(`window:${id}`, button);
    }

    shell.root.appendChild(bar);

    // Active-state feedback from the tool systems.
    events.on('road:toolChanged', ({ mode, curved, oneWay }) => {
      for (const id of ['street', 'avenue', 'highway', 'roundabout', 'bulldoze']) {
        this.buttons.get(`road:${id}`)?.classList.toggle('active', mode === id);
      }
      this.buttons.get('road:curve')?.classList.toggle('active', curved);
      this.buttons.get('road:oneway')?.classList.toggle('active', oneWay);
    });
    events.on('zone:toolChanged', ({ zone }) => {
      this.buttons.get('zone:cycle')?.classList.toggle('active', zone !== null);
      const button = this.buttons.get('zone:cycle');
      if (button) button.textContent = zone !== null ? `区划:${['', '住', '商', '工', '办'][zone]}` : '区划';
    });
    events.on('service:toolChanged', ({ kind }) => {
      this.buttons.get('service:cycle')?.classList.toggle('active', kind !== null);
      const button = this.buttons.get('service:cycle');
      if (button) button.textContent = kind !== null ? `设施:${SERVICES[kind].label}` : '设施';
    });
    events.on('terrain:brushChanged', ({ mode }) => {
      for (const [id, name] of [
        ['brush:raise', 'raise'],
        ['brush:lower', 'lower'],
        ['brush:flatten', 'flatten'],
        ['brush:smooth', 'smooth'],
      ] as const) {
        this.buttons.get(id)?.classList.toggle('active', mode === name);
      }
    });
  }

  setWindowActive(name: 'budget' | 'stats' | 'inspector', active: boolean): void {
    this.buttons.get(`window:${name}`)?.classList.toggle('active', active);
  }

  private refreshOverlayButtons(): void {
    for (const mode of ['traffic', 'pollution', 'landValue', 'power', 'water', 'crime']) {
      this.buttons
        .get(`overlay:${mode}`)
        ?.classList.toggle('active', this.overlayMode === mode);
    }
  }
}
