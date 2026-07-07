import { createToken, type Disposable } from '@/core/di/ServiceContainer';

export interface PointerButtonState {
  left: boolean;
  middle: boolean;
  right: boolean;
}

/**
 * Frame-coherent input snapshot. Event listeners write into the pending
 * state; `beginFrame()` (called by InputSystem at the top of each frame)
 * promotes it so every system sees identical input for the whole frame.
 */
export class InputService implements Disposable {
  /** Keys currently held (KeyboardEvent.code). */
  readonly keys = new Set<string>();
  /** Keys that went down this frame. */
  readonly keysPressed = new Set<string>();

  pointerX = 0;
  pointerY = 0;
  pointerDeltaX = 0;
  pointerDeltaY = 0;
  wheelDelta = 0;
  readonly buttons: PointerButtonState = { left: false, middle: false, right: false };
  /** Buttons that went down this frame. */
  readonly pressed: PointerButtonState = { left: false, middle: false, right: false };
  /** Buttons that went up this frame. */
  readonly released: PointerButtonState = { left: false, middle: false, right: false };
  pointerInside = true;

  private pendingKeysPressed = new Set<string>();
  private pendingDeltaX = 0;
  private pendingDeltaY = 0;
  private pendingWheel = 0;
  private pendingPressed: PointerButtonState = { left: false, middle: false, right: false };
  private pendingReleased: PointerButtonState = { left: false, middle: false, right: false };
  private readonly teardown: (() => void)[] = [];

  constructor(private readonly element: HTMLElement) {
    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K | keyof WindowEventMap,
      handler: (event: never) => void,
      options?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(type as string, handler as EventListener, options);
      this.teardown.push(() =>
        target.removeEventListener(type as string, handler as EventListener),
      );
    };

    listen(window, 'keydown', (e: KeyboardEvent) => {
      if (!this.keys.has(e.code)) this.pendingKeysPressed.add(e.code);
      this.keys.add(e.code);
    });
    listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    listen(window, 'blur', () => this.keys.clear());

    listen(element, 'pointermove', (e: PointerEvent) => {
      const rect = this.element.getBoundingClientRect();
      this.pointerX = e.clientX - rect.left;
      this.pointerY = e.clientY - rect.top;
      this.pendingDeltaX += e.movementX;
      this.pendingDeltaY += e.movementY;
    });
    listen(element, 'pointerdown', (e: PointerEvent) => {
      this.element.setPointerCapture(e.pointerId);
      if (e.button === 0) (this.buttons.left = true), (this.pendingPressed.left = true);
      if (e.button === 1) (this.buttons.middle = true), (this.pendingPressed.middle = true);
      if (e.button === 2) (this.buttons.right = true), (this.pendingPressed.right = true);
    });
    listen(element, 'pointerup', (e: PointerEvent) => {
      if (e.button === 0) (this.buttons.left = false), (this.pendingReleased.left = true);
      if (e.button === 1) (this.buttons.middle = false), (this.pendingReleased.middle = true);
      if (e.button === 2) (this.buttons.right = false), (this.pendingReleased.right = true);
    });
    listen(element, 'pointerenter', () => (this.pointerInside = true));
    listen(element, 'pointerleave', () => (this.pointerInside = false));
    listen(element, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      this.pendingWheel += e.deltaY;
    }, { passive: false });
    listen(element, 'contextmenu', (e: MouseEvent) => e.preventDefault());
  }

  /** Promote pending event data into the per-frame snapshot. */
  beginFrame(): void {
    this.pointerDeltaX = this.pendingDeltaX;
    this.pointerDeltaY = this.pendingDeltaY;
    this.wheelDelta = this.pendingWheel;
    this.pendingDeltaX = 0;
    this.pendingDeltaY = 0;
    this.pendingWheel = 0;

    this.keysPressed.clear();
    for (const code of this.pendingKeysPressed) this.keysPressed.add(code);
    this.pendingKeysPressed.clear();

    for (const button of ['left', 'middle', 'right'] as const) {
      this.pressed[button] = this.pendingPressed[button];
      this.released[button] = this.pendingReleased[button];
      this.pendingPressed[button] = false;
      this.pendingReleased[button] = false;
    }
  }

  dispose(): void {
    for (const remove of this.teardown) remove();
    this.teardown.length = 0;
  }
}

export const InputToken = createToken<InputService>('engine.input');
