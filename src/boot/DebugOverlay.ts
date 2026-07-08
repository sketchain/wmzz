export interface OverlayStats {
  fps: number;
  frameMs: number;
  entities: number;
  tick: number;
  frame: number;
  systems: ReadonlyMap<string, number>;
  extra?: Record<string, string>;
}

/**
 * Lightweight DOM diagnostics panel. Exists throughout development; the
 * player-facing UI framework replaces gameplay HUD duties in Phase 9.
 */
export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private lastRender = 0;

  constructor(parent: HTMLElement, private readonly title = 'WMZZ City — 调试面板') {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      top: '12px',
      left: '12px',
      minWidth: '260px',
      padding: '10px 14px',
      background: 'rgba(12, 16, 24, 0.85)',
      border: '1px solid rgba(90, 130, 200, 0.35)',
      borderRadius: '8px',
      font: '12px/1.6 "JetBrains Mono", Consolas, monospace',
      color: '#b9c8de',
      pointerEvents: 'none',
      zIndex: '1000',
      whiteSpace: 'pre',
    } satisfies Partial<CSSStyleDeclaration>);

    const header = document.createElement('div');
    header.textContent = this.title;
    Object.assign(header.style, {
      fontWeight: '600',
      color: '#7fb3ff',
      marginBottom: '6px',
    } satisfies Partial<CSSStyleDeclaration>);

    this.body = document.createElement('div');
    this.root.append(header, this.body);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  get isVisible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** Throttled to ~5 updates/s so the overlay itself stays free. */
  update(stats: OverlayStats): void {
    const now = performance.now();
    if (now - this.lastRender < 200) return;
    this.lastRender = now;

    const lines: string[] = [
      `FPS        ${stats.fps.toFixed(0)}`,
      `Frame      ${stats.frameMs.toFixed(2)} ms  (#${stats.frame})`,
      `Sim tick   #${stats.tick}`,
      `Entities   ${stats.entities.toLocaleString()}`,
    ];
    if (stats.extra) {
      for (const [key, value] of Object.entries(stats.extra)) {
        lines.push(`${key.padEnd(10)} ${value}`);
      }
    }
    if (stats.systems.size > 0) {
      lines.push('── systems ──');
      for (const [name, ms] of stats.systems) {
        lines.push(`${name.padEnd(18)} ${ms.toFixed(2)} ms`);
      }
    }
    this.body.textContent = lines.join('\n');
  }

  dispose(): void {
    this.root.remove();
  }
}
