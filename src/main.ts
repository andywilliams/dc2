import { Input } from "./input";
import { Camera } from "./camera";
import { TILE_SIZE, TILE_DOOR, TILE_STAIRS_DOWN } from "./tilemap";
import { generateDungeon } from "./dungeon";
import {
  PartyState,
  createPartyState,
  updateMovement,
  startMove,
  endTurn,
  cacheReachable,
  renderReachable,
  renderPathPreview,
  renderParty,
  renderPartyHUD,
} from "./party";
import {
  Enemy,
  spawnEnemies,
  renderEnemies,
  getEnemiesInRange,
} from "./enemies";
import {
  CombatState,
  startCombat,
  updateCombat,
  selectUnit,
  moveUnit,
  skipMove,
  attackEnemy,
  skipAttack,
  renderCombat,
  renderCombatHUD,
  renderPopups,
} from "./combat";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 600;
const COMBAT_TRIGGER_RANGE = 3; // tiles from party to trigger combat

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext("2d")!;

const input = new Input(canvas);

// Generate a procedural dungeon
let { map: tileMap, spawnX, spawnY, rooms } = generateDungeon();
let camera = new Camera(CANVAS_W, CANVAS_H, tileMap.widthPx, tileMap.heightPx);

// Party state — starts at dungeon spawn point
let party: PartyState = createPartyState(spawnX, spawnY);

// Enemy state
let enemies: Enemy[] = spawnEnemies(rooms, tileMap, [spawnX], [spawnY]);

// Combat state
let combat: CombatState | null = null;

/** Regenerate dungeon (press R to get a new layout). */
function regenerate(): void {
  const result = generateDungeon();
  tileMap = result.map;
  spawnX = result.spawnX;
  spawnY = result.spawnY;
  rooms = result.rooms;
  camera = new Camera(CANVAS_W, CANVAS_H, tileMap.widthPx, tileMap.heightPx);
  party = createPartyState(spawnX, spawnY);
  enemies = spawnEnemies(rooms, tileMap, [spawnX], [spawnY]);
  combat = null;
  showHudMessage("New dungeon generated!");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the tile the mouse is hovering over (world coords). */
function getHoverTile(): { col: number; row: number } {
  const world = camera.screenToWorld(input.mouse.x, input.mouse.y);
  return {
    col: Math.floor(world.x / TILE_SIZE),
    row: Math.floor(world.y / TILE_SIZE),
  };
}

// HUD message state
let hudMessage = "";
let hudMessageTimer = 0;

function showHudMessage(msg: string, duration = 2): void {
  hudMessage = msg;
  hudMessageTimer = duration;
}

/** Check if combat should trigger (enemies near party). */
function checkCombatTrigger(): void {
  if (combat) return;

  const nearbyEnemies = getEnemiesInRange(
    enemies,
    party.col,
    party.row,
    COMBAT_TRIGGER_RANGE,
  );

  if (nearbyEnemies.length > 0) {
    combat = startCombat(party, nearbyEnemies);
    showHudMessage("Enemies spotted! Combat begins!", 2);
  }
}

/** Handle combat ending — sync state back to party. */
function handleCombatEnd(): void {
  if (!combat || combat.phase !== "combat_over") return;

  // Remove dead enemies from the main enemy list
  for (const ce of combat.enemies) {
    if (!ce.alive) {
      const idx = enemies.findIndex((e) => e.id === ce.id);
      if (idx >= 0) enemies[idx].alive = false;
    }
  }

  // Sync party HP back
  for (const unit of combat.units) {
    const member = party.members.find((m) => m.name === unit.character.name);
    if (member) {
      member.stats.hp = unit.character.stats.hp;
    }
  }

  combat = null;
  // Resume exploration
  party.turnPhase = "move";
  party.reachableTiles = null;
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
let lastTime = 0;

function frame(time: number): void {
  const dt = Math.min((time - lastTime) / 1000, 0.05); // cap delta
  lastTime = time;

  // — Input ----------------------------------------------------------------
  input.update();

  // — Update ---------------------------------------------------------------

  if (combat && combat.active) {
    // ── Combat mode ──────────────────────────────────────────────────────
    updateCombat(combat, dt, tileMap);

    const hover = getHoverTile();

    // Handle combat-over: press Space to exit
    if (combat.phase === "combat_over") {
      if (input.justPressed("Space")) {
        handleCombatEnd();
      }
    }

    // Player input during combat
    if (combat.phase === "player_select" && input.mouse.clicked) {
      // Check if clicked on a unit
      for (let i = 0; i < combat.units.length; i++) {
        const unit = combat.units[i];
        if (unit.character.stats.hp <= 0) continue;
        if (unit.col === hover.col && unit.row === hover.row) {
          selectUnit(combat, i, tileMap);
          break;
        }
      }
    }

    if (combat.phase === "player_move") {
      if (input.mouse.clicked) {
        moveUnit(combat, hover.col, hover.row, tileMap);
      }
      // Right-click to skip move
      if (input.justPressed("KeyX")) {
        skipMove(combat);
      }
    }

    if (combat.phase === "player_attack") {
      if (input.mouse.clicked) {
        attackEnemy(combat, hover.col, hover.row);
      }
      // Right-click / X to skip attack
      if (input.justPressed("KeyX")) {
        skipAttack(combat);
      }
    }
  } else {
    // ── Exploration mode ─────────────────────────────────────────────────

    // Regenerate dungeon on R press
    if (input.justPressed("KeyR")) {
      regenerate();
    }

    // End turn on Space press
    if (input.justPressed("Space") && party.turnPhase === "move") {
      endTurn(party);
      cacheReachable(party, tileMap);
      showHudMessage("New turn!");
    }

    // Click to move
    if (input.mouse.clicked && party.turnPhase === "move") {
      const hover = getHoverTile();
      if (startMove(party, hover.col, hover.row, tileMap)) {
        // Movement started
      } else {
        // Check tile interaction
        const cell = tileMap.getCell(hover.col, hover.row);
        if (cell?.meta?.label) {
          showHudMessage(cell.meta.label);
        }
      }
    }

    // Animate movement
    updateMovement(party, dt);

    // After movement completes, re-cache reachable tiles
    if (party.turnPhase === "move" && !party.reachableTiles) {
      cacheReachable(party, tileMap);
    }

    // Check for combat trigger after movement
    if (party.turnPhase === "move") {
      checkCombatTrigger();
    }

    // Check what tile the party is standing on
    const standingOn = tileMap.getCell(party.col, party.row);

    // Tile interaction hints
    if (standingOn?.type === TILE_STAIRS_DOWN) {
      hudMessage = `[${standingOn.meta?.label ?? "Stairs down"}] — press E to descend`;
      hudMessageTimer = 0.1;
    } else if (standingOn?.type === TILE_DOOR && standingOn.meta?.label) {
      hudMessage = standingOn.meta.label;
      hudMessageTimer = 0.1;
    }
  }

  // Decay HUD message
  if (hudMessageTimer > 0) {
    hudMessageTimer -= dt;
    if (hudMessageTimer <= 0) {
      hudMessage = "";
    }
  }

  camera.follow(party.px, party.py);

  // — Render ---------------------------------------------------------------
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  camera.apply(ctx);

  // Tiles
  tileMap.render(ctx, camera.x, camera.y, CANVAS_W, CANVAS_H);

  if (combat && combat.active) {
    // Combat rendering (world coords)
    renderCombat(ctx, combat, CANVAS_W, CANVAS_H);
    renderEnemies(ctx, combat.enemies);
    renderPopups(ctx, combat);
  } else {
    // Exploration rendering
    renderReachable(ctx, party, tileMap);

    const hover = getHoverTile();
    renderPathPreview(ctx, party, tileMap, hover.col, hover.row);

    // Hover tile highlight
    if (party.turnPhase === "move") {
      const hx = hover.col * TILE_SIZE;
      const hy = hover.row * TILE_SIZE;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
      ctx.lineWidth = 2;
      ctx.strokeRect(hx + 1, hy + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    }

    renderParty(ctx, party);
    renderEnemies(ctx, enemies);
  }

  camera.reset(ctx);

  // HUD (screen coords)
  if (combat && combat.active) {
    renderCombatHUD(ctx, combat, CANVAS_W, CANVAS_H);
  } else {
    ctx.fillStyle = "#ccc";
    ctx.font = "14px monospace";
    ctx.fillText(
      `Party: (${party.col}, ${party.row})  Moves: ${party.movePointsLeft}/${party.movePointsPerTurn}`,
      8,
      18,
    );
    ctx.fillText("Click to move — Space = end turn — R = regenerate", 8, 36);

    renderPartyHUD(ctx, party, CANVAS_W);
  }

  // HUD message (always visible)
  if (hudMessage && !combat) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(CANVAS_W / 2 - 160, CANVAS_H - 50, 320, 30);
    ctx.fillStyle = "#ffd700";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(hudMessage, CANVAS_W / 2, CANVAS_H - 30);
    ctx.textAlign = "left";
  }

  requestAnimationFrame(frame);
}

// Kick off
requestAnimationFrame((t) => {
  lastTime = t;
  frame(t);
});
