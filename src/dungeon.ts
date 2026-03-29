/**
 * Procedural dungeon generation using Binary Space Partition (BSP).
 *
 * Generates connected dungeons with rooms, corridors, doors, and stairs.
 */

import { TileMap, TILE_FLOOR, TILE_WALL, TILE_DOOR, TILE_STAIRS_DOWN } from "./tilemap";

// ── Types ──────────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BSPNode {
  bounds: Rect;
  left?: BSPNode;
  right?: BSPNode;
  room?: Rect;
}

export interface DungeonConfig {
  cols?: number;
  rows?: number;
  minRoomSize?: number;
  maxRoomSize?: number;
  minLeafSize?: number;
  roomPadding?: number;
}

// ── RNG helper ─────────────────────────────────────────────────────────────

/** Random int in [min, max] inclusive. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── BSP tree ───────────────────────────────────────────────────────────────

const DEFAULT_MIN_LEAF = 8;

function splitBSP(node: BSPNode, minLeaf: number): void {
  // Already split
  if (node.left || node.right) return;

  const { bounds } = node;

  // Decide split direction: prefer splitting the longer axis
  let splitH: boolean;
  const ratio = bounds.w / bounds.h;
  if (ratio > 1.25) splitH = false;      // wide → split vertically
  else if (ratio < 0.75) splitH = true;   // tall → split horizontally
  else splitH = Math.random() < 0.5;

  const maxSize = (splitH ? bounds.h : bounds.w) - minLeaf;
  if (maxSize < minLeaf) return; // too small to split

  const split = randInt(minLeaf, maxSize);

  if (splitH) {
    node.left = { bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: split } };
    node.right = { bounds: { x: bounds.x, y: bounds.y + split, w: bounds.w, h: bounds.h - split } };
  } else {
    node.left = { bounds: { x: bounds.x, y: bounds.y, w: split, h: bounds.h } };
    node.right = { bounds: { x: bounds.x + split, y: bounds.y, w: bounds.w - split, h: bounds.h } };
  }

  // Recurse
  splitBSP(node.left, minLeaf);
  splitBSP(node.right, minLeaf);
}

/** Place a room inside each leaf node. */
function placeRooms(node: BSPNode, minRoom: number, maxRoom: number, padding: number): void {
  if (node.left) placeRooms(node.left, minRoom, maxRoom, padding);
  if (node.right) placeRooms(node.right, minRoom, maxRoom, padding);

  // Only leaves get rooms
  if (node.left || node.right) return;

  const b = node.bounds;
  const maxW = Math.min(maxRoom, b.w - padding * 2);
  const maxH = Math.min(maxRoom, b.h - padding * 2);
  if (maxW < minRoom || maxH < minRoom) return;

  const w = randInt(minRoom, maxW);
  const h = randInt(minRoom, maxH);
  const x = randInt(b.x + padding, b.x + b.w - w - padding);
  const y = randInt(b.y + padding, b.y + b.h - h - padding);

  node.room = { x, y, w, h };
}

/** Get the room center (or midpoint of children) for corridor routing. */
function getCenter(node: BSPNode): { cx: number; cy: number } | null {
  if (node.room) {
    return {
      cx: Math.floor(node.room.x + node.room.w / 2),
      cy: Math.floor(node.room.y + node.room.h / 2),
    };
  }
  if (node.left) return getCenter(node.left);
  if (node.right) return getCenter(node.right);
  return null;
}

// ── Map carving ────────────────────────────────────────────────────────────

function carveRect(map: TileMap, r: Rect): void {
  for (let row = r.y; row < r.y + r.h; row++) {
    for (let col = r.x; col < r.x + r.w; col++) {
      map.set(col, row, TILE_FLOOR);
    }
  }
}

function carveHTunnel(map: TileMap, x1: number, x2: number, y: number): void {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  for (let x = minX; x <= maxX; x++) {
    map.set(x, y, TILE_FLOOR);
  }
}

function carveVTunnel(map: TileMap, y1: number, y2: number, x: number): void {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  for (let y = minY; y <= maxY; y++) {
    map.set(x, y, TILE_FLOOR);
  }
}

/** Connect sibling nodes with an L-shaped corridor. */
function connectNodes(map: TileMap, node: BSPNode): void {
  if (node.left) connectNodes(map, node.left);
  if (node.right) connectNodes(map, node.right);

  if (node.left && node.right) {
    const a = getCenter(node.left);
    const b = getCenter(node.right);
    if (!a || !b) return;

    // L-shaped corridor: horizontal then vertical (or vice versa)
    if (Math.random() < 0.5) {
      carveHTunnel(map, a.cx, b.cx, a.cy);
      carveVTunnel(map, a.cy, b.cy, b.cx);
    } else {
      carveVTunnel(map, a.cy, b.cy, a.cx);
      carveHTunnel(map, a.cx, b.cx, b.cy);
    }
  }
}

/** Collect all rooms from the BSP tree. */
function collectRooms(node: BSPNode, out: Rect[]): void {
  if (node.room) out.push(node.room);
  if (node.left) collectRooms(node.left, out);
  if (node.right) collectRooms(node.right, out);
}

// ── Door placement ─────────────────────────────────────────────────────────

/**
 * Place doors at room entrances — tiles where a corridor meets a room edge.
 * A door candidate is a floor tile on the room perimeter that has wall neighbors
 * perpendicular to the corridor direction.
 */
function placeDoors(map: TileMap, rooms: Rect[]): void {
  for (const room of rooms) {
    // Check each tile along the room perimeter
    // Top and bottom edges
    for (let c = room.x; c < room.x + room.w; c++) {
      checkDoorCandidate(map, c, room.y - 1);     // above top edge
      checkDoorCandidate(map, c, room.y + room.h); // below bottom edge
    }
    // Left and right edges
    for (let r = room.y; r < room.y + room.h; r++) {
      checkDoorCandidate(map, room.x - 1, r);     // left of left edge
      checkDoorCandidate(map, room.x + room.w, r); // right of right edge
    }
  }
}

function checkDoorCandidate(map: TileMap, col: number, row: number): void {
  if (map.get(col, row) !== TILE_FLOOR) return;

  // Check for "doorway" pattern: floor with walls on opposing sides
  const wallAboveBelow = map.get(col - 1, row) === TILE_WALL && map.get(col + 1, row) === TILE_WALL;
  const wallLeftRight = map.get(col, row - 1) === TILE_WALL && map.get(col, row + 1) === TILE_WALL;

  if (wallAboveBelow || wallLeftRight) {
    // Verify corridor-side connects to floor (not dead-end wall)
    const hasFloorNeighbor =
      map.get(col - 1, row) === TILE_FLOOR ||
      map.get(col + 1, row) === TILE_FLOOR ||
      map.get(col, row - 1) === TILE_FLOOR ||
      map.get(col, row + 1) === TILE_FLOOR;

    if (hasFloorNeighbor) {
      map.set(col, row, TILE_DOOR, { label: "Door" });
    }
  }
}

// ── Stair placement ────────────────────────────────────────────────────────

function placeStairs(map: TileMap, rooms: Rect[]): void {
  if (rooms.length < 2) return;

  // Entry stairs in first room, exit stairs in last room (farthest apart)
  const entryRoom = rooms[0];
  const exitRoom = rooms[rooms.length - 1];

  // Place entry stairs (upper-left area of first room)
  const entryCol = entryRoom.x + 1;
  const entryRow = entryRoom.y + 1;
  map.set(entryCol, entryRow, TILE_STAIRS_DOWN, {
    label: "Stairs up (entry)",
    destination: -1,
  });

  // Place exit stairs (center of last room)
  const exitCol = Math.floor(exitRoom.x + exitRoom.w / 2);
  const exitRow = Math.floor(exitRoom.y + exitRoom.h / 2);
  map.set(exitCol, exitRow, TILE_STAIRS_DOWN, {
    label: "Stairs down",
    destination: 1,
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a procedural dungeon using BSP.
 * Returns the map and the spawn position (center of the first room).
 */
export interface DungeonRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function generateDungeon(config: DungeonConfig = {}): {
  map: TileMap;
  spawnX: number;
  spawnY: number;
  rooms: DungeonRoom[];
} {
  const cols = config.cols ?? 50;
  const rows = config.rows ?? 40;
  const minRoom = config.minRoomSize ?? 4;
  const maxRoom = config.maxRoomSize ?? 10;
  const minLeaf = config.minLeafSize ?? DEFAULT_MIN_LEAF;
  const padding = config.roomPadding ?? 1;

  const map = new TileMap(cols, rows);

  // Fill with walls
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      map.set(c, r, TILE_WALL);
    }
  }

  // Build BSP tree
  const root: BSPNode = { bounds: { x: 1, y: 1, w: cols - 2, h: rows - 2 } };
  splitBSP(root, minLeaf);

  // Place rooms in leaves
  placeRooms(root, minRoom, maxRoom, padding);

  // Carve rooms into the map
  const rooms: Rect[] = [];
  collectRooms(root, rooms);
  for (const room of rooms) {
    carveRect(map, room);
  }

  // Connect rooms with corridors
  connectNodes(map, root);

  // Place doors at room entrances
  placeDoors(map, rooms);

  // Place entry and exit stairs
  placeStairs(map, rooms);

  // Spawn in center of first room
  const spawn = rooms[0];
  const spawnX = Math.floor(spawn.x + spawn.w / 2);
  const spawnY = Math.floor(spawn.y + spawn.h / 2);

  return { map, spawnX, spawnY, rooms };
}
