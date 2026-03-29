import { Input } from "./input";
import { Camera } from "./camera";
import { TileMap, TILE_SIZE, TILE_DOOR, TILE_STAIRS_DOWN } from "./tilemap";
import { generateDungeon } from "./dungeon";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 600;
const PLAYER_SPEED = 160; // px / sec

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

// Player state — starts at dungeon spawn point
const player = {
  x: spawnX * TILE_SIZE + TILE_SIZE / 2,
  y: spawnY * TILE_SIZE + TILE_SIZE / 2,
  size: 20,
};

/** Regenerate dungeon (press R to get a new layout). */
function regenerate(): void {
  const result = generateDungeon();
  tileMap = result.map;
  spawnX = result.spawnX;
  spawnY = result.spawnY;
  camera = new Camera(CANVAS_W, CANVAS_H, tileMap.widthPx, tileMap.heightPx);
  player.x = spawnX * TILE_SIZE + TILE_SIZE / 2;
  player.y = spawnY * TILE_SIZE + TILE_SIZE / 2;
  showHudMessage("New dungeon generated!");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function canMoveTo(px: number, py: number, half: number, map: TileMap): boolean {
  // Check four corners of the player's bounding box
  const offsets = [
    { x: -half, y: -half },
    { x: half - 1, y: -half },
    { x: -half, y: half - 1 },
    { x: half - 1, y: half - 1 },
  ];
  for (const o of offsets) {
    const col = Math.floor((px + o.x) / TILE_SIZE);
    const row = Math.floor((py + o.y) / TILE_SIZE);
    if (map.isSolid(col, row)) return false;
  }
  return true;
}

/** Get the tile the player is standing on. */
function playerTile(): { col: number; row: number } {
  return {
    col: Math.floor(player.x / TILE_SIZE),
    row: Math.floor(player.y / TILE_SIZE),
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
  let dx = 0;
  let dy = 0;
  if (input.isDown("ArrowLeft") || input.isDown("KeyA")) dx -= 1;
  if (input.isDown("ArrowRight") || input.isDown("KeyD")) dx += 1;
  if (input.isDown("ArrowUp") || input.isDown("KeyW")) dy -= 1;
  if (input.isDown("ArrowDown") || input.isDown("KeyS")) dy += 1;

  // Normalise diagonal movement
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
  }

  const half = player.size / 2;
  const newX = player.x + dx * PLAYER_SPEED * dt;
  const newY = player.y + dy * PLAYER_SPEED * dt;

  // Axis-separated collision so you can slide along walls
  if (canMoveTo(newX, player.y, half, tileMap)) player.x = newX;
  if (canMoveTo(player.x, newY, half, tileMap)) player.y = newY;

  // Regenerate dungeon on R press
  if (input.justPressed("KeyR")) {
    regenerate();
  }

  // Mouse click — inspect tile
  if (input.mouse.clicked) {
    const world = camera.screenToWorld(input.mouse.x, input.mouse.y);
    const col = Math.floor(world.x / TILE_SIZE);
    const row = Math.floor(world.y / TILE_SIZE);
    const cell = tileMap.getCell(col, row);
    if (cell?.meta?.label) {
      showHudMessage(cell.meta.label);
    }
  }

  // Check what tile the player is standing on
  const pt = playerTile();
  const standingOn = tileMap.getCell(pt.col, pt.row);

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

  camera.follow(player.x, player.y);

  // — Render ---------------------------------------------------------------
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  camera.apply(ctx);

  // Tiles
  tileMap.render(ctx, camera.x, camera.y, CANVAS_W, CANVAS_H);

  // Player
  ctx.fillStyle = "#4fc3f7";
  ctx.fillRect(player.x - half, player.y - half, player.size, player.size);
  ctx.strokeStyle = "#81d4fa";
  ctx.lineWidth = 2;
  ctx.strokeRect(player.x - half, player.y - half, player.size, player.size);

  camera.reset(ctx);

  // HUD
  ctx.fillStyle = "#ccc";
  ctx.font = "14px monospace";
  ctx.fillText(`pos: (${Math.round(player.x)}, ${Math.round(player.y)})  tile: (${pt.col}, ${pt.row})`, 8, 18);
  ctx.fillText("WASD / Arrows to move — Click to inspect — R to regenerate", 8, 36);

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
