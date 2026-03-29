/**
 * Turn-based combat system (Advance Wars-style).
 *
 * Combat resolves on the dungeon grid. Turn order:
 *   1. Player selects unit -> move -> attack
 *   2. All enemies act (move toward party, attack if in range)
 *
 * Dice rolls determine hit/damage. Characters and enemies can be defeated.
 */

import { TileMap, TILE_SIZE } from "./tilemap";
import { Character, PartyState } from "./party";
import { getEffectiveStat } from "./loot";
import {
  Enemy,
  isInAttackRange,
  planEnemyAction,
  startEnemyMove,
  updateEnemyMovement,
  renderAttackRange,
} from "./enemies";
import { getReachableTiles, findPath, GridPos } from "./pathfinding";

// ── Combat state machine ────────────────────────────────────────────────────

export type CombatPhase =
  | "player_select"      // player picks a character to act
  | "player_move"        // selected character moves
  | "player_animating"   // movement animation playing
  | "player_attack"      // select attack target
  | "attack_anim"        // attack animation/result display
  | "enemy_turn"         // enemies acting
  | "enemy_animating"    // enemy movement animation
  | "enemy_attack_anim"  // enemy attack animation
  | "combat_over";       // all enemies or all party dead

export interface CombatUnit {
  character: Character;
  col: number;
  row: number;
  px: number;
  py: number;
  hasMoved: boolean;
  hasAttacked: boolean;
  movePath: GridPos[];
  moveIndex: number;
}

export interface DamagePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  timer: number; // seconds remaining
}

export interface CombatState {
  active: boolean;
  phase: CombatPhase;
  units: CombatUnit[];
  enemies: Enemy[];
  selectedUnit: number; // index into units, -1 = none
  reachableTiles: Map<string, number> | null;
  attackableTiles: GridPos[];
  turnNumber: number;
  popups: DamagePopup[];
  message: string;
  messageTimer: number;
  /** Enemy AI processing state */
  currentEnemyIdx: number;
  enemyActionDelay: number;
  /** Result */
  victory: boolean;
}

// ── Initialization ──────────────────────────────────────────────────────────

/** Start combat with the party's current characters vs. nearby enemies. */
export function startCombat(
  party: PartyState,
  enemies: Enemy[],
): CombatState {
  // Create individual combat units from party members
  // Spread them in a 2x2 formation around the party position
  const offsets = [
    { dc: 0, dr: 0 },
    { dc: 1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: 1, dr: 1 },
  ];

  const units: CombatUnit[] = party.members
    .filter((m) => m.stats.hp > 0)
    .map((char, i) => {
      const ofs = offsets[i % offsets.length];
      const col = party.col + ofs.dc;
      const row = party.row + ofs.dr;
      return {
        character: char,
        col,
        row,
        px: col * TILE_SIZE + TILE_SIZE / 2,
        py: row * TILE_SIZE + TILE_SIZE / 2,
        hasMoved: false,
        hasAttacked: false,
        movePath: [],
        moveIndex: 0,
      };
    });

  // All enemies entering combat become aggro
  const combatEnemies = enemies.filter((e) => e.alive);
  for (const e of combatEnemies) {
    e.aggro = true;
  }

  return {
    active: true,
    phase: "player_select",
    units,
    enemies: combatEnemies,
    selectedUnit: -1,
    reachableTiles: null,
    attackableTiles: [],
    turnNumber: 1,
    popups: [],
    message: "Combat! Select a unit to act.",
    messageTimer: 2,
    currentEnemyIdx: 0,
    enemyActionDelay: 0,
    victory: false,
  };
}

// ── Dice rolls & damage ─────────────────────────────────────────────────────

/** Roll a d20 for hit chance. Returns the roll value (1-20). */
function rollD20(): number {
  return 1 + Math.floor(Math.random() * 20);
}

/** Roll damage dice: base ATK +/- randomness, reduced by DEF. */
function calculateDamage(atk: number, def: number): { damage: number; roll: number; hit: boolean } {
  const roll = rollD20();
  // Hit if roll >= 6 (75% base hit rate). Lower DEF doesn't affect hit, just damage.
  const hit = roll >= 6;
  if (!hit) return { damage: 0, roll, hit: false };

  // Damage = ATK * (roll modifier) - DEF/2, minimum 1
  const rollMod = 0.5 + (roll / 20); // 0.55 to 1.5
  const rawDamage = Math.round(atk * rollMod - def * 0.5);
  const damage = Math.max(1, rawDamage);
  return { damage, roll, hit: true };
}

// ── Player actions ──────────────────────────────────────────────────────────

/** Select a unit for action. */
export function selectUnit(combat: CombatState, unitIndex: number, map: TileMap): void {
  if (combat.phase !== "player_select") return;
  const unit = combat.units[unitIndex];
  if (!unit || unit.character.stats.hp <= 0) return;
  if (unit.hasMoved && unit.hasAttacked) return;

  combat.selectedUnit = unitIndex;

  if (!unit.hasMoved) {
    combat.phase = "player_move";
    combat.reachableTiles = getReachableTiles(
      map,
      { col: unit.col, row: unit.row },
      getEffectiveStat(unit.character, "moveRange"),
    );
    combat.message = `${unit.character.name}: Click a tile to move, or right-click to skip.`;
  } else if (!unit.hasAttacked) {
    combat.phase = "player_attack";
    combat.attackableTiles = getAttackableTiles(combat, unitIndex);
    combat.message = `${unit.character.name}: Click an enemy to attack.`;
  }
  combat.messageTimer = 3;
}

/** Move the selected unit to a tile. */
export function moveUnit(
  combat: CombatState,
  targetCol: number,
  targetRow: number,
  map: TileMap,
): boolean {
  if (combat.phase !== "player_move" || combat.selectedUnit < 0) return false;
  const unit = combat.units[combat.selectedUnit];

  // Check reachable
  const key = `${targetCol},${targetRow}`;
  if (!combat.reachableTiles?.has(key)) return false;

  // Check not occupied by another unit
  if (isTileOccupied(combat, targetCol, targetRow, combat.selectedUnit)) return false;

  const path = findPath(
    map,
    { col: unit.col, row: unit.row },
    { col: targetCol, row: targetRow },
    getEffectiveStat(unit.character, "moveRange"),
  );

  if (!path || path.length === 0) return false;

  unit.movePath = path;
  unit.moveIndex = 0;
  combat.phase = "player_animating";
  combat.reachableTiles = null;
  return true;
}

/** Skip movement for selected unit and go to attack phase. */
export function skipMove(combat: CombatState): void {
  if (combat.phase !== "player_move" || combat.selectedUnit < 0) return;
  const unit = combat.units[combat.selectedUnit];
  unit.hasMoved = true;
  combat.reachableTiles = null;
  combat.attackableTiles = getAttackableTiles(combat, combat.selectedUnit);

  if (combat.attackableTiles.length > 0) {
    combat.phase = "player_attack";
    combat.message = `${unit.character.name}: Click an enemy to attack.`;
  } else {
    combat.message = `${unit.character.name}: No targets in range.`;
    unit.hasAttacked = true;
    combat.selectedUnit = -1;
    combat.phase = "player_select";
    checkTurnEnd(combat);
  }
  combat.messageTimer = 2;
}

/** Attack an enemy at the target position. */
export function attackEnemy(
  combat: CombatState,
  targetCol: number,
  targetRow: number,
): boolean {
  if (combat.phase !== "player_attack" || combat.selectedUnit < 0) return false;
  const unit = combat.units[combat.selectedUnit];

  // Find enemy at target
  const enemy = combat.enemies.find(
    (e) => e.alive && e.col === targetCol && e.row === targetRow,
  );
  if (!enemy) return false;

  // Check range
  const dist = Math.abs(unit.col - targetCol) + Math.abs(unit.row - targetRow);
  const attackRange = getUnitAttackRange(unit.character);
  if (dist > attackRange) return false;

  // Roll dice! Use effective ATK (base + equipment)
  const { damage, roll, hit } = calculateDamage(
    getEffectiveStat(unit.character, "atk"),
    enemy.stats.def,
  );

  if (hit) {
    enemy.stats.hp = Math.max(0, enemy.stats.hp - damage);
    addPopup(combat, enemy.px, enemy.py - 16, `-${damage}`, "#ff4444");
    combat.message = `${unit.character.name} hits ${enemy.name} for ${damage}! (d20=${roll})`;
    if (enemy.stats.hp <= 0) {
      enemy.alive = false;
      combat.message += ` ${enemy.name} defeated!`;
    }
  } else {
    addPopup(combat, enemy.px, enemy.py - 16, "MISS", "#aaaaaa");
    combat.message = `${unit.character.name} misses ${enemy.name}! (d20=${roll})`;
  }

  unit.hasAttacked = true;
  combat.messageTimer = 2.5;
  combat.phase = "attack_anim";
  combat.attackableTiles = [];

  return true;
}

/** Skip attack for selected unit. */
export function skipAttack(combat: CombatState): void {
  if (combat.phase !== "player_attack" || combat.selectedUnit < 0) return;
  const unit = combat.units[combat.selectedUnit];
  unit.hasAttacked = true;
  combat.attackableTiles = [];
  combat.selectedUnit = -1;
  combat.phase = "player_select";
  combat.message = `${unit.character.name} waits.`;
  combat.messageTimer = 1.5;
  checkTurnEnd(combat);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getUnitAttackRange(char: Character): number {
  // Mage and Cleric get 2-tile range, Rogue gets 1, Knight gets 1
  if (char.name === "Mage") return 2;
  if (char.name === "Cleric") return 2;
  return 1;
}

function isTileOccupied(combat: CombatState, col: number, row: number, excludeUnit: number): boolean {
  for (let i = 0; i < combat.units.length; i++) {
    if (i === excludeUnit) continue;
    if (combat.units[i].character.stats.hp > 0 && combat.units[i].col === col && combat.units[i].row === row) {
      return true;
    }
  }
  for (const e of combat.enemies) {
    if (e.alive && e.col === col && e.row === row) return true;
  }
  return false;
}

function getAttackableTiles(combat: CombatState, unitIndex: number): GridPos[] {
  const unit = combat.units[unitIndex];
  const range = getUnitAttackRange(unit.character);
  const tiles: GridPos[] = [];

  for (const enemy of combat.enemies) {
    if (!enemy.alive) continue;
    const dist = Math.abs(unit.col - enemy.col) + Math.abs(unit.row - enemy.row);
    if (dist <= range) {
      tiles.push({ col: enemy.col, row: enemy.row });
    }
  }
  return tiles;
}

function addPopup(combat: CombatState, x: number, y: number, text: string, color: string): void {
  combat.popups.push({ x, y, text, color, timer: 1.5 });
}

function checkTurnEnd(combat: CombatState): void {
  // Check victory/defeat
  const aliveEnemies = combat.enemies.filter((e) => e.alive);
  const aliveUnits = combat.units.filter((u) => u.character.stats.hp > 0);

  if (aliveEnemies.length === 0) {
    combat.phase = "combat_over";
    combat.victory = true;
    combat.message = "Victory! All enemies defeated!";
    combat.messageTimer = 4;
    return;
  }

  if (aliveUnits.length === 0) {
    combat.phase = "combat_over";
    combat.victory = false;
    combat.message = "Defeat... The party has fallen.";
    combat.messageTimer = 4;
    return;
  }

  // Check if all units have acted
  const allActed = combat.units
    .filter((u) => u.character.stats.hp > 0)
    .every((u) => u.hasMoved && u.hasAttacked);

  if (allActed) {
    startEnemyTurn(combat);
  }
}

// ── Enemy turn ──────────────────────────────────────────────────────────────

function startEnemyTurn(combat: CombatState): void {
  combat.phase = "enemy_turn";
  combat.currentEnemyIdx = 0;
  combat.enemyActionDelay = 0.3; // small delay before enemies start acting
  combat.message = "Enemy turn...";
  combat.messageTimer = 2;

  // Reset enemy action flags
  for (const enemy of combat.enemies) {
    if (enemy.alive) enemy.hasActed = false;
  }
}

/** Find the closest alive party unit to an enemy. */
function findClosestUnit(combat: CombatState, enemy: Enemy): CombatUnit | null {
  let best: CombatUnit | null = null;
  let bestDist = Infinity;
  for (const unit of combat.units) {
    if (unit.character.stats.hp <= 0) continue;
    const dist = Math.abs(unit.col - enemy.col) + Math.abs(unit.row - enemy.row);
    if (dist < bestDist) {
      bestDist = dist;
      best = unit;
    }
  }
  return best;
}

// ── Per-frame update ────────────────────────────────────────────────────────

const UNIT_MOVE_SPEED = 200;

export function updateCombat(combat: CombatState, dt: number, map: TileMap): void {
  if (!combat.active) return;

  // Update popups
  combat.popups = combat.popups.filter((p) => {
    p.timer -= dt;
    p.y -= 30 * dt; // float upward
    return p.timer > 0;
  });

  // Decay message
  if (combat.messageTimer > 0) {
    combat.messageTimer -= dt;
  }

  // Handle player animation
  if (combat.phase === "player_animating") {
    const unit = combat.units[combat.selectedUnit];
    if (animateUnitMove(unit, dt)) {
      // Still moving
    } else {
      // Movement done
      unit.hasMoved = true;
      combat.attackableTiles = getAttackableTiles(combat, combat.selectedUnit);

      if (combat.attackableTiles.length > 0) {
        combat.phase = "player_attack";
        combat.message = `${unit.character.name}: Click an enemy to attack, or right-click to skip.`;
        combat.messageTimer = 3;
      } else {
        unit.hasAttacked = true;
        combat.selectedUnit = -1;
        combat.phase = "player_select";
        combat.message = "No enemies in range. Select next unit.";
        combat.messageTimer = 2;
        checkTurnEnd(combat);
      }
    }
    return;
  }

  // Attack animation (brief pause, then return to select)
  if (combat.phase === "attack_anim") {
    if (combat.messageTimer <= 1.5) {
      combat.selectedUnit = -1;
      combat.phase = "player_select";
      checkTurnEnd(combat);
    }
    return;
  }

  // Enemy turn processing
  if (combat.phase === "enemy_turn") {
    combat.enemyActionDelay -= dt;
    if (combat.enemyActionDelay > 0) return;

    // Find next alive enemy that hasn't acted
    while (
      combat.currentEnemyIdx < combat.enemies.length &&
      (!combat.enemies[combat.currentEnemyIdx].alive ||
        combat.enemies[combat.currentEnemyIdx].hasActed)
    ) {
      combat.currentEnemyIdx++;
    }

    if (combat.currentEnemyIdx >= combat.enemies.length) {
      // All enemies acted, start new player turn
      startNewPlayerTurn(combat);
      return;
    }

    const enemy = combat.enemies[combat.currentEnemyIdx];
    const target = findClosestUnit(combat, enemy);
    if (!target) {
      enemy.hasActed = true;
      combat.currentEnemyIdx++;
      combat.enemyActionDelay = 0.2;
      return;
    }

    const action = planEnemyAction(enemy, target.col, target.row, map, combat.enemies);

    if (action.moveTo) {
      if (startEnemyMove(enemy, action.moveTo, map)) {
        combat.phase = "enemy_animating";
        combat.message = `${enemy.name} moves...`;
        combat.messageTimer = 1.5;
      } else {
        // Can't move, try to attack from current position
        if (action.canAttack || isInAttackRange(enemy, target.col, target.row)) {
          performEnemyAttack(combat, enemy, target);
        }
        enemy.hasActed = true;
        combat.currentEnemyIdx++;
        combat.enemyActionDelay = 0.4;
        combat.phase = "enemy_turn";
      }
    } else if (action.canAttack) {
      performEnemyAttack(combat, enemy, target);
      enemy.hasActed = true;
      combat.currentEnemyIdx++;
      combat.enemyActionDelay = 0.6;
    } else {
      enemy.hasActed = true;
      combat.currentEnemyIdx++;
      combat.enemyActionDelay = 0.2;
    }
    return;
  }

  // Enemy animation
  if (combat.phase === "enemy_animating") {
    const enemy = combat.enemies[combat.currentEnemyIdx];
    if (updateEnemyMovement(enemy, dt)) {
      // Still moving
    } else {
      // Done moving, try to attack
      const target = findClosestUnit(combat, enemy);
      if (target && isInAttackRange(enemy, target.col, target.row)) {
        performEnemyAttack(combat, enemy, target);
        combat.phase = "enemy_attack_anim";
        combat.enemyActionDelay = 0.6;
      } else {
        enemy.hasActed = true;
        combat.currentEnemyIdx++;
        combat.phase = "enemy_turn";
        combat.enemyActionDelay = 0.3;
      }
    }
    return;
  }

  // Enemy attack anim
  if (combat.phase === "enemy_attack_anim") {
    combat.enemyActionDelay -= dt;
    if (combat.enemyActionDelay <= 0) {
      const enemy = combat.enemies[combat.currentEnemyIdx];
      enemy.hasActed = true;
      combat.currentEnemyIdx++;
      combat.phase = "enemy_turn";
      combat.enemyActionDelay = 0.3;

      // Check if party wiped
      const aliveUnits = combat.units.filter((u) => u.character.stats.hp > 0);
      if (aliveUnits.length === 0) {
        combat.phase = "combat_over";
        combat.victory = false;
        combat.message = "Defeat... The party has fallen.";
        combat.messageTimer = 4;
      }
    }
    return;
  }
}

function performEnemyAttack(combat: CombatState, enemy: Enemy, target: CombatUnit): void {
  const { damage, roll, hit } = calculateDamage(enemy.stats.atk, getEffectiveStat(target.character, "def"));

  if (hit) {
    target.character.stats.hp = Math.max(0, target.character.stats.hp - damage);
    addPopup(combat, target.px, target.py - 16, `-${damage}`, "#ff6644");
    combat.message = `${enemy.name} hits ${target.character.name} for ${damage}! (d20=${roll})`;
    if (target.character.stats.hp <= 0) {
      combat.message += ` ${target.character.name} falls!`;
    }
  } else {
    addPopup(combat, target.px, target.py - 16, "MISS", "#aaaaaa");
    combat.message = `${enemy.name} misses ${target.character.name}! (d20=${roll})`;
  }
  combat.messageTimer = 2;
}

function startNewPlayerTurn(combat: CombatState): void {
  combat.turnNumber++;
  combat.phase = "player_select";
  combat.selectedUnit = -1;
  combat.message = `Turn ${combat.turnNumber} — Select a unit.`;
  combat.messageTimer = 2;

  // Reset unit action flags
  for (const unit of combat.units) {
    if (unit.character.stats.hp > 0) {
      unit.hasMoved = false;
      unit.hasAttacked = false;
    }
  }
}

function animateUnitMove(unit: CombatUnit, dt: number): boolean {
  if (unit.moveIndex >= unit.movePath.length) {
    unit.movePath = [];
    unit.moveIndex = 0;
    return false;
  }

  const target = unit.movePath[unit.moveIndex];
  const targetPx = target.col * TILE_SIZE + TILE_SIZE / 2;
  const targetPy = target.row * TILE_SIZE + TILE_SIZE / 2;

  const ddx = targetPx - unit.px;
  const ddy = targetPy - unit.py;
  const dist = Math.sqrt(ddx * ddx + ddy * ddy);

  if (dist < 2) {
    unit.px = targetPx;
    unit.py = targetPy;
    unit.col = target.col;
    unit.row = target.row;
    unit.moveIndex++;

    if (unit.moveIndex >= unit.movePath.length) {
      unit.movePath = [];
      unit.moveIndex = 0;
      return false;
    }
  } else {
    const step = UNIT_MOVE_SPEED * dt;
    unit.px += (ddx / dist) * Math.min(step, dist);
    unit.py += (ddy / dist) * Math.min(step, dist);
  }
  return true;
}

// ── Rendering ───────────────────────────────────────────────────────────────

export function renderCombat(
  ctx: CanvasRenderingContext2D,
  combat: CombatState,
  _canvasW: number,
  _canvasH: number,
): void {
  if (!combat.active) return;

  // Render movement range for selected unit
  if (combat.phase === "player_move" && combat.reachableTiles) {
    for (const [key] of combat.reachableTiles) {
      const [c, r] = key.split(",").map(Number);
      const unit = combat.units[combat.selectedUnit];
      if (c === unit.col && r === unit.row) continue;
      const px = c * TILE_SIZE;
      const py = r * TILE_SIZE;
      ctx.fillStyle = "rgba(100, 200, 255, 0.2)";
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.strokeStyle = "rgba(100, 200, 255, 0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    }
  }

  // Render attack range for selected unit
  if (combat.phase === "player_attack" && combat.selectedUnit >= 0) {
    const unit = combat.units[combat.selectedUnit];
    const range = getUnitAttackRange(unit.character);
    renderAttackRange(ctx, unit.col, unit.row, range);

    // Highlight attackable enemies
    for (const tile of combat.attackableTiles) {
      const px = tile.col * TILE_SIZE;
      const py = tile.row * TILE_SIZE;
      ctx.strokeStyle = "rgba(255, 50, 50, 0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    }
  }

  // Render combat units (party members at individual positions)
  const spriteSize = 14;
  const half = spriteSize / 2;

  for (let i = 0; i < combat.units.length; i++) {
    const unit = combat.units[i];
    if (unit.character.stats.hp <= 0) continue;

    const isSelected = i === combat.selectedUnit;
    const canAct = !unit.hasMoved || !unit.hasAttacked;

    // Selection highlight
    if (isSelected) {
      ctx.strokeStyle = "#ffff00";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        unit.px - half - 3,
        unit.py - half - 3,
        spriteSize + 6,
        spriteSize + 6,
      );
    } else if (canAct && combat.phase === "player_select") {
      // Pulsing outline for actionable units
      ctx.strokeStyle = "rgba(255, 255, 100, 0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        unit.px - half - 2,
        unit.py - half - 2,
        spriteSize + 4,
        spriteSize + 4,
      );
    }

    // Body
    ctx.fillStyle = unit.character.color;
    ctx.fillRect(unit.px - half, unit.py - half, spriteSize, spriteSize);

    // Dim overlay for units that have fully acted
    if (unit.hasMoved && unit.hasAttacked) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(unit.px - half, unit.py - half, spriteSize, spriteSize);
    }

    // Outline
    ctx.strokeStyle = unit.character.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(unit.px - half, unit.py - half, spriteSize, spriteSize);

    // Icon
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(unit.character.icon, unit.px, unit.py + 1);

    // HP bar
    const barW = spriteSize + 4;
    const barH = 3;
    const barX = unit.px - barW / 2;
    const barY = unit.py - half - 6;
    const hpRatio = unit.character.stats.hp / unit.character.stats.maxHp;

    ctx.fillStyle = "rgba(0, 50, 0, 0.6)";
    ctx.fillRect(barX, barY, barW, barH);
    const hpColor = hpRatio > 0.5 ? "#44bb44" : hpRatio > 0.25 ? "#bbbb44" : "#bb4444";
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * hpRatio, barH);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Render combat HUD (overlaid on screen coords, call after camera.reset). */
export function renderCombatHUD(
  ctx: CanvasRenderingContext2D,
  combat: CombatState,
  canvasW: number,
  canvasH: number,
): void {
  if (!combat.active) return;

  // Phase indicator bar at top
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(0, 0, canvasW, 26);

  ctx.fillStyle = "#ff6644";
  ctx.font = "bold 12px monospace";
  ctx.fillText(`⚔ COMBAT — Turn ${combat.turnNumber}`, 8, 17);

  const phaseLabel = combat.phase.startsWith("player") ? "PLAYER TURN" : "ENEMY TURN";
  ctx.fillStyle = combat.phase.startsWith("player") ? "#88ccff" : "#ff8844";
  ctx.fillText(phaseLabel, canvasW - 160, 17);

  // Unit status panel (right side)
  const panelW = 190;
  const panelH = 28 + combat.units.length * 22;
  const panelX = canvasW - panelW - 8;
  const panelY = 34;

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(255, 100, 50, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 11px monospace";
  ctx.fillText("Party", panelX + 6, panelY + 16);

  for (let i = 0; i < combat.units.length; i++) {
    const unit = combat.units[i];
    const char = unit.character;
    const y = panelY + 30 + i * 22;
    const alive = char.stats.hp > 0;

    // Status icon
    ctx.fillStyle = alive
      ? unit.hasMoved && unit.hasAttacked
        ? "#666"
        : char.color
      : "#444";
    ctx.fillRect(panelX + 6, y - 6, 8, 8);

    // Name
    ctx.fillStyle = alive ? "#ddd" : "#666";
    ctx.font = "10px monospace";
    ctx.fillText(char.name, panelX + 18, y);

    // HP bar
    const barX = panelX + 75;
    const barW = 55;
    const barH = 6;
    ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
    ctx.fillRect(barX, y - 6, barW, barH);

    const hpRatio = char.stats.hp / char.stats.maxHp;
    const hpColor = hpRatio > 0.5 ? "#44bb44" : hpRatio > 0.25 ? "#bbbb44" : "#bb4444";
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, y - 6, barW * hpRatio, barH);

    // HP text
    ctx.fillStyle = "#aaa";
    ctx.font = "9px monospace";
    ctx.fillText(`${char.stats.hp}/${char.stats.maxHp}`, panelX + 134, y);
  }

  // Combat message bar at bottom
  if (combat.message && combat.messageTimer > 0) {
    const msgW = Math.min(canvasW - 16, 500);
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(canvasW / 2 - msgW / 2, canvasH - 50, msgW, 34);
    ctx.strokeStyle = "rgba(255, 100, 50, 0.4)";
    ctx.strokeRect(canvasW / 2 - msgW / 2, canvasH - 50, msgW, 34);

    ctx.fillStyle = "#ffd700";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(combat.message, canvasW / 2, canvasH - 28);
    ctx.textAlign = "left";
  }

  // Victory/defeat overlay
  if (combat.phase === "combat_over") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, canvasH / 2 - 40, canvasW, 80);

    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = combat.victory ? "#44ff44" : "#ff4444";
    ctx.fillText(
      combat.victory ? "VICTORY!" : "DEFEAT",
      canvasW / 2,
      canvasH / 2 + 10,
    );
    ctx.textAlign = "left";
  }
}

/** Render damage popups (call in world coords, before camera.reset). */
export function renderPopups(
  ctx: CanvasRenderingContext2D,
  combat: CombatState,
): void {
  for (const popup of combat.popups) {
    const alpha = Math.min(1, popup.timer / 0.5);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = popup.color;
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(popup.text, popup.x, popup.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}
