import { Input } from "./input";
import { Camera } from "./camera";
import { TileMap, TILE_SIZE, TILE_WALL, generateDemoMap } from "./tilemap";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_W = 800;
const CANVAS_H = 600;
const MAP_COLS = 40;
const MAP_ROWS = 30;
const PLAYER_SPEED = 160; // px / sec

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext("2d")!;

const input = new Input(canvas);
const tileMap: TileMap = generateDemoMap(MAP_COLS, MAP_ROWS);
const camera = new Camera(CANVAS_W, CANVAS_H, tileMap.widthPx, tileMap.heightPx);

// Player state — starts in the centre-ish of the map
const player = {
  x: 5 * TILE_SIZE + TILE_SIZE / 2,
  y: 5 * TILE_SIZE + TILE_SIZE / 2,
  size: 20,
};

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
    if (map.get(col, row) === TILE_WALL) return false;
  }
  return true;
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

  // Mouse click movement
  if (input.mouse.clicked) {
    const world = camera.screenToWorld(input.mouse.x, input.mouse.y);
    const col = Math.floor(world.x / TILE_SIZE);
    const row = Math.floor(world.y / TILE_SIZE);
    // Log clicked tile (placeholder for future interaction)
    console.log(`Clicked tile (${col}, ${row})`);
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
  ctx.fillText(`pos: (${Math.round(player.x)}, ${Math.round(player.y)})`, 8, 18);
  ctx.fillText("WASD / Arrows to move — Click to inspect tile", 8, 36);

  requestAnimationFrame(frame);
}

// Kick off
requestAnimationFrame((t) => {
  lastTime = t;
  frame(t);
});
