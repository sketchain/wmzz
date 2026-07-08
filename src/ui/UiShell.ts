/**
 * DOM UI layer: shell container, style sheet, element helpers and the
 * draggable Window class. The game UI is deliberately DOM-based — crisp
 * text, free layout/input handling, zero contention with the WebGPU canvas.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STYLES = `
.wui-root { position: fixed; inset: 0; pointer-events: none; z-index: 100;
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  color: #d5dde8; font-size: 13px; user-select: none; }
.wui-root > * { pointer-events: auto; }
.wui-panel { background: rgba(14, 18, 26, 0.92); border: 1px solid rgba(90,130,200,.35);
  border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
.wui-infobar { position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 14px; align-items: center; padding: 6px 16px; white-space: nowrap; }
.wui-infobar .stat { display: flex; flex-direction: column; align-items: center; min-width: 54px; }
.wui-infobar .stat .v { font-weight: 600; color: #fff; font-size: 13px; }
.wui-infobar .stat .k { font-size: 10px; color: #8fa3bd; }
.wui-infobar .demand { display: flex; gap: 3px; align-items: flex-end; height: 26px; }
.wui-infobar .demand div { width: 9px; border-radius: 2px 2px 0 0; min-height: 2px; }
.wui-toolbar { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px; padding: 8px 10px; align-items: center; flex-wrap: wrap;
  max-width: 96vw; justify-content: center; }
.wui-btn { background: rgba(50,64,86,.9); border: 1px solid rgba(120,150,200,.3);
  color: #d5dde8; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px;
  transition: background .12s; white-space: nowrap; }
.wui-btn:hover { background: rgba(70,90,120,.95); }
.wui-btn.active { background: #2f6fbd; color: #fff; border-color: #5a9ae0; }
.wui-btn.danger { border-color: rgba(200,90,90,.5); }
.wui-sep { width: 1px; height: 22px; background: rgba(120,150,200,.25); margin: 0 2px; }
.wui-window { position: absolute; min-width: 240px; }
.wui-window .title { display: flex; justify-content: space-between; align-items: center;
  padding: 7px 12px; font-weight: 600; color: #9ec4f2; cursor: grab;
  border-bottom: 1px solid rgba(90,130,200,.25); }
.wui-window .title .close { cursor: pointer; color: #8fa3bd; padding: 0 4px; }
.wui-window .title .close:hover { color: #fff; }
.wui-window .body { padding: 10px 12px; max-height: 60vh; overflow-y: auto; }
.wui-row { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
.wui-row .k { color: #8fa3bd; }
.wui-row .v { color: #e8eef6; font-weight: 500; }
.wui-slider { width: 100%; }
.wui-minimap { position: absolute; right: 10px; bottom: 10px; padding: 6px; }
.wui-minimap canvas { display: block; border-radius: 4px; cursor: crosshair; }
.wui-section { margin: 8px 0 4px; font-size: 11px; color: #7fa8d8; text-transform: uppercase; letter-spacing: .5px; }
.wui-chart { background: rgba(8,10,16,.6); border-radius: 4px; display: block; margin: 4px 0; }
`;

export class UiShell {
  readonly root: HTMLDivElement;
  private zCounter = 200;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);
    this.root = el('div', 'wui-root');
    parent.appendChild(this.root);
  }

  bringToFront(node: HTMLElement): void {
    node.style.zIndex = String(++this.zCounter);
  }

  dispose(): void {
    this.root.remove();
  }
}

export class UiWindow {
  readonly node: HTMLDivElement;
  readonly body: HTMLDivElement;
  private visible = false;

  constructor(
    private readonly shell: UiShell,
    title: string,
    x: number,
    y: number,
  ) {
    this.node = el('div', 'wui-window wui-panel');
    this.node.style.left = `${x}px`;
    this.node.style.top = `${y}px`;
    this.node.style.display = 'none';

    const titleBar = el('div', 'title');
    const label = el('span', '', title);
    const close = el('span', 'close', '✕');
    close.addEventListener('click', () => this.hide());
    titleBar.append(label, close);
    this.body = el('div', 'body');
    this.node.append(titleBar, this.body);
    shell.root.appendChild(this.node);

    // Drag by title bar.
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    titleBar.addEventListener('pointerdown', (e) => {
      if (e.target === close) return;
      dragging = true;
      offsetX = e.clientX - this.node.offsetLeft;
      offsetY = e.clientY - this.node.offsetTop;
      titleBar.setPointerCapture(e.pointerId);
      shell.bringToFront(this.node);
    });
    titleBar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.node.style.left = `${Math.max(0, e.clientX - offsetX)}px`;
      this.node.style.top = `${Math.max(0, e.clientY - offsetY)}px`;
    });
    titleBar.addEventListener('pointerup', () => (dragging = false));
    this.node.addEventListener('pointerdown', () => shell.bringToFront(this.node));
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.node.style.display = '';
    this.shell.bringToFront(this.node);
  }

  hide(): void {
    this.visible = false;
    this.node.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  dispose(): void {
    this.node.remove();
  }
}

/** Simple key-value row helper used by info panels. */
export function statRow(body: HTMLElement, key: string): HTMLSpanElement {
  const row = el('div', 'wui-row');
  row.appendChild(el('span', 'k', key));
  const value = el('span', 'v', '—');
  row.appendChild(value);
  body.appendChild(row);
  return value;
}
