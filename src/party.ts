/** Party system: 4-character party with individual turn-based movement. */

import { TileMap, TILE_SIZE } from "./tilemap";
import { getReachableTiles, findPath, GridPos } from "./pathfinding";
import { Equipment, createEquipment, getEffectiveMaxHp } from "./loot";

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
  equipment: Equipment;
}

// ── Per-member exploration state ──────────────────────────────────────────

export interface MemberExploreState {
  col: number;
  row: number;
  px: number;
  py: number;
  movePointsLeft: number;
  turnComplete: boolean;
  currentPath: GridPos[];
  pathIndex: number;
  reachableTiles: Map<string, number> | null;
}

// ── Party state ────────────────────────────────────────────────────────────

export type TurnPhase = "select" | "move" | "animating" | "done";

export interface PartyState {
  members: Character[];
  memberStates: MemberExploreState[];
  activeCharIdx: number;
  turnPhase: TurnPhase;
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
      equipment: createEquipment(),
    },
    {
      name: "Mage",
      stats: { hp: 18, maxHp: 18, atk: 12, def: 2, moveRange: 4 },
      color: "#9944cc",
      accent: "#c477ff",
      icon: "M",
      equipment: createEquipment(),
    },
    {
      name: "Rogue",
      stats: { hp: 22, maxHp: 22, atk: 10, def: 3, moveRange: 7 },
      color: "#44aa44",
      accent: "#77dd77",
      icon: "R",
      equipment: createEquipment(),
    },
    {
      name: "Cleric",
      stats: { hp: 24, maxHp: 24, atk: 5, def: 5, moveRange: 4 },
      color: "#ccaa44",
      accent: "#ffdd77",
      icon: "C",
      equipment: createEquipment(),
    },
  ];
}

/** Offsets for 2x2 formation around a center tile. */
const FORMATION_OFFSETS = [
  { dc: 0, dr: 0 },   // top-left
  { dc: 1, dr: 0 },   // top-right
  { dc: 0, dr: 1 },   // bottom-left
  { dc: 1, dr: 1 },   // bottom-right
];

function createMemberState(col: number, row: number, moveRange: number): MemberExploreState {
  return {
    col,
    row,
    px: col * TILE_SIZE + TILE_SIZE / 2,
    py: row * TILE_SIZE + TILE_SIZE / 2,
    movePointsLeft: moveRange,
    turnComplete: false,
    currentPath: [],
    pathIndex: 0,
    reachableTiles: null,
  };
}

export function createPartyState(col: number, row: number): PartyState {
  const members = createDefaultParty();
  const memberStates = members.map((m, i) => {
    const ofs = FORMATION_OFFSETS[i];
    return createMemberState(col + ofs.dc, row + ofs.dr, m.stats.moveRange);
  });

  return {
    members,
    memberStates,
    activeCharIdx: 0,
    turnPhase: "select",
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Get the active member's explore state. */
export function getActive(party: PartyState): MemberExploreState {
  return party.memberStates[party.activeCharIdx];
}

/** Get the "party center" position (average of alive members) for camera etc. */
export function getPartyCenter(party: PartyState): { px: number; py: number; col: number; row: number } {
  const alive = party.memberStates.filter((_, i) => party.members[i].stats.hp > 0);
  if (alive.length === 0) return { px: 0, py: 0, col: 0, row: 0 };
  const px = alive.reduce((s, m) => s + m.px, 0) / alive.length;
  const py = alive.reduce((s, m) => s + m.py, 0) / alive.length;
  const col = Math.round(alive[0].col);
  const row = Math.round(alive[0].row);
  return { px, py, col, row };
}

/** Find a member at the given grid position. Returns index or -1. */
export function getMemberAt(party: PartyState, col: number, row: number): number {
  for (let i = 0; i < party.memberStates.length; i++) {
    if (party.members[i].stats.hp <= 0) continue;
    if (party.memberStates[i].col === col && party.memberStates[i].row === row) {
      return i;
    }
  }
  return -1;
}

/** Check if a tile is occupied by any party member. */
export function isTileOccupied(party: PartyState, col: number, row: number, excludeIdx?: number): boolean {
  for (let i = 0; i < party.memberStates.length; i++) {
    if (i === excludeIdx) continue;
    if (party.members[i].stats.hp <= 0) continue;
    if (party.memberStates[i].col === col && party.memberStates[i].row === row) {
      return true;
    }
  }
  return false;
}

// ── Character selection ───────────────────────────────────────────────────

/** Select a specific character by index. Returns true if selection changed. */
export function selectMember(party: PartyState, idx: number): boolean {
  if (idx < 0 || idx >= party.members.length) return false;
  if (party.members[idx].stats.hp <= 0) return false;
  if (party.memberStates[idx].turnComplete) return false;
  if (party.turnPhase === "animating") return false;

  party.activeCharIdx = idx;
  party.turnPhase = "move";
  return true;
}

/** Select the next character who hasn't completed their turn. Returns true if found. */
export function selectNextMember(party: PartyState): boolean {
  const start = party.activeCharIdx;
  for (let offset = 1; offset <= party.members.length; offset++) {
    const idx = (start + offset) % party.members.length;
    if (party.members[idx].stats.hp > 0 && !party.memberStates[idx].turnComplete) {
      party.activeCharIdx = idx;
      party.turnPhase = "move";
      return true;
    }
  }
  return false; // all done
}

/** Mark active character's turn as complete and auto-advance. Returns true if more characters remain. */
export function completeMemberTurn(party: PartyState): boolean {
  const ms = getActive(party);
  ms.turnComplete = true;
  ms.reachableTiles = null;

  // Try to auto-advance to next character
  if (selectNextMember(party)) {
    return true;
  }

  // All characters done — auto end turn
  endTurn(party);
  return false;
}

/** Check if all alive members have completed their turns. */
export function allMembersDone(party: PartyState): boolean {
  for (let i = 0; i < party.members.length; i++) {
    if (party.members[i].stats.hp > 0 && !party.memberStates[i].turnComplete) {
      return false;
    }
  }
  return true;
}

// ── Movement logic ─────────────────────────────────────────────────────────

const MOVE_ANIM_SPEED = 200; // pixels per second for path animation

/** Cache reachable tiles for the active member. */
export function cacheReachable(party: PartyState, map: TileMap): void {
  const ms = getActive(party);
  ms.reachableTiles = getReachableTiles(
    map,
    { col: ms.col, row: ms.row },
    ms.movePointsLeft,
  );
}

/** Start moving the active member along a path to the target tile. */
export function startMove(
  party: PartyState,
  targetCol: number,
  targetRow: number,
  map: TileMap,
): boolean {
  if (party.turnPhase !== "move") return false;
  const ms = getActive(party);

  // Don't allow moving onto a tile occupied by another party member
  if (isTileOccupied(party, targetCol, targetRow, party.activeCharIdx)) return false;

  const path = findPath(
    map,
    { col: ms.col, row: ms.row },
    { col: targetCol, row: targetRow },
    ms.movePointsLeft,
  );

  if (!path || path.length === 0) return false;

  ms.currentPath = path;
  ms.pathIndex = 0;
  party.turnPhase = "animating";
  return true;
}

/** Update movement animation for the active member. */
export function updateMovement(party: PartyState, dt: number): void {
  if (party.turnPhase !== "animating") return;
  const ms = getActive(party);

  if (ms.pathIndex >= ms.currentPath.length) {
    party.turnPhase = "move";
    ms.currentPath = [];
    ms.pathIndex = 0;
    return;
  }

  const target = ms.currentPath[ms.pathIndex];
  const targetPx = target.col * TILE_SIZE + TILE_SIZE / 2;
  const targetPy = target.row * TILE_SIZE + TILE_SIZE / 2;

  const ddx = targetPx - ms.px;
  const ddy = targetPy - ms.py;
  const dist = Math.sqrt(ddx * ddx + ddy * ddy);

  if (dist < 2) {
    ms.px = targetPx;
    ms.py = targetPy;
    ms.col = target.col;
    ms.row = target.row;
    ms.movePointsLeft--;
    ms.pathIndex++;

    if (ms.pathIndex >= ms.currentPath.length) {
      party.turnPhase = "move";
      ms.currentPath = [];
      ms.pathIndex = 0;
      ms.reachableTiles = null;
    }
  } else {
    const step = MOVE_ANIM_SPEED * dt;
    ms.px += (ddx / dist) * Math.min(step, dist);
    ms.py += (ddy / dist) * Math.min(step, dist);
  }
}

/** End the current turn and start a new one — reset all members. */
export function endTurn(party: PartyState): void {
  for (let i = 0; i < party.members.length; i++) {
    const ms = party.memberStates[i];
    ms.movePointsLeft = party.members[i].stats.moveRange;
    ms.turnComplete = false;
    ms.reachableTiles = null;
  }
  // Select first alive member
  party.activeCharIdx = 0;
  for (let i = 0; i < party.members.length; i++) {
    if (party.members[i].stats.hp > 0) {
      party.activeCharIdx = i;
      break;
    }
  }
  party.turnPhase = "select";
}

/** Reset member positions for floor transitions (spread around spawn). */
export function resetMemberPositions(party: PartyState, spawnCol: number, spawnRow: number): void {
  for (let i = 0; i < party.memberStates.length; i++) {
    const ofs = FORMATION_OFFSETS[i];
    const col = spawnCol + ofs.dc;
    const row = spawnRow + ofs.dr;
    const ms = party.memberStates[i];
    ms.col = col;
    ms.row = row;
    ms.px = col * TILE_SIZE + TILE_SIZE / 2;
    ms.py = row * TILE_SIZE + TILE_SIZE / 2;
    ms.movePointsLeft = party.members[i].stats.moveRange;
    ms.turnComplete = false;
    ms.currentPath = [];
    ms.pathIndex = 0;
    ms.reachableTiles = null;
  }
  party.activeCharIdx = 0;
  party.turnPhase = "select";
}

// ── Rendering ──────────────────────────────────────────────────────────────

const REACHABLE_COLOR = "rgba(100, 200, 255, 0.15)";
const REACHABLE_BORDER = "rgba(100, 200, 255, 0.3)";
const PATH_COLOR = "rgba(255, 220, 100, 0.3)";

/** Render movement range highlight for the active character. */
export function renderReachable(
  ctx: CanvasRenderingContext2D,
  party: PartyState,
  map: TileMap,
): void {
  if (party.turnPhase !== "move") return;
  const ms = getActive(party);

  if (!ms.reachableTiles) {
    cacheReachable(party, map);
  }

  const tiles = ms.reachableTiles!;
  for (const [key] of tiles) {
    const [c, r] = key.split(",").map(Number);
    if (c === ms.col && r === ms.row) continue;
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
  const ms = getActive(party);
  if (!ms.reachableTiles) return;

  const key = `${hoverCol},${hoverRow}`;
  if (!ms.reachableTiles.has(key)) return;
  if (hoverCol === ms.col && hoverRow === ms.row) return;

  const path = findPath(
    map,
    { col: ms.col, row: ms.row },
    { col: hoverCol, row: hoverRow },
    ms.movePointsLeft,
  );

  if (!path) return;

  for (const step of path) {
    const px = step.col * TILE_SIZE;
    const py = step.row * TILE_SIZE;
    ctx.fillStyle = PATH_COLOR;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  }
}

/** Render all party members on the grid at their individual positions. */
export function renderParty(
  ctx: CanvasRenderingContext2D,
  party: PartyState,
): void {
  const spriteSize = 14;
  const half = spriteSize / 2;

  for (let i = 0; i < party.members.length; i++) {
    const char = party.members[i];
    if (char.stats.hp <= 0) continue;

    const ms = party.memberStates[i];
    const ox = ms.px;
    const oy = ms.py;

    const isActive = i === party.activeCharIdx && party.turnPhase !== "done";
    const isDone = ms.turnComplete;

    // Active character pulsing highlight
    if (isActive && (party.turnPhase === "move" || party.turnPhase === "select")) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox - half - 3, oy - half - 3, spriteSize + 6, spriteSize + 6);
    }

    // Body (dimmed if turn complete)
    ctx.fillStyle = isDone ? darken(char.color, 0.5) : char.color;
    ctx.fillRect(ox - half, oy - half, spriteSize, spriteSize);

    // Outline
    ctx.strokeStyle = isDone ? darken(char.accent, 0.5) : char.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox - half, oy - half, spriteSize, spriteSize);

    // Icon letter
    ctx.fillStyle = isDone ? "#888" : "#fff";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char.icon, ox, oy + 1);

    // Turn complete checkmark
    if (isDone) {
      ctx.fillStyle = "#44ff44";
      ctx.font = "bold 8px monospace";
      ctx.fillText("\u2713", ox + half + 2, oy - half + 2);
    }
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Darken a hex color by a factor (0 = same, 1 = black). */
function darken(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 1 - factor;
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}

/** Render party stats HUD panel with per-character turn status. */
export function renderPartyHUD(
  ctx: CanvasRenderingContext2D,
  party: PartyState,
  canvasW: number,
): void {
  const panelW = 200;
  const panelH = 140;
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
  ctx.fillText("Party — Individual Turns", panelX + 6, panelY + 14);

  // Members
  for (let i = 0; i < party.members.length; i++) {
    const char = party.members[i];
    const ms = party.memberStates[i];
    const y = panelY + 30 + i * 24;
    const isActive = i === party.activeCharIdx;

    // Active indicator
    if (isActive && !ms.turnComplete) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.fillRect(panelX + 2, y - 10, panelW - 4, 20);
      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 10px monospace";
      ctx.fillText("\u25B6", panelX + 6, y + 1);
    }

    // Color swatch
    ctx.fillStyle = ms.turnComplete ? darken(char.color, 0.5) : char.color;
    ctx.fillRect(panelX + 18, y - 6, 8, 8);

    // Name
    ctx.fillStyle = ms.turnComplete ? "#777" : "#ddd";
    ctx.font = "10px monospace";
    ctx.fillText(char.name, panelX + 30, y);

    // HP bar background
    const barX = panelX + 80;
    const barW = 50;
    const barH = 6;
    ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
    ctx.fillRect(barX, y - 6, barW, barH);

    // HP bar fill
    const effectiveMax = getEffectiveMaxHp(char);
    const hpRatio = char.stats.hp / effectiveMax;
    const hpColor = hpRatio > 0.5 ? "#44bb44" : hpRatio > 0.25 ? "#bbbb44" : "#bb4444";
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, y - 6, barW * hpRatio, barH);

    // Move points / status
    ctx.fillStyle = ms.turnComplete ? "#555" : "#88ccff";
    ctx.font = "9px monospace";
    const status = ms.turnComplete ? "done" : `mv:${ms.movePointsLeft}/${char.stats.moveRange}`;
    ctx.fillText(status, panelX + 134, y);
  }

  // Turn hint
  ctx.fillStyle = "#888";
  ctx.font = "9px monospace";
  ctx.fillText("Tab=next  Space=end turn", panelX + 6, panelY + panelH - 6);
}
