/** Party system: 4-character party with stats and grid-based turn movement. */

import { TileMap, TILE_SIZE } from "./tilemap";
import { getReachableTiles, findPath, GridPos } from "./pathfinding";

// ── Character definition ───────────────────────────────────────────────────

export interface CharacterStats {
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  moveRange: number; // tiles per turn
}

export interface Character {
  name: string;
  stats: CharacterStats;
  color: string;       // primary fill color
  accent: string;      // outline / accent color
  icon: string;        // single character icon rendered on sprite
}

// ── Party state ────────────────────────────────────────────────────────────

export type TurnPhase = "move" | "animating" | "done";

export interface PartyState {
  members: Character[];
  /** Grid position of the party (they move as a group). */
  col: number;
  row: number;
  /** Pixel position for smooth animation. */
  px: number;
  py: number;
  /** Turn-based state. */
  movePointsLeft: number;
  movePointsPerTurn: number;
  turnPhase: TurnPhase;
  /** Current path being animated (grid positions). */
  currentPath: GridPos[];
  pathIndex: number;
  /** Reachable tiles (cached for current turn). */
  reachableTiles: Map<string, number> | null;
}

// ── Default party ──────────────────────────────────────────────────────────

export function createDefaultParty(): Character[] {
  return [
    {
      name: "Knight",
      stats: { hp: 30, maxHp: 30, atk: 8, def: 6, moveRange: 5 },
      color: "#4488cc",
      accent: "#6ab0ff",
      icon: "K",
    },
    {
      name: "Mage",
      stats: { hp: 18, maxHp: 18, atk: 12, def: 2, moveRange: 4 },
      color: "#9944cc",
      accent: "#c477ff",
      icon: "M",
    },
    {
      name: "Rogue",
      stats: { hp: 22, maxHp: 22, atk: 10, def: 3, moveRange: 7 },
      color: "#44aa44",
      accent: "#77dd77",
      icon: "R",
    },
    {
      name: "Cleric",
      stats: { hp: 24, maxHp: 24, atk: 5, def: 5, moveRange: 4 },
      color: "#ccaa44",
      accent: "#ffdd77",
      icon: "C",
    },
  ];
}

export function createPartyState(col: number, row: number): PartyState {
  return {
    members: createDefaultParty(),
    col,
    row,
    px: col * TILE_SIZE + TILE_SIZE / 2,
    py: row * TILE_SIZE + TILE_SIZE / 2,
    movePointsPerTurn: 5, // base movement range per turn
    movePointsLeft: 5,
    turnPhase: "move",
    currentPath: [],
    pathIndex: 0,
    reachableTiles: null,
  };
}

// ── Movement logic ─────────────────────────────────────────────────────────

const MOVE_ANIM_SPEED = 200; // pixels per second for path animation

/** Cache reachable tiles for the current position and remaining move points. */
export function cacheReachable(party: PartyState, map: TileMap): void {
  party.reachableTiles = getReachableTiles(
    map,
    { col: party.col, row: party.row },
    party.movePointsLeft,
  );
}

/** Start moving the party along a path to the target tile. Returns false if unreachable. */
export function startMove(
  party: PartyState,
  targetCol: number,
  targetRow: number,
  map: TileMap,
): boolean {
  if (party.turnPhase !== "move") return false;

  const path = findPath(
    map,
    { col: party.col, row: party.row },
    { col: targetCol, row: targetRow },
    party.movePointsLeft,
  );

  if (!path || path.length === 0) return false;

  party.currentPath = path;
  party.pathIndex = 0;
  party.turnPhase = "animating";
  return true;
}

/** Update movement animation. Call each frame with delta time. */
export function updateMovement(party: PartyState, dt: number): void {
  if (party.turnPhase !== "animating") return;
  if (party.pathIndex >= party.currentPath.length) {
    // Animation complete
    party.turnPhase = "move";
    party.currentPath = [];
    party.pathIndex = 0;
    return;
  }

  const target = party.currentPath[party.pathIndex];
  const targetPx = target.col * TILE_SIZE + TILE_SIZE / 2;
  const targetPy = target.row * TILE_SIZE + TILE_SIZE / 2;

  const ddx = targetPx - party.px;
  const ddy = targetPy - party.py;
  const dist = Math.sqrt(ddx * ddx + ddy * ddy);

  if (dist < 2) {
    // Snap to tile
    party.px = targetPx;
    party.py = targetPy;
    party.col = target.col;
    party.row = target.row;
    party.movePointsLeft--;
    party.pathIndex++;

    if (party.pathIndex >= party.currentPath.length) {
      party.turnPhase = "move";
      party.currentPath = [];
      party.pathIndex = 0;
      party.reachableTiles = null; // invalidate cache
    }
  } else {
    const step = MOVE_ANIM_SPEED * dt;
    party.px += (ddx / dist) * Math.min(step, dist);
    party.py += (ddy / dist) * Math.min(step, dist);
  }
}

/** End the current turn and start a new one with full move points. */
export function endTurn(party: PartyState): void {
  party.movePointsLeft = party.movePointsPerTurn;
  party.turnPhase = "move";
  party.reachableTiles = null;
}

// ── Rendering ──────────────────────────────────────────────────────────────

const REACHABLE_COLOR = "rgba(100, 200, 255, 0.15)";
const REACHABLE_BORDER = "rgba(100, 200, 255, 0.3)";
const PATH_COLOR = "rgba(255, 220, 100, 0.3)";

/** Render movement range highlight overlay. */
export function renderReachable(
  ctx: CanvasRenderingContext2D,
  party: PartyState,
  map: TileMap,
): void {
  if (party.turnPhase !== "move") return;

  if (!party.reachableTiles) {
    cacheReachable(party, map);
  }

  const tiles = party.reachableTiles!;
  for (const [key] of tiles) {
    const [c, r] = key.split(",").map(Number);
    // Skip party's current tile
    if (c === party.col && r === party.row) continue;
    const px = c * TILE_SIZE;
    const py = r * TILE_SIZE;
    ctx.fillStyle = REACHABLE_COLOR;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = REACHABLE_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
  }
}

/** Render path preview when hovering a reachable tile. */
export function renderPathPreview(
  ctx: CanvasRenderingContext2D,
  party: PartyState,
  map: TileMap,
  hoverCol: number,
  hoverRow: number,
): void {
  if (party.turnPhase !== "move") return;
  if (!party.reachableTiles) return;

  const key = `${hoverCol},${hoverRow}`;
  if (!party.reachableTiles.has(key)) return;
  if (hoverCol === party.col && hoverRow === party.row) return;

  const path = findPath(
    map,
    { col: party.col, row: party.row },
    { col: hoverCol, row: hoverRow },
    party.movePointsLeft,
  );

  if (!path) return;

  for (const step of path) {
    const px = step.col * TILE_SIZE;
    const py = step.row * TILE_SIZE;
    ctx.fillStyle = PATH_COLOR;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  }
}

/** Render the party members on the grid. */
export function renderParty(
  ctx: CanvasRenderingContext2D,
  party: PartyState,
): void {
  const members = party.members;
  // Party members are rendered in a 2x2 formation around the party center
  const offsets = [
    { dx: -6, dy: -6 },  // top-left
    { dx: 6, dy: -6 },   // top-right
    { dx: -6, dy: 6 },   // bottom-left
    { dx: 6, dy: 6 },    // bottom-right
  ];

  const spriteSize = 12;
  const half = spriteSize / 2;

  for (let i = 0; i < members.length; i++) {
    const char = members[i];
    const ox = party.px + offsets[i].dx;
    const oy = party.py + offsets[i].dy;

    // Body
    ctx.fillStyle = char.color;
    ctx.fillRect(ox - half, oy - half, spriteSize, spriteSize);

    // Outline
    ctx.strokeStyle = char.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox - half, oy - half, spriteSize, spriteSize);

    // Icon letter
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char.icon, ox, oy + 1);
  }

  // Reset text alignment
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Render party stats HUD panel. */
export function renderPartyHUD(
  ctx: CanvasRenderingContext2D,
  party: PartyState,
  canvasW: number,
): void {
  const panelW = 180;
  const panelH = 120;
  const panelX = canvasW - panelW - 8;
  const panelY = 8;

  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  // Title
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 11px monospace";
  ctx.fillText("Party", panelX + 6, panelY + 14);

  // Move points
  ctx.fillStyle = "#88ccff";
  ctx.font = "10px monospace";
  ctx.fillText(
    `Moves: ${party.movePointsLeft}/${party.movePointsPerTurn}`,
    panelX + 70,
    panelY + 14,
  );

  // Members
  for (let i = 0; i < party.members.length; i++) {
    const char = party.members[i];
    const y = panelY + 28 + i * 22;

    // Color swatch
    ctx.fillStyle = char.color;
    ctx.fillRect(panelX + 6, y - 6, 8, 8);

    // Name
    ctx.fillStyle = "#ddd";
    ctx.font = "10px monospace";
    ctx.fillText(char.name, panelX + 18, y);

    // HP bar background
    const barX = panelX + 70;
    const barW = 60;
    const barH = 6;
    ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
    ctx.fillRect(barX, y - 6, barW, barH);

    // HP bar fill
    const hpRatio = char.stats.hp / char.stats.maxHp;
    const hpColor = hpRatio > 0.5 ? "#44bb44" : hpRatio > 0.25 ? "#bbbb44" : "#bb4444";
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, y - 6, barW * hpRatio, barH);

    // Stats text
    ctx.fillStyle = "#aaa";
    ctx.font = "9px monospace";
    ctx.fillText(
      `${char.stats.hp}/${char.stats.maxHp}`,
      panelX + 134,
      y,
    );
  }

  // Turn hint
  ctx.fillStyle = "#888";
  ctx.font = "9px monospace";
  ctx.fillText("Space = end turn", panelX + 6, panelY + panelH - 6);
}
