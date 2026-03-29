/** Tracks keyboard and mouse input state each frame. */

export interface MouseState {
  x: number;
  y: number;
  down: boolean;
  clicked: boolean; // true for one frame on mousedown
}

export class Input {
  private _keys = new Set<string>();
  private _justPressed = new Set<string>();
  private _justReleased = new Set<string>();
  readonly mouse: MouseState = { x: 0, y: 0, down: false, clicked: false };

  private _pendingDown: string[] = [];
  private _pendingUp: string[] = [];
  private _pendingClick = false;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (!e.repeat) this._pendingDown.push(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this._pendingUp.push(e.code);
    });
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener("mousedown", () => {
      this.mouse.down = true;
      this._pendingClick = true;
    });
    canvas.addEventListener("mouseup", () => {
      this.mouse.down = false;
    });
  }

  /** Call once at the start of each frame. */
  update(): void {
    this._justPressed.clear();
    this._justReleased.clear();
    this.mouse.clicked = this._pendingClick;
    this._pendingClick = false;

    for (const k of this._pendingDown) {
      this._keys.add(k);
      this._justPressed.add(k);
    }
    for (const k of this._pendingUp) {
      this._keys.delete(k);
      this._justReleased.add(k);
    }
    this._pendingDown.length = 0;
    this._pendingUp.length = 0;
  }

  isDown(code: string): boolean {
    return this._keys.has(code);
  }

  justPressed(code: string): boolean {
    return this._justPressed.has(code);
  }

  justReleased(code: string): boolean {
    return this._justReleased.has(code);
  }
}
