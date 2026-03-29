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
}

export interface Enemy {
  id: number;
  name: string;
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
}

// ── Enemy templates ─────────────────────────────────────────────────────────

interface EnemyTemplate {
  name: string;
  stats: EnemyStats;
  color: string;
  accent: string;
  icon: string;
}

const ENEMY_TEMPLATES: EnemyTemplate[] = [
  {
    name: "Goblin",
    stats: { hp: 12, maxHp: 12, atk: 5, def: 2, moveRange: 4, attackRange: 1 },
    color: "#668833",
    accent: "#99bb55",
    icon: "G",
  },
  {
    name: "Skeleton",
    stats: { hp: 16, maxHp: 16, atk: 7, def: 3, moveRange: 3, attackRange: 1 },
    color: "#aaaaaa",
    accent: "#dddddd",
    icon: "S",
  },
  {
    name: "Rat",
    stats: { hp: 6, maxHp: 6, atk: 3, def: 1, moveRange: 5, attackRange: 1 },
    color: "#886644",
    accent: "#aa8866",
    icon: "r",
  },
  {
    name: "Archer",
    stats: { hp: 10, maxHp: 10, atk: 8, def: 1, moveRange: 3, attackRange: 3 },
    color: "#cc6644",
    accent: "#ee8866",
    icon: "A",
  },
];

let nextEnemyId = 1;

function createEnemy(template: EnemyTemplate, col: number, row: number): Enemy {
  return {
    id: nextEnemyId++,
    name: template.name,
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
  };
}

// ── Spawning ────────────────────────────────────────────────────────────────

/** Spawn enemies in rooms (skip the first room where the party spawns). */
export function spawnEnemies(
  rooms: DungeonRoom[],
  map: TileMap,
  occupiedCols: number[],
  occupiedRows: number[],
): Enemy[] {
  const enemies: Enemy[] = [];
  const occupied = new Set<string>();

  // Mark party area as occupied
  for (let i = 0; i < occupiedCols.length; i++) {
    occupied.add(`${occupiedCols[i]},${occupiedRows[i]}`);
  }

  // Skip the first room (spawn room), place 1-3 enemies per room
  for (let ri = 1; ri < rooms.length; ri++) {
    const room = rooms[ri];
    const count = 1 + Math.floor(Math.random() * 2); // 1-2 enemies per room

    for (let i = 0; i < count; i++) {
      // Try to find an unoccupied floor tile in this room
      for (let attempt = 0; attempt < 20; attempt++) {
        const col = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const row = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
        const key = `${col},${row}`;

        if (!map.isSolid(col, row) && !occupied.has(key)) {
          occupied.add(key);
          const template = ENEMY_TEMPLATES[Math.floor(Math.random() * ENEMY_TEMPLATES.length)];
          enemies.push(createEnemy(template, col, row));
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

/** Plan enemy AI move: try to move closer to the party, then attack. */
export function planEnemyAction(
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

  // Find reachable tiles
  const reachable = getReachableTiles(map, { col: enemy.col, row: enemy.row }, enemy.stats.moveRange);

  // Build set of tiles occupied by other living enemies
  const enemyPositions = new Set<string>();
  for (const e of allEnemies) {
    if (e.alive && e.id !== enemy.id) {
      enemyPositions.add(`${e.col},${e.row}`);
    }
  }

  // Find best reachable tile (closest to party)
  let bestTile: GridPos | null = null;
  let bestDist = Infinity;
  let bestCanAttack = false;

  for (const [key] of reachable) {
    const [c, r] = key.split(",").map(Number);
    // Don't move onto another enemy
    if (enemyPositions.has(key)) continue;
    // Skip current position in movement search
    if (c === enemy.col && r === enemy.row) continue;

    const dist = Math.abs(c - partyCol) + Math.abs(r - partyRow);
    const canAttackFromHere = dist <= enemy.stats.attackRange;

    // Prefer tiles that allow attacking, then closest
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

const ENEMY_MOVE_SPEED = 160; // pixels per second

/** Update enemy movement animation. Returns true if still animating. */
export function updateEnemyMovement(enemy: Enemy, dt: number): boolean {
  if (enemy.moveIndex >= enemy.movePath.length) {
    enemy.movePath = [];
    enemy.moveIndex = 0;
    return false;
  }

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
    const step = ENEMY_MOVE_SPEED * dt;
    enemy.px += (ddx / dist) * Math.min(step, dist);
    enemy.py += (ddy / dist) * Math.min(step, dist);
  }
  return true;
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** Render all living enemies on the grid. */
export function renderEnemies(
  ctx: CanvasRenderingContext2D,
  enemies: Enemy[],
): void {
  const spriteSize = 14;
  const half = spriteSize / 2;

  for (const enemy of enemies) {
    if (!enemy.alive) continue;

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

    // HP bar above sprite
    const barW = spriteSize + 4;
    const barH = 3;
    const barX = enemy.px - barW / 2;
    const barY = enemy.py - half - 6;
    const hpRatio = enemy.stats.hp / enemy.stats.maxHp;

    ctx.fillStyle = "rgba(100, 0, 0, 0.6)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpRatio > 0.5 ? "#cc4444" : hpRatio > 0.25 ? "#cc8844" : "#cc2222";
    ctx.fillRect(barX, barY, barW * hpRatio, barH);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
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
