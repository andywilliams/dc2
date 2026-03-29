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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 600;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext("2d")!;

const input = new Input(canvas);

// Generate a procedural dungeon
let { map: tileMap, spawnX, spawnY } = generateDungeon();
let camera = new Camera(CANVAS_W, CANVAS_H, tileMap.widthPx, tileMap.heightPx);

// Party state — starts at dungeon spawn point
let party: PartyState = createPartyState(spawnX, spawnY);

/** Regenerate dungeon (press R to get a new layout). */
function regenerate(): void {
  const result = generateDungeon();
  tileMap = result.map;
  spawnX = result.spawnX;
  spawnY = result.spawnY;
  camera = new Camera(CANVAS_W, CANVAS_H, tileMap.widthPx, tileMap.heightPx);
  party = createPartyState(spawnX, spawnY);
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

  // Movement range overlay
  renderReachable(ctx, party, tileMap);

  // Path preview on hover
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

  // Party sprites
  renderParty(ctx, party);

  camera.reset(ctx);

  // HUD — top-left info
  ctx.fillStyle = "#ccc";
  ctx.font = "14px monospace";
  ctx.fillText(
    `Party: (${party.col}, ${party.row})  Moves: ${party.movePointsLeft}/${party.movePointsPerTurn}`,
    8,
    18,
  );
  ctx.fillText("Click to move — Space = end turn — R = regenerate", 8, 36);

  // Party stats HUD
  renderPartyHUD(ctx, party, CANVAS_W);

  // HUD message
  if (hudMessage) {
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
