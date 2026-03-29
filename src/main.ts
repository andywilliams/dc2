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
  spawnBoss,
  renderEnemies,
  getEnemiesInRange,
  updateAggro,
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
import {
  Inventory,
  Chest,
  InventoryUI,
  createInventory,
  createInventoryUI,
  addItem,
  rollEnemyDrop,
  rollChestLoot,
  createChest,
  renderChests,
  renderInventoryUI,
  handleInventoryClick,
} from "./loot";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 600;
const COMBAT_TRIGGER_RANGE = 3; // tiles from party to trigger combat
const MAX_FLOOR = 7;

type GameScreen = "playing" | "game_over" | "victory";

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

// Floor tracking
let currentFloor = 1;
let gameScreen: GameScreen = "playing";

// Enemy state
let enemies: Enemy[] = spawnEnemies(rooms, tileMap, [spawnX], [spawnY], currentFloor);

// Combat state
let combat: CombatState | null = null;

// Loot & inventory
let inventory: Inventory = createInventory();
let chests: Chest[] = spawnChests(rooms, [spawnX], [spawnY], currentFloor);
let inventoryUI: InventoryUI = createInventoryUI();

/** Spawn chests in dungeon rooms (skip first room = spawn room). */
function spawnChests(
  dungeonRooms: typeof rooms,
  occupiedCols: number[],
  occupiedRows: number[],
  floor: number,
): Chest[] {
  const result: Chest[] = [];
  const occupied = new Set<string>();
  for (let i = 0; i < occupiedCols.length; i++) {
    occupied.add(`${occupiedCols[i]},${occupiedRows[i]}`);
  }

  // ~40% of non-spawn rooms get a chest
  for (let ri = 1; ri < dungeonRooms.length; ri++) {
    if (Math.random() > 0.4) continue;
    const room = dungeonRooms[ri];
    // Place in a random interior tile
    for (let attempt = 0; attempt < 10; attempt++) {
      const col = room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2));
      const row = room.y + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2));
      const key = `${col},${row}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        result.push(createChest(col, row, rollChestLoot(floor)));
        break;
      }
    }
  }
  return result;
}

/** Regenerate dungeon (press R to get a new layout / restart game). */
function regenerate(): void {
  currentFloor = 1;
  gameScreen = "playing";
  const result = generateDungeon();
  tileMap = result.map;
  spawnX = result.spawnX;
  spawnY = result.spawnY;
  rooms = result.rooms;
  camera = new Camera(CANVAS_W, CANVAS_H, tileMap.widthPx, tileMap.heightPx);
  party = createPartyState(spawnX, spawnY);
  enemies = spawnEnemies(rooms, tileMap, [spawnX], [spawnY], currentFloor);
  combat = null;
  inventory = createInventory();
  chests = spawnChests(rooms, [spawnX], [spawnY], currentFloor);
  inventoryUI = createInventoryUI();
  showHudMessage("New dungeon generated!");
}

/** Check if current floor is a boss floor. */
function isBossFloor(floor: number): boolean {
  return floor === MAX_FLOOR;
}

/** Descend to the next floor. */
function descendFloor(): void {
  if (currentFloor >= MAX_FLOOR) {
    // Can't descend past the final floor
    return;
  }

  currentFloor++;
  const result = generateDungeon();
  tileMap = result.map;
  spawnX = result.spawnX;
  spawnY = result.spawnY;
  rooms = result.rooms;
  camera = new Camera(CANVAS_W, CANVAS_H, tileMap.widthPx, tileMap.heightPx);

  // Keep party HP but reset position
  party.col = spawnX;
  party.row = spawnY;
  party.px = spawnX * TILE_SIZE + TILE_SIZE / 2;
  party.py = spawnY * TILE_SIZE + TILE_SIZE / 2;
  party.turnPhase = "move";
  party.reachableTiles = null;
  party.movePointsLeft = party.movePointsPerTurn;

  enemies = spawnEnemies(rooms, tileMap, [spawnX], [spawnY], currentFloor);

  // Spawn boss on final floor
  if (isBossFloor(currentFloor)) {
    const boss = spawnBoss(rooms, tileMap, currentFloor);
    if (boss) enemies.push(boss);
    showHudMessage(`Floor ${currentFloor} — The Dungeon Lord awaits!`, 4);
  } else {
    showHudMessage(`Descended to Floor ${currentFloor}!`, 3);
  }

  chests = spawnChests(rooms, [spawnX], [spawnY], currentFloor);
  combat = null;
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

  // Check for total party wipe → game over
  if (!combat.victory) {
    const anyAlive = party.members.some((m) => m.stats.hp > 0);
    if (!anyAlive) {
      gameScreen = "game_over";
      combat = null;
      return;
    }
  }

  // Roll loot drops from defeated enemies
  if (combat.victory) {
    // Check if boss was defeated on the final floor → victory!
    const bossDefeated = combat.enemies.some((e) => e.type === "boss" && !e.alive);
    if (bossDefeated && isBossFloor(currentFloor)) {
      combat = null;
      gameScreen = "victory";
      return;
    }

    for (const ce of combat.enemies) {
      if (!ce.alive) {
        const drop = rollEnemyDrop(currentFloor);
        if (drop) {
          if (addItem(inventory, drop)) {
            showHudMessage(`Loot: ${drop.name} (${drop.mods.atk ? "+" + drop.mods.atk + " ATK" : ""}${drop.mods.def ? "+" + drop.mods.def + " DEF" : ""})`, 3);
          } else {
            showHudMessage("Inventory full! Item lost.", 3);
          }
        }
      }
    }
  }

  combat = null;
  // Resume exploration
  party.turnPhase = "move";
  party.reachableTiles = null;
}

// ---------------------------------------------------------------------------
// End screens
// ---------------------------------------------------------------------------

function renderEndScreen(ctx: CanvasRenderingContext2D, screen: GameScreen): void {
  // Dark background
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (screen === "victory") {
    // Starfield-like sparkles
    for (let i = 0; i < 50; i++) {
      const sx = ((i * 137 + 29) % CANVAS_W);
      const sy = ((i * 89 + 47) % CANVAS_H);
      const brightness = 0.3 + (i % 5) * 0.15;
      ctx.fillStyle = `rgba(255, 215, 0, ${brightness})`;
      ctx.fillRect(sx, sy, 2, 2);
    }

    // Title
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 36px monospace";
    ctx.textAlign = "center";
    ctx.fillText("VICTORY!", CANVAS_W / 2, CANVAS_H / 2 - 60);

    // Subtitle
    ctx.fillStyle = "#88cc88";
    ctx.font = "18px monospace";
    ctx.fillText("The Dungeon Lord has been vanquished!", CANVAS_W / 2, CANVAS_H / 2 - 20);

    // Stats
    ctx.fillStyle = "#ccc";
    ctx.font = "14px monospace";
    ctx.fillText(`Cleared ${MAX_FLOOR} floors`, CANVAS_W / 2, CANVAS_H / 2 + 20);
    const surviving = party.members.filter((m) => m.stats.hp > 0).length;
    ctx.fillText(`${surviving}/${party.members.length} party members survived`, CANVAS_W / 2, CANVAS_H / 2 + 44);

    // Restart prompt
    ctx.fillStyle = "#aaa";
    ctx.font = "14px monospace";
    ctx.fillText("Press R to play again", CANVAS_W / 2, CANVAS_H / 2 + 90);
  } else {
    // Game over
    // Red vignette effect
    const gradient = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H / 2, 50,
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_W / 2,
    );
    gradient.addColorStop(0, "rgba(80, 0, 0, 0.3)");
    gradient.addColorStop(1, "rgba(30, 0, 0, 0.8)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Title
    ctx.fillStyle = "#cc2222";
    ctx.font = "bold 36px monospace";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", CANVAS_W / 2, CANVAS_H / 2 - 60);

    // Subtitle
    ctx.fillStyle = "#aa6666";
    ctx.font = "18px monospace";
    ctx.fillText("The party has fallen...", CANVAS_W / 2, CANVAS_H / 2 - 20);

    // Stats
    ctx.fillStyle = "#888";
    ctx.font = "14px monospace";
    ctx.fillText(`Reached Floor ${currentFloor}/${MAX_FLOOR}`, CANVAS_W / 2, CANVAS_H / 2 + 20);

    // Restart prompt
    ctx.fillStyle = "#aaa";
    ctx.font = "14px monospace";
    ctx.fillText("Press R to try again", CANVAS_W / 2, CANVAS_H / 2 + 70);
  }

  ctx.textAlign = "left";
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

  // — Game Over / Victory screens ------------------------------------------
  if (gameScreen === "game_over" || gameScreen === "victory") {
    if (input.justPressed("KeyR")) {
      regenerate();
    }

    // Render end screen
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    renderEndScreen(ctx, gameScreen);
    requestAnimationFrame(frame);
    return;
  }

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

    // Toggle inventory on I press
    if (input.justPressed("KeyI")) {
      inventoryUI.open = !inventoryUI.open;
    }

    // Character selection in inventory: 1-4 keys
    if (inventoryUI.open) {
      if (input.justPressed("Digit1")) inventoryUI.selectedCharIdx = 0;
      if (input.justPressed("Digit2")) inventoryUI.selectedCharIdx = 1;
      if (input.justPressed("Digit3")) inventoryUI.selectedCharIdx = 2;
      if (input.justPressed("Digit4")) inventoryUI.selectedCharIdx = 3;
    }

    // Handle clicks — inventory UI consumes clicks when open
    if (input.mouse.clicked && inventoryUI.open) {
      handleInventoryClick(inventoryUI, inventory, party.members, input.mouse.x, input.mouse.y, CANVAS_W, CANVAS_H);
    }

    // Regenerate dungeon on R press
    if (input.justPressed("KeyR") && !inventoryUI.open) {
      regenerate();
    }

    // End turn on Space press
    if (input.justPressed("Space") && party.turnPhase === "move" && !inventoryUI.open) {
      endTurn(party);
      cacheReachable(party, tileMap);
      showHudMessage("New turn!");
    }

    // Click to move (only when inventory is closed)
    if (input.mouse.clicked && party.turnPhase === "move" && !inventoryUI.open) {
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

    // Check for chest interaction at party position
    for (const chest of chests) {
      if (!chest.opened && chest.col === party.col && chest.row === party.row) {
        chest.opened = true;
        if (addItem(inventory, chest.item)) {
          showHudMessage(`Opened chest: ${chest.item.name}!`, 3);
        } else {
          showHudMessage("Chest opened but inventory full!", 3);
        }
      }
    }

    // Update enemy aggro based on party proximity
    updateAggro(enemies, party.col, party.row);

    // Check for combat trigger after movement
    if (party.turnPhase === "move") {
      checkCombatTrigger();
    }

    // Check what tile the party is standing on
    const standingOn = tileMap.getCell(party.col, party.row);

    // Tile interaction hints and stair descent
    if (standingOn?.type === TILE_STAIRS_DOWN) {
      if (currentFloor >= MAX_FLOOR) {
        hudMessage = `Floor ${currentFloor}/${MAX_FLOOR} — Defeat the Dungeon Lord to escape!`;
      } else {
        hudMessage = `Floor ${currentFloor}/${MAX_FLOOR} — [${standingOn.meta?.label ?? "Stairs down"}] — press E to descend`;
        if (input.justPressed("KeyE")) {
          descendFloor();
        }
      }
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

    renderChests(ctx, chests);
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
    const floorLabel = isBossFloor(currentFloor) ? `Floor ${currentFloor}/${MAX_FLOOR} (BOSS)` : `Floor ${currentFloor}/${MAX_FLOOR}`;
    ctx.fillText(
      `${floorLabel} — Party: (${party.col}, ${party.row})  Moves: ${party.movePointsLeft}/${party.movePointsPerTurn}`,
      8,
      18,
    );
    ctx.fillText("Click to move — Space = end turn — E = descend — I = inventory — R = restart", 8, 36);

    renderPartyHUD(ctx, party, CANVAS_W);
  }

  // Inventory UI (screen coords, on top of everything)
  if (!combat) {
    renderInventoryUI(ctx, inventory, party.members, inventoryUI, CANVAS_W, CANVAS_H);
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
