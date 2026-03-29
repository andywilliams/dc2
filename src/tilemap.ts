/** Minimal tilemap: stores a 2D grid of tile IDs and renders them. */

export const TILE_SIZE = 32;

// Tile type constants
export const TILE_FLOOR = 0;
export const TILE_WALL = 1;

// Colours per tile type — extend as needed
const TILE_COLORS: Record<number, string> = {
  [TILE_FLOOR]: "#2a2a3a",
  [TILE_WALL]: "#6a6a7a",
};

export class TileMap {
  readonly cols: number;
  readonly rows: number;
  private tiles: number[];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.tiles = new Array(cols * rows).fill(TILE_FLOOR);
  }

  get(col: number, row: number): number {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return TILE_WALL;
    return this.tiles[row * this.cols + col];
  }

  set(col: number, row: number, value: number): void {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.tiles[row * this.cols + col] = value;
    }
  }

  get widthPx(): number {
    return this.cols * TILE_SIZE;
  }

  get heightPx(): number {
    return this.rows * TILE_SIZE;
  }

  /** Render only tiles visible within the camera viewport. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, viewW: number, viewH: number): void {
    const startCol = Math.max(0, Math.floor(camX / TILE_SIZE));
    const startRow = Math.max(0, Math.floor(camY / TILE_SIZE));
    const endCol = Math.min(this.cols - 1, Math.floor((camX + viewW) / TILE_SIZE));
    const endRow = Math.min(this.rows - 1, Math.floor((camY + viewH) / TILE_SIZE));

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const tile = this.get(c, r);
        ctx.fillStyle = TILE_COLORS[tile] ?? "#ff00ff";
        ctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // grid lines
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.strokeRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

/** Generate a simple dungeon-like map with walls around the border and random interior walls. */
export function generateDemoMap(cols: number, rows: number): TileMap {
  const map = new TileMap(cols, rows);

  // border walls
  for (let c = 0; c < cols; c++) {
    map.set(c, 0, TILE_WALL);
    map.set(c, rows - 1, TILE_WALL);
  }
  for (let r = 0; r < rows; r++) {
    map.set(0, r, TILE_WALL);
    map.set(cols - 1, r, TILE_WALL);
  }

  // scatter some random walls inside
  for (let i = 0; i < Math.floor(cols * rows * 0.12); i++) {
    const c = 2 + Math.floor(Math.random() * (cols - 4));
    const r = 2 + Math.floor(Math.random() * (rows - 4));
    map.set(c, r, TILE_WALL);
  }

  return map;
}
