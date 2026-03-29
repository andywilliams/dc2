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

You control a player (light blue square) navigating a tile-based dungeon. The map is a 40x30 grid of 32px tiles with floor and wall types. Walls block movement — the player slides along them rather than stopping dead.

Clicking a tile logs its grid coordinates to the console (placeholder for future interaction like attacking, opening doors, or inspecting objects).

## Architecture

```
src/
├── main.ts      Game loop, player state, rendering
├── input.ts     Keyboard + mouse input with per-frame buffering
├── camera.ts    Viewport that follows the player, clamped to world bounds
└── tilemap.ts   Tile grid storage, viewport-culled rendering, demo map generator
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

Tiles are stored in a flat array indexed by `row * cols + col`. Only tiles within the camera viewport are drawn each frame (viewport culling). Out-of-bounds lookups return `TILE_WALL` to prevent the player from escaping the map.

The demo map generator creates border walls and scatters ~12% random interior walls for testing.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript | Type-safe game logic |
| Vite | Dev server with hot reload, production bundler |
| HTML Canvas 2D | All rendering |
