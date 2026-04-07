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

export interface MemberState {
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
  memberStates: MemberState[];
  activeCharIdx: number; // which character is currently acting (-1 = none)
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

export function createPartyState(col: number, row: number): PartyState {
  const members = createDefaultParty();
  const memberStates: MemberState[] = members.map(() => ({
    col,
    row,
    px: col * TILE_SIZE + TILE_SIZE / 2,
    py: row * TILE_SIZE + TILE_SIZE / 2,
    movePointsLeft: 0, // set by first turn reset
    turnComplete: false,
    currentPath: [],
    pathIndex: 0,
    reachableTiles: null,
  }));

  // Give each member their move points for the first turn
  for (let i = 0; i < members.length; i++) {
    memberStates[i].movePointsLeft = members[i].stats.moveRange;
  }

  return {
    members,
    memberStates,
    activeCharIdx: 0, // start with first character selected
    turnPhase: "move",
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Get the active member's state (or null if none). */
export function getActiveMemberState(party: PartyState): MemberState | null {
  if (party.activeCharIdx < 0 || party.activeCharIdx >= party.memberStates.length) return null;
  return party.memberStates[party.activeCharIdx];
}

/** Get the active character (or null). */
export function getActiveCharacter(party: PartyState): Character | null {
  if (party.activeCharIdx < 0) return null;
  return party.members[party.activeCharIdx];
}

/** Get position to use for camera following (active member, or first alive). */
export function getPartyFocusPos(party: PartyState): { px: number; py: number } {
  const active = getActiveMemberState(party);
  if (active) return { px: active.px, py: active.py };
  // Fallback: first alive member
  for (let i = 0; i < party.members.length; i++) {
    if (party.members[i].stats.hp > 0) return { px: party.memberStates[i].px, py: party.memberStates[i].py };
  }
  return { px: party.memberStates[0].px, py: party.memberStates[0].py };
}

/** Check if a member at index i can still act this turn. */
export function canAct(party: PartyState, i: number): boolean {
  return party.members[i].stats.hp > 0 && !party.memberStates[i].turnComplete;
}

/** Select a party member to act with. Returns true if selection succeeded. */
export function selectMember(party: PartyState, idx: number): boolean {
  if (idx < 0 || idx >= party.members.length) return false;
  if (!canAct(party, idx)) return false;
  party.activeCharIdx = idx;
  party.turnPhase = "move";
  party.memberStates[idx].reachableTiles = null; // recache
  return true;
}

/** Try to select the next available (unacted) member. Returns true if found one. */
export function selectNextAvailable(party: PartyState): boolean {
  // Try members after current, then wrap around
  for (let offset = 1; offset <= party.members.length; offset++) {
    const idx = (party.activeCharIdx + offset) % party.members.length;
    if (canAct(party, idx)) {
      return selectMember(party, idx);
    }
  }
  // No one left to act
  party.turnPhase = "done";
  party.activeCharIdx = -1;
  return false;
}

/** Find member at a given grid position. Returns index or -1. */
export function getMemberAtTile(party: PartyState, col: number, row: number): number {
  for (let i = 0; i < party.memberStates.length; i++) {
    if (party.members[i].stats.hp <= 0) continue;
    if (party.memberStates[i].col === col && party.memberStates[i].row === row) {
      return i;
    }
  }
  return -1;
}

// ── Movement logic ─────────────────────────────────────────────────────────

const MOVE_ANIM_SPEED = 200; // pixels per second for path animation

/** Cache reachable tiles for the active member. */
export function cacheReachable(party: PartyState, map: TileMap): void {
  const ms = getActiveMemberState(party);
  if (!ms) return;
  ms.reachableTiles = getReachableTiles(
    map,
    { col: ms.col, row: ms.row },
    ms.movePointsLeft,
  );
}

/** Start moving the active member along a path. Returns false if unreachable. */
export function startMove(
  party: PartyState,
  targetCol: number,
  targetRow: number,
  map: TileMap,
): boolean {
  if (party.turnPhase !== "move") return false;
  const ms = getActiveMemberState(party);
  if (!ms) return false;

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
  const ms = getActiveMemberState(party);
  if (!ms) return;

  if (ms.pathIndex >= ms.currentPath.length) {
    // Animation complete
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
      ms.reachableTiles = null; // invalidate cache
    }
  } else {
    const step = MOVE_ANIM_SPEED * dt;
    ms.px += (ddx / dist) * Math.min(step, dist);
    ms.py += (ddy / dist) * Math.min(step, dist);
  }
}

/** Mark the active member's turn as complete and advance to next. */
export function endMemberTurn(party: PartyState): void {
  const ms = getActiveMemberState(party);
  if (ms) {
    ms.turnComplete = true;
    ms.reachableTiles = null;
  }
  selectNextAvailable(party);
}

/** End the full party turn: reset all members for a new round. */
export function endTurn(party: PartyState): void {
  for (let i = 0; i < party.members.length; i++) {
    const ms = party.memberStates[i];
    ms.movePointsLeft = party.members[i].stats.moveRange;
    ms.turnComplete = false;
    ms.reachableTiles = null;
  }
  // Select first alive member
  party.activeCharIdx = -1;
  for (let i = 0; i < party.members.length; i++) {
    if (party.members[i].stats.hp > 0) {
      party.activeCharIdx = i;
      break;
    }
  }
  party.turnPhase = "move";
}

// ── Rendering ──────────────────────────────────────────────────────────────

const REACHABLE_COLOR = "rgba(100, 200, 255, 0.15)";
const REACHABLE_BORDER = "rgba(100, 200, 255, 0.3)";
const PATH_COLOR = "rgba(255, 220, 100, 0.3)";

/** Render movement range highlight for the active member. */
export function renderReachable(
  ctx: CanvasRenderingContext2D,
  party: PartyState,
  map: TileMap,
): void {
  if (party.turnPhase !== "move") return;
  const ms = getActiveMemberState(party);
  if (!ms) return;

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
  const ms = getActiveMemberState(party);
  if (!ms || !ms.reachableTiles) return;

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

/** Render all party members on the grid, highlighting the active one. */
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
    const isActive = i === party.activeCharIdx;
    const isDone = ms.turnComplete;

    // Active character pulsing highlight
    if (isActive && party.turnPhase !== "animating") {
      const pulse = 0.4 + Math.sin(Date.now() / 200) * 0.2;
      ctx.fillStyle = `rgba(255, 255, 100, ${pulse})`;
      ctx.fillRect(
        ox - half - 3, oy - half - 3,
        spriteSize + 6, spriteSize + 6,
      );
    }

    // Body (dimmed if turn complete)
    ctx.fillStyle = isDone ? darken(char.color) : char.color;
    ctx.fillRect(ox - half, oy - half, spriteSize, spriteSize);

    // Outline
    ctx.strokeStyle = isActive ? "#fff" : (isDone ? darken(char.accent) : char.accent);
    ctx.lineWidth = isActive ? 2.5 : 1.5;
    ctx.strokeRect(ox - half, oy - half, spriteSize, spriteSize);

    // Icon letter
    ctx.fillStyle = isDone ? "#999" : "#fff";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char.icon, ox, oy + 1);

    // Small HP bar below sprite
    const barW = spriteSize;
    const barH = 3;
    const barX = ox - half;
    const barY = oy + half + 2;
    const effectiveMax = getEffectiveMaxHp(char);
    const hpRatio = char.stats.hp / effectiveMax;
    ctx.fillStyle = "rgba(255, 0, 0, 0.4)";
    ctx.fillRect(barX, barY, barW, barH);
    const hpColor = hpRatio > 0.5 ? "#44bb44" : hpRatio > 0.25 ? "#bbbb44" : "#bb4444";
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * hpRatio, barH);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Darken a hex color for "done" state. */
function darken(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.floor(r * 0.5)}, ${Math.floor(g * 0.5)}, ${Math.floor(b * 0.5)})`;
}

/** Render party stats HUD panel with turn order info. */
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
  ctx.fillText("Party Turns", panelX + 6, panelY + 14);

  // Members with turn state
  for (let i = 0; i < party.members.length; i++) {
    const char = party.members[i];
    const ms = party.memberStates[i];
    const y = panelY + 30 + i * 24;
    const isActive = i === party.activeCharIdx;
    const isDead = char.stats.hp <= 0;
    const isDone = ms.turnComplete;

    // Active indicator
    if (isActive) {
      ctx.fillStyle = "rgba(255, 255, 100, 0.15)";
      ctx.fillRect(panelX + 2, y - 10, panelW - 4, 20);
      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 10px monospace";
      ctx.fillText("\u25B6", panelX + 6, y + 1);
    }

    // Color swatch
    ctx.fillStyle = isDead ? "#444" : (isDone ? darken(char.color) : char.color);
    ctx.fillRect(panelX + 18, y - 6, 8, 8);

    // Name + key hint
    ctx.fillStyle = isDead ? "#666" : (isActive ? "#fff" : (isDone ? "#777" : "#ddd"));
    ctx.font = isActive ? "bold 10px monospace" : "10px monospace";
    ctx.fillText(`${i + 1}:${char.name}`, panelX + 30, y);

    // Status label
    const status = isDead ? "DEAD" : (isDone ? "DONE" : `${ms.movePointsLeft} mv`);
    ctx.fillStyle = isDead ? "#aa3333" : (isDone ? "#558855" : "#88ccff");
    ctx.font = "9px monospace";
    ctx.fillText(status, panelX + 110, y);

    // HP bar
    if (!isDead) {
      const barX = panelX + 148;
      const barW = 44;
      const barH = 6;
      ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
      ctx.fillRect(barX, y - 6, barW, barH);
      const effectiveMax = getEffectiveMaxHp(char);
      const hpRatio = char.stats.hp / effectiveMax;
      const hpColor = hpRatio > 0.5 ? "#44bb44" : hpRatio > 0.25 ? "#bbbb44" : "#bb4444";
      ctx.fillStyle = hpColor;
      ctx.fillRect(barX, y - 6, barW * hpRatio, barH);
    }
  }

  // Turn hints
  ctx.fillStyle = "#888";
  ctx.font = "9px monospace";
  ctx.fillText("1-4=select Tab=next Space=end", panelX + 6, panelY + panelH - 8);
}
