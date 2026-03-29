/** Simple viewport / camera that follows a target position. */

export class Camera {
  x = 0;
  y = 0;

  constructor(
    public viewW: number,
    public viewH: number,
    public worldW: number,
    public worldH: number,
  ) {}

  /** Centre the camera on (tx, ty), clamped to world bounds. */
  follow(tx: number, ty: number): void {
    this.x = Math.max(0, Math.min(tx - this.viewW / 2, this.worldW - this.viewW));
    this.y = Math.max(0, Math.min(ty - this.viewH / 2, this.worldH - this.viewH));
  }

  /** Apply camera transform to a canvas context. */
  apply(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, -Math.round(this.x), -Math.round(this.y));
  }

  /** Reset transform back to screen space. */
  reset(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Convert screen coords to world coords. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx + this.x, y: sy + this.y };
  }
}
