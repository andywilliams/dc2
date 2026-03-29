/** Enemy spawning, AI, and rendering for the dungeon grid. */

import { TileMap, TILE_SIZE } from "./tilemap";
import { DungeonRoom } from "./dungeon";
import { getReachableTiles, findPath, GridPos } from "./pathfinding";

// ── Enemy types ─────────────────────────────────────────────────────────────

export interface EnemyStats {
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  moveRange: number;
  attackRange: number;
  detectionRange: number;
}

export type EnemyType = "skeleton" | "slime" | "bat" | "goblin" | "boss";

export interface Enemy {
  id: number;
  name: string;
  type: EnemyType;
  stats: EnemyStats;
  col: number;
  row: number;
  px: number;
  py: number;
  color: string;
  accent: string;
  icon: string;
  alive: boolean;
  /** Animation path for movement. */
  movePath: GridPos[];
  moveIndex: number;
  hasActed: boolean; // has this enemy moved/attacked this turn?
  aggro: boolean; // has this enemy detected the party?
}

// ── Enemy templates ─────────────────────────────────────────────────────────

interface EnemyTemplate {
  name: string;
  type: EnemyType;
  stats: EnemyStats;
  color: string;
  accent: string;
  icon: string;
}

const BOSS_TEMPLATE: EnemyTemplate = {
  name: "Dark Lord",
  type: "boss",
  stats: { hp: 80, maxHp: 80, atk: 14, def: 8, moveRange: 4, attackRange: 2, detectionRange: 10 },
  color: "#880022",
  accent: "#ff2244",
  icon: "B",
};

const ENEMY_TEMPLATES: EnemyTemplate[] = [
  {
    name: "Skeleton",
    type: "skeleton",
    stats: { hp: 14, maxHp: 14, atk: 6, def: 3, moveRange: 3, attackRange: 1, detectionRange: 5 },
    color: "#aaaaaa",
    accent: "#dddddd",
    icon: "S",
  },
  {
    name: "Slime",
    type: "slime",
    stats: { hp: 24, maxHp: 24, atk: 4, def: 5, moveRange: 2, attackRange: 1, detectionRange: 4 },
    color: "#44aa66",
    accent: "#66dd88",
    icon: "O",
  },
  {
    name: "Bat",
    type: "bat",
    stats: { hp: 8, maxHp: 8, atk: 5, def: 1, moveRange: 6, attackRange: 1, detectionRange: 7 },
    color: "#664488",
    accent: "#8866aa",
    icon: "b",
  },
  {
    name: "Goblin",
    type: "goblin",
    stats: { hp: 10, maxHp: 10, atk: 7, def: 2, moveRange: 3, attackRange: 3, detectionRange: 6 },
    color: "#668833",
    accent: "#99bb55",
    icon: "G",
  },
];

let nextEnemyId = 1;

function createEnemy(template: EnemyTemplate, col: number, row: number): Enemy {
  return {
    id: nextEnemyId++,
    name: template.name,
    type: template.type,
    stats: { ...template.stats },
    col,
    row,
    px: col * TILE_SIZE + TILE_SIZE / 2,
    py: row * TILE_SIZE + TILE_SIZE / 2,
    color: template.color,
    accent: template.accent,
    icon: template.icon,
    alive: true,
    movePath: [],
    moveIndex: 0,
    hasActed: false,
    aggro: false,
  };
}

/** Apply floor-based stat scaling. Stats increase ~15% per floor. */
function scaleEnemyForFloor(enemy: Enemy, floor: number): void {
  if (floor <= 1) return;
  const mult = 1 + (floor - 1) * 0.15;
  enemy.stats.maxHp = Math.round(enemy.stats.maxHp * mult);
  enemy.stats.hp = enemy.stats.maxHp;
  enemy.stats.atk = Math.round(enemy.stats.atk * mult);
  enemy.stats.def = Math.round(enemy.stats.def * mult);
}

// ── Spawning ────────────────────────────────────────────────────────────────

/** Spawn enemies in rooms (skip the first room where the party spawns). */
export function spawnEnemies(
  rooms: DungeonRoom[],
  map: TileMap,
  occupiedCols: number[],
  occupiedRows: number[],
  floor: number = 1,
): Enemy[] {
  const enemies: Enemy[] = [];
  const occupied = new Set<string>();

  // Mark party area as occupied
  for (let i = 0; i < occupiedCols.length; i++) {
    occupied.add(`${occupiedCols[i]},${occupiedRows[i]}`);
  }

  // Enemy count per room scales with floor: 1-2 on floor 1, up to 2-4 on higher floors
  const baseMin = 1;
  const baseMax = 2;
  const extraPerFloor = Math.floor((floor - 1) / 2); // +1 max every 2 floors

  // Skip the first room (spawn room)
  for (let ri = 1; ri < rooms.length; ri++) {
    const room = rooms[ri];
    const minCount = baseMin + Math.min(extraPerFloor, 1);
    const maxCount = baseMax + extraPerFloor;
    const count = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));

    for (let i = 0; i < count; i++) {
      // Try to find an unoccupied floor tile in this room
      for (let attempt = 0; attempt < 20; attempt++) {
        const col = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const row = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
        const key = `${col},${row}`;

        if (!map.isSolid(col, row) && !occupied.has(key)) {
          occupied.add(key);
          const template = ENEMY_TEMPLATES[Math.floor(Math.random() * ENEMY_TEMPLATES.length)];
          const enemy = createEnemy(template, col, row);
          scaleEnemyForFloor(enemy, floor);
          enemies.push(enemy);
          break;
        }
      }
    }
  }

  return enemies;
}

// ── Enemy AI (simple: move toward party, attack if in range) ────────────────

export function getEnemiesInRange(
  enemies: Enemy[],
  col: number,
  row: number,
  range: number,
): Enemy[] {
  return enemies.filter((e) => {
    if (!e.alive) return false;
    const dist = Math.abs(e.col - col) + Math.abs(e.row - row);
    return dist <= range;
  });
}

/** Check if party is adjacent (within attack range) to an enemy. */
export function isInAttackRange(
  enemy: Enemy,
  targetCol: number,
  targetRow: number,
): boolean {
  const dist = Math.abs(enemy.col - targetCol) + Math.abs(enemy.row - targetRow);
  return dist <= enemy.stats.attackRange;
}

/** Update aggro state based on detection range. */
export function updateAggro(
  enemies: Enemy[],
  partyCol: number,
  partyRow: number,
): void {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (enemy.aggro) continue; // once aggro'd, stays aggro
    const dist = Math.abs(enemy.col - partyCol) + Math.abs(enemy.row - partyRow);
    if (dist <= enemy.stats.detectionRange) {
      enemy.aggro = true;
    }
  }
}

/** Plan enemy AI move: type-specific behavior. */
export function planEnemyAction(
  enemy: Enemy,
  partyCol: number,
  partyRow: number,
  map: TileMap,
  allEnemies: Enemy[],
): { moveTo: GridPos | null; canAttack: boolean } {
  // Non-aggro enemies idle
  if (!enemy.aggro) {
    return { moveTo: null, canAttack: false };
  }

  // Dispatch to type-specific AI
  switch (enemy.type) {
    case "slime":
      return planSlimeAction(enemy, partyCol, partyRow, map, allEnemies);
    case "bat":
      return planBatAction(enemy, partyCol, partyRow, map, allEnemies);
    case "goblin":
      return planGoblinAction(enemy, partyCol, partyRow, map, allEnemies);
    case "boss":
      return planDefaultAction(enemy, partyCol, partyRow, map, allEnemies);
    case "skeleton":
    default:
      return planDefaultAction(enemy, partyCol, partyRow, map, allEnemies);
  }
}

/** Default AI (Skeleton): move toward closest target, attack if in range. */
function planDefaultAction(
  enemy: Enemy,
  partyCol: number,
  partyRow: number,
  map: TileMap,
  allEnemies: Enemy[],
): { moveTo: GridPos | null; canAttack: boolean } {
  // Already in attack range? Don't move, just attack
  if (isInAttackRange(enemy, partyCol, partyRow)) {
    return { moveTo: null, canAttack: true };
  }

  return findBestApproachTile(enemy, partyCol, partyRow, map, allEnemies);
}

/** Slime AI: slow but persistent. Moves toward target, ignores optimal pathing—
 *  always moves even if it can't reach attack range this turn. */
function planSlimeAction(
  enemy: Enemy,
  partyCol: number,
  partyRow: number,
  map: TileMap,
  allEnemies: Enemy[],
): { moveTo: GridPos | null; canAttack: boolean } {
  if (isInAttackRange(enemy, partyCol, partyRow)) {
    return { moveTo: null, canAttack: true };
  }

  return findBestApproachTile(enemy, partyCol, partyRow, map, allEnemies);
}

/** Bat AI: fast, prefers to attack and then reposition away.
 *  If already adjacent, attacks without moving. Otherwise rushes in. */
function planBatAction(
  enemy: Enemy,
  partyCol: number,
  partyRow: number,
  map: TileMap,
  allEnemies: Enemy[],
): { moveTo: GridPos | null; canAttack: boolean } {
  if (isInAttackRange(enemy, partyCol, partyRow)) {
    return { moveTo: null, canAttack: true };
  }

  // Bats have high move range — rush toward target aggressively
  return findBestApproachTile(enemy, partyCol, partyRow, map, allEnemies);
}

/** Goblin AI: ranged attacker. Tries to stay at max attack range.
 *  Prefers tiles at range 2-3 from target rather than adjacent. */
function planGoblinAction(
  enemy: Enemy,
  partyCol: number,
  partyRow: number,
  map: TileMap,
  allEnemies: Enemy[],
): { moveTo: GridPos | null; canAttack: boolean } {
  // If already in attack range, don't move—just attack
  if (isInAttackRange(enemy, partyCol, partyRow)) {
    return { moveTo: null, canAttack: true };
  }

  // Find reachable tiles
  const reachable = getReachableTiles(map, { col: enemy.col, row: enemy.row }, enemy.stats.moveRange);
  const enemyPositions = getOccupiedPositions(enemy, allEnemies);

  // Prefer tiles at attack range (2-3 distance) rather than adjacent
  let bestTile: GridPos | null = null;
  let bestScore = -Infinity;
  let bestCanAttack = false;

  for (const [key] of reachable) {
    const [c, r] = key.split(",").map(Number);
    if (enemyPositions.has(key)) continue;
    if (c === enemy.col && r === enemy.row) continue;

    const dist = Math.abs(c - partyCol) + Math.abs(r - partyRow);
    const canAttackFromHere = dist <= enemy.stats.attackRange;

    // Score: prioritize being in attack range, then prefer being far (ranged kiting)
    let score = canAttackFromHere ? 1000 : -dist;
    if (canAttackFromHere) {
      // Prefer staying at max range (dist=3 over dist=1)
      score += dist * 10;
    }

    if (score > bestScore) {
      bestTile = { col: c, row: r };
      bestScore = score;
      bestCanAttack = canAttackFromHere;
    }
  }

  return { moveTo: bestTile, canAttack: bestCanAttack };
}

/** Shared helper: find best tile to approach the target. */
function findBestApproachTile(
  enemy: Enemy,
  partyCol: number,
  partyRow: number,
  map: TileMap,
  allEnemies: Enemy[],
): { moveTo: GridPos | null; canAttack: boolean } {
  const reachable = getReachableTiles(map, { col: enemy.col, row: enemy.row }, enemy.stats.moveRange);
  const enemyPositions = getOccupiedPositions(enemy, allEnemies);

  let bestTile: GridPos | null = null;
  let bestDist = Infinity;
  let bestCanAttack = false;

  for (const [key] of reachable) {
    const [c, r] = key.split(",").map(Number);
    if (enemyPositions.has(key)) continue;
    if (c === enemy.col && r === enemy.row) continue;

    const dist = Math.abs(c - partyCol) + Math.abs(r - partyRow);
    const canAttackFromHere = dist <= enemy.stats.attackRange;

    if (canAttackFromHere && !bestCanAttack) {
      bestTile = { col: c, row: r };
      bestDist = dist;
      bestCanAttack = true;
    } else if (canAttackFromHere === bestCanAttack && dist < bestDist) {
      bestTile = { col: c, row: r };
      bestDist = dist;
      bestCanAttack = canAttackFromHere;
    }
  }

  return { moveTo: bestTile, canAttack: bestCanAttack };
}

/** Get positions occupied by other living enemies. */
function getOccupiedPositions(self: Enemy, allEnemies: Enemy[]): Set<string> {
  const positions = new Set<string>();
  for (const e of allEnemies) {
    if (e.alive && e.id !== self.id) {
      positions.add(`${e.col},${e.row}`);
    }
  }
  return positions;
}

/** Start enemy movement animation toward a target tile. */
export function startEnemyMove(
  enemy: Enemy,
  target: GridPos,
  map: TileMap,
): boolean {
  const path = findPath(
    map,
    { col: enemy.col, row: enemy.row },
    target,
    enemy.stats.moveRange,
  );
  if (!path || path.length === 0) return false;
  enemy.movePath = path;
  enemy.moveIndex = 0;
  return true;
}

/** Get move speed for enemy type. Bats are fast, slimes are slow. */
function getEnemyMoveSpeed(enemy: Enemy): number {
  switch (enemy.type) {
    case "bat": return 220;
    case "slime": return 100;
    default: return 160;
  }
}

/** Update enemy movement animation. Returns true if still animating. */
export function updateEnemyMovement(enemy: Enemy, dt: number): boolean {
  if (enemy.moveIndex >= enemy.movePath.length) {
    enemy.movePath = [];
    enemy.moveIndex = 0;
    return false;
  }

  const speed = getEnemyMoveSpeed(enemy);
  const target = enemy.movePath[enemy.moveIndex];
  const targetPx = target.col * TILE_SIZE + TILE_SIZE / 2;
  const targetPy = target.row * TILE_SIZE + TILE_SIZE / 2;

  const ddx = targetPx - enemy.px;
  const ddy = targetPy - enemy.py;
  const dist = Math.sqrt(ddx * ddx + ddy * ddy);

  if (dist < 2) {
    enemy.px = targetPx;
    enemy.py = targetPy;
    enemy.col = target.col;
    enemy.row = target.row;
    enemy.moveIndex++;

    if (enemy.moveIndex >= enemy.movePath.length) {
      enemy.movePath = [];
      enemy.moveIndex = 0;
      return false;
    }
  } else {
    const step = speed * dt;
    enemy.px += (ddx / dist) * Math.min(step, dist);
    enemy.py += (ddy / dist) * Math.min(step, dist);
  }
  return true;
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** Render all living enemies on the grid with type-specific visuals. */
export function renderEnemies(
  ctx: CanvasRenderingContext2D,
  enemies: Enemy[],
): void {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;

    switch (enemy.type) {
      case "slime":
        renderSlime(ctx, enemy);
        break;
      case "bat":
        renderBat(ctx, enemy);
        break;
      case "goblin":
        renderGoblin(ctx, enemy);
        break;
      case "boss":
        renderBoss(ctx, enemy);
        break;
      case "skeleton":
      default:
        renderSkeleton(ctx, enemy);
        break;
    }

    // HP bar above sprite (shared)
    const spriteSize = 14;
    const half = spriteSize / 2;
    const barW = spriteSize + 4;
    const barH = 3;
    const barX = enemy.px - barW / 2;
    const barY = enemy.py - half - 6;
    const hpRatio = enemy.stats.hp / enemy.stats.maxHp;

    ctx.fillStyle = "rgba(100, 0, 0, 0.6)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpRatio > 0.5 ? "#cc4444" : hpRatio > 0.25 ? "#cc8844" : "#cc2222";
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // Aggro indicator (small red dot when aware of party)
    if (enemy.aggro) {
      ctx.fillStyle = "#ff3333";
      ctx.beginPath();
      ctx.arc(enemy.px + half + 1, enemy.py - half - 1, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Skeleton: standard square with bone-white color and skull icon. */
function renderSkeleton(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  const spriteSize = 14;
  const half = spriteSize / 2;

  // Body
  ctx.fillStyle = enemy.color;
  ctx.fillRect(enemy.px - half, enemy.py - half, spriteSize, spriteSize);

  // Outline
  ctx.strokeStyle = enemy.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(enemy.px - half, enemy.py - half, spriteSize, spriteSize);

  // Icon
  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(enemy.icon, enemy.px, enemy.py + 1);
}

/** Slime: rounded blob shape with a jelly-like appearance. */
function renderSlime(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  const size = 14;
  const half = size / 2;

  // Rounded blob body
  ctx.fillStyle = enemy.color;
  ctx.beginPath();
  ctx.ellipse(enemy.px, enemy.py + 1, half, half - 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shiny highlight
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.beginPath();
  ctx.ellipse(enemy.px - 2, enemy.py - 2, 3, 2, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Outline
  ctx.strokeStyle = enemy.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(enemy.px, enemy.py + 1, half, half - 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Icon
  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(enemy.icon, enemy.px, enemy.py + 1);
}

/** Bat: small diamond/wing shape. */
function renderBat(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  const size = 14;
  const half = size / 2;

  // Wing-like diamond shape
  ctx.fillStyle = enemy.color;
  ctx.beginPath();
  ctx.moveTo(enemy.px, enemy.py - half);             // top
  ctx.lineTo(enemy.px + half + 2, enemy.py);          // right wing tip
  ctx.lineTo(enemy.px, enemy.py + half - 2);          // bottom
  ctx.lineTo(enemy.px - half - 2, enemy.py);          // left wing tip
  ctx.closePath();
  ctx.fill();

  // Outline
  ctx.strokeStyle = enemy.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Icon
  ctx.fillStyle = "#fff";
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(enemy.icon, enemy.px, enemy.py + 1);
}

/** Goblin: triangular/hooded shape suggesting a ranged fighter. */
function renderGoblin(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  const spriteSize = 14;
  const half = spriteSize / 2;

  // Body (slightly different shape — wider top suggesting a hood/bow)
  ctx.fillStyle = enemy.color;
  ctx.fillRect(enemy.px - half, enemy.py - half, spriteSize, spriteSize);

  // "Bow" line (ranged indicator)
  ctx.strokeStyle = "#aa8844";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(enemy.px + half - 1, enemy.py - half + 2);
  ctx.lineTo(enemy.px + half + 2, enemy.py);
  ctx.lineTo(enemy.px + half - 1, enemy.py + half - 2);
  ctx.stroke();

  // Outline
  ctx.strokeStyle = enemy.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(enemy.px - half, enemy.py - half, spriteSize, spriteSize);

  // Icon
  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(enemy.icon, enemy.px, enemy.py + 1);
}

/** Boss: large dark-red enemy with a crown icon. */
function renderBoss(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  const spriteSize = 20; // larger than normal enemies
  const half = spriteSize / 2;

  // Dark aura
  ctx.fillStyle = "rgba(136, 0, 34, 0.3)";
  ctx.beginPath();
  ctx.arc(enemy.px, enemy.py, half + 4, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = enemy.color;
  ctx.fillRect(enemy.px - half, enemy.py - half, spriteSize, spriteSize);

  // Crown points on top
  ctx.fillStyle = "#ffd700";
  ctx.beginPath();
  ctx.moveTo(enemy.px - half + 2, enemy.py - half);
  ctx.lineTo(enemy.px - half + 4, enemy.py - half - 5);
  ctx.lineTo(enemy.px - half + 6, enemy.py - half);
  ctx.moveTo(enemy.px - 2, enemy.py - half);
  ctx.lineTo(enemy.px, enemy.py - half - 6);
  ctx.lineTo(enemy.px + 2, enemy.py - half);
  ctx.moveTo(enemy.px + half - 6, enemy.py - half);
  ctx.lineTo(enemy.px + half - 4, enemy.py - half - 5);
  ctx.lineTo(enemy.px + half - 2, enemy.py - half);
  ctx.fill();

  // Outline
  ctx.strokeStyle = enemy.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(enemy.px - half, enemy.py - half, spriteSize, spriteSize);

  // Icon
  ctx.fillStyle = "#fff";
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(enemy.icon, enemy.px, enemy.py + 1);
}

/** Spawn a boss enemy in the largest room (excluding spawn room). */
export function spawnBoss(
  rooms: DungeonRoom[],
  _map: TileMap,
  _occupiedCols: number[],
  _occupiedRows: number[],
  floor: number,
): Enemy {
  // Pick the largest non-spawn room for the boss
  let bestRoom = rooms[rooms.length - 1]; // default to last room
  let bestArea = 0;
  for (let i = 1; i < rooms.length; i++) {
    const area = rooms[i].w * rooms[i].h;
    if (area > bestArea) {
      bestArea = area;
      bestRoom = rooms[i];
    }
  }

  const col = Math.floor(bestRoom.x + bestRoom.w / 2);
  const row = Math.floor(bestRoom.y + bestRoom.h / 2);
  const boss = createEnemy(BOSS_TEMPLATE, col, row);
  scaleEnemyForFloor(boss, floor);
  return boss;
}

/** Render attack range overlay for a selected enemy (debug/targeting). */
export function renderAttackRange(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  range: number,
): void {
  for (let dr = -range; dr <= range; dr++) {
    for (let dc = -range; dc <= range; dc++) {
      if (Math.abs(dr) + Math.abs(dc) > range) continue;
      if (dr === 0 && dc === 0) continue;
      const px = (col + dc) * TILE_SIZE;
      const py = (row + dr) * TILE_SIZE;
      ctx.fillStyle = "rgba(255, 80, 80, 0.15)";
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.strokeStyle = "rgba(255, 80, 80, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    }
  }
}
