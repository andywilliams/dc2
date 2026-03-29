# DC2 — Dungeon Crawler

A tile-based dungeon crawler built with TypeScript and HTML Canvas.

## Getting Started

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`). The game starts immediately — no loading screens, no menus.

### Build for Production

```bash
npm run build
npm run preview   # preview the production build locally
```

## Controls

| Input | Action |
|-------|--------|
| `WASD` / Arrow keys | Move player |
| Mouse click | Inspect tile at cursor position |

Diagonal movement is normalized so you won't move faster on diagonals.

## Gameplay

You control a player (light blue square) navigating a tile-based dungeon. The map is a 30x22 grid of 32px tiles with four tile types. Walls and locked doors block movement — the player slides along them rather than stopping dead.

Clicking a tile displays its label in the HUD (doors, stairs, etc.). Standing on stairs or doors shows an interaction hint at the bottom of the screen.

### Tile Types

| Tile | Appearance | Behavior |
|------|-----------|----------|
| Floor | Dark surface with subtle texture dots | Passable |
| Wall | Brick pattern with mortar lines | Blocks movement |
| Door | Wooden panel with colored handle (red = locked, gold = unlocked) | Locked doors block movement; unlocked doors are passable |
| Stairs Down | Descending steps with blue arrow indicator | Passable; shows interaction hint when stood on |

Each tile can carry optional **metadata** — labels for display, locked state for doors, and destination floor for stairs.

### Test Dungeon

The game loads a hardcoded 5-room test dungeon:

1. **Entry Hall** (top-left) — starting room
2. **Corridor** — horizontal passage connecting rooms 1 and 3
3. **Large Chamber** (top-right) — open room with decorative pillars and stairs down
4. **Side Room** (bottom-left) — accessible via vertical corridor, contains a second stairway
5. **Treasure Room** (bottom-right) — sealed behind a locked door

Rooms are connected by 4 doors (3 unlocked, 1 locked) and 2 stairways leading to level 2.

## Architecture

```
src/
├── main.ts      Game loop, player state, rendering
├── input.ts     Keyboard + mouse input with per-frame buffering
├── camera.ts    Viewport that follows the player, clamped to world bounds
└── tilemap.ts   Typed tile grid, per-tile metadata, viewport-culled rendering, test dungeon
```

### Game Loop

The game uses a `requestAnimationFrame` loop with delta-time capping (max 50ms per frame) to prevent large jumps after tab-switches or lag spikes.

Each frame runs three phases in order:
1. **Input** — flush buffered key/mouse events into current-frame state
2. **Update** — move player with wall collision (axis-separated so you can slide along walls)
3. **Render** — clear canvas, draw visible tiles, draw player, draw HUD

### Camera

The camera centers on the player and clamps to world boundaries so you never see outside the map. It provides `screenToWorld` conversion for translating mouse clicks into tile coordinates.

### Tile Map

Each tile is stored as a `TileCell` containing a type and optional metadata (`TileMeta`). Cells are held in a flat array indexed by `row * cols + col`. Only tiles within the camera viewport are drawn each frame (viewport culling). Out-of-bounds lookups return `TILE_WALL` to prevent the player from escaping the map.

Collision uses `isSolid()` — walls always block, locked doors block, and everything else is passable. Each tile type has its own renderer with distinct visuals (brick pattern for walls, wooden panel for doors, descending steps for stairs).

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript | Type-safe game logic |
| Vite | Dev server with hot reload, production bundler |
| HTML Canvas 2D | All rendering |
