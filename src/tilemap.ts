/** Grid-based tile map with typed tiles, metadata, and viewport-culled rendering. */

export const TILE_SIZE = 32;

// ── Tile type constants ─────────────────────────────────────────────────────
export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_DOOR = 2;
export const TILE_STAIRS_DOWN = 3;

export type TileType = typeof TILE_FLOOR | typeof TILE_WALL | typeof TILE_DOOR | typeof TILE_STAIRS_DOWN;

/** Optional per-tile metadata (e.g. door locked state, stair destination). */
export interface TileMeta {
  label?: string;
  locked?: boolean;
  destination?: number; // floor/level index for stairs
}

/** Stored cell: type + optional metadata. */
export interface TileCell {
  type: TileType;
  meta?: TileMeta;
}

// ── Rendering helpers ───────────────────────────────────────────────────────

function renderFloor(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#2a2a3a";
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  // subtle floor dots for texture
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(x + 8, y + 8, 2, 2);
  ctx.fillRect(x + 22, y + 22, 2, 2);
}

function renderWall(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Main wall body
  ctx.fillStyle = "#5a5a6e";
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  // Brick-like highlights
  ctx.fillStyle = "#6e6e82";
  ctx.fillRect(x + 1, y + 1, 14, 6);
  ctx.fillRect(x + 17, y + 1, 14, 6);
  ctx.fillRect(x + 9, y + 9, 14, 6);
  ctx.fillRect(x + 1, y + 17, 14, 6);
  ctx.fillRect(x + 17, y + 17, 14, 6);
  ctx.fillRect(x + 9, y + 25, 14, 6);
  // Dark mortar lines
  ctx.strokeStyle = "#3a3a4e";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
}

function renderDoor(ctx: CanvasRenderingContext2D, x: number, y: number, locked?: boolean): void {
  // Floor beneath
  ctx.fillStyle = "#2a2a3a";
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  // Door frame
  ctx.fillStyle = "#8b6914";
  ctx.fillRect(x + 4, y + 2, 24, 28);
  // Door panel
  ctx.fillStyle = locked ? "#6b4400" : "#b8860b";
  ctx.fillRect(x + 6, y + 4, 20, 24);
  // Door handle
  ctx.fillStyle = locked ? "#aa3333" : "#ffd700";
  ctx.beginPath();
  ctx.arc(x + 22, y + 16, 2, 0, Math.PI * 2);
  ctx.fill();
  // Arch top
  ctx.fillStyle = "#8b6914";
  ctx.fillRect(x + 4, y + 2, 24, 3);
}

function renderStairsDown(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Dark background
  ctx.fillStyle = "#1a1a28";
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  // Descending steps
  const steps = 5;
  const stepH = TILE_SIZE / steps;
  for (let i = 0; i < steps; i++) {
    const shade = 60 - i * 10;
    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 20})`;
    ctx.fillRect(x + i * 2, y + i * stepH, TILE_SIZE - i * 4, stepH - 1);
  }
  // Down arrow indicator
  ctx.fillStyle = "#66bbff";
  ctx.beginPath();
  ctx.moveTo(x + 16, y + 26);
  ctx.lineTo(x + 12, y + 20);
  ctx.lineTo(x + 20, y + 20);
  ctx.closePath();
  ctx.fill();
}

// ── TileMap class ───────────────────────────────────────────────────────────

export class TileMap {
  readonly cols: number;
  readonly rows: number;
  private cells: TileCell[];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Array(cols * rows).fill(null).map(() => ({ type: TILE_FLOOR as TileType }));
  }

  /** Get tile type at (col, row). Out-of-bounds returns TILE_WALL. */
  get(col: number, row: number): TileType {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return TILE_WALL;
    return this.cells[row * this.cols + col].type;
  }

  /** Get full cell (type + metadata) at (col, row). */
  getCell(col: number, row: number): TileCell | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.cells[row * this.cols + col];
  }

  /** Set tile type at (col, row). */
  set(col: number, row: number, type: TileType, meta?: TileMeta): void {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.cells[row * this.cols + col] = { type, meta };
    }
  }

  get widthPx(): number {
    return this.cols * TILE_SIZE;
  }

  get heightPx(): number {
    return this.rows * TILE_SIZE;
  }

  /** Returns true if the tile at (col, row) blocks movement. */
  isSolid(col: number, row: number): boolean {
    const type = this.get(col, row);
    if (type === TILE_WALL) return true;
    if (type === TILE_DOOR) {
      const cell = this.getCell(col, row);
      return cell?.meta?.locked === true;
    }
    return false;
  }

  /** Render only tiles visible within the camera viewport. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, viewW: number, viewH: number): void {
    const startCol = Math.max(0, Math.floor(camX / TILE_SIZE));
    const startRow = Math.max(0, Math.floor(camY / TILE_SIZE));
    const endCol = Math.min(this.cols - 1, Math.floor((camX + viewW) / TILE_SIZE));
    const endRow = Math.min(this.rows - 1, Math.floor((camY + viewH) / TILE_SIZE));

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const cell = this.cells[r * this.cols + c];
        const px = c * TILE_SIZE;
        const py = r * TILE_SIZE;

        switch (cell.type) {
          case TILE_FLOOR:
            renderFloor(ctx, px, py);
            break;
          case TILE_WALL:
            renderWall(ctx, px, py);
            break;
          case TILE_DOOR:
            renderDoor(ctx, px, py, cell.meta?.locked);
            break;
          case TILE_STAIRS_DOWN:
            renderStairsDown(ctx, px, py);
            break;
          default:
            // Fallback magenta for unknown types
            ctx.fillStyle = "#ff00ff";
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }

        // Grid lines
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

// ── Test map generator ──────────────────────────────────────────────────────

/**
 * A hardcoded test dungeon demonstrating all tile types:
 * floor, wall, doors (locked + unlocked), and stairs-down.
 */
export function generateTestMap(): TileMap {
  const cols = 30;
  const rows = 22;
  const map = new TileMap(cols, rows);

  // Fill everything with walls first
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      map.set(c, r, TILE_WALL);
    }
  }

  // ── Room 1: Entry hall (top-left) ──
  carveRoom(map, 1, 1, 10, 8);

  // ── Room 2: Corridor connecting rooms ──
  // Horizontal corridor from room 1 to room 3
  carveRoom(map, 11, 3, 6, 3);

  // ── Room 3: Large chamber (top-right) ──
  carveRoom(map, 17, 1, 11, 10);
  // Interior pillars
  map.set(20, 4, TILE_WALL);
  map.set(24, 4, TILE_WALL);
  map.set(20, 8, TILE_WALL);
  map.set(24, 8, TILE_WALL);

  // ── Room 4: Side room (bottom-left) ──
  carveRoom(map, 1, 12, 8, 8);

  // ── Room 5: Treasure room (bottom-right, behind locked door) ──
  carveRoom(map, 17, 14, 11, 6);

  // ── Vertical corridor connecting room 1 and room 4 ──
  carveRoom(map, 4, 9, 3, 3);

  // ── Vertical corridor from room 3 down to room 5 ──
  carveRoom(map, 22, 11, 3, 3);

  // ── Doors ──
  // Door between room 1 and horizontal corridor (unlocked)
  map.set(11, 4, TILE_DOOR, { label: "Corridor door" });
  // Door between corridor and room 3 (unlocked)
  map.set(17, 4, TILE_DOOR, { label: "Chamber entrance" });
  // Door from vertical corridor to room 4 (unlocked)
  map.set(5, 12, TILE_DOOR, { label: "Side room door" });
  // Door to treasure room (locked!)
  map.set(23, 14, TILE_DOOR, { label: "Treasure room", locked: true });

  // ── Stairs ──
  // Stairs down in room 3
  map.set(25, 3, TILE_STAIRS_DOWN, { label: "Stairs to level 2", destination: 2 });
  // Stairs down in room 4
  map.set(3, 17, TILE_STAIRS_DOWN, { label: "Secret descent", destination: 2 });

  return map;
}

/** Carve out a rectangular room (set all interior cells to floor). */
function carveRoom(map: TileMap, x: number, y: number, w: number, h: number): void {
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      map.set(c, r, TILE_FLOOR);
    }
  }
}
