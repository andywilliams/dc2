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
| Left click (tile) | Move party to tile (exploration) / Select unit, move, or attack (combat) |
| Right click | Skip move or skip attack (combat) |
| `Space` | End turn (exploration) |
| `R` | Regenerate dungeon |

### Combat Controls

When combat begins, the game switches to a tactical turn-based mode. Here's the key thing to understand: each party member acts individually during your turn.

| Step | Action |
|------|--------|
| 1. Select | Click a party member with a yellow outline (available to act) |
| 2. Move | Click a highlighted blue tile to move, or right-click to skip movement |
| 3. Attack | Click a red-highlighted enemy in range, or right-click to skip |
| 4. Repeat | Select the next party member until all have acted |

Once all party members act, enemies take their turn automatically.

## Gameplay

You control a 4-character party navigating procedurally generated dungeons. The dungeon is a 50×40 grid of 32×32 px tiles generated using a BSP algorithm. Each room may contain enemies — entering combat range triggers a turn-based battle.

### Combat

Combat resolves directly on the dungeon grid (no separate battle screen). Think of it this way: the dungeon *is* the battlefield.

**Turn structure:**
1. **Player phase** — Select each party member, move them, and choose an attack target
2. **Enemy phase** — All enemies act sequentially (move toward party, attack if in range)
3. Repeat until one side is eliminated

**Dice rolls & damage:**

| Mechanic | Formula |
|----------|---------|
| Hit check | d20 roll — hit on 6+ (75% base hit rate) |
| Damage | ATK × roll modifier (0.55–1.5) − DEF/2, minimum 1 |
| Miss | d20 roll < 6 — no damage dealt |

Roll results are displayed as floating damage popups and in the combat message bar at the bottom of the screen.

**Attack ranges:**

| Class | Range (tiles) | Style |
|-------|---------------|-------|
| Knight | 1 | Melee |
| Rogue | 1 | Melee |
| Mage | 2 | Ranged |
| Cleric | 2 | Ranged |

### Enemies

Enemies spawn in dungeon rooms (1–2 per room, skipping the starting room). Four enemy types appear with varying stats:

| Enemy | HP | ATK | DEF | Move | Range | Icon |
|-------|----|-----|-----|------|-------|------|
| Rat | 6 | 3 | 1 | 5 | 1 | `r` |
| Goblin | 12 | 5 | 2 | 4 | 1 | `G` |
| Skeleton | 16 | 7 | 3 | 3 | 1 | `S` |
| Archer | 10 | 8 | 1 | 3 | 3 | `A` |

**Enemy AI:** Each enemy moves toward the closest party member, preferring tiles that allow an immediate attack. If already in range, they skip movement and attack directly.

### Combat HUD

During combat, the screen displays:
- **Top bar** — Turn number and current phase (PLAYER TURN / ENEMY TURN)
- **Right panel** — Party status with HP bars and acted/available indicators
- **Bottom bar** — Combat messages showing dice rolls, damage, hits, and misses
- **Overlays** — Blue tiles for movement range, red tiles for attack range, floating damage/miss popups
- **End screen** — Victory or Defeat banner when combat resolves

## Architecture

```
src/
├── main.ts         Game loop, state management, rendering pipeline
├── input.ts        Keyboard + mouse input with per-frame buffering
├── camera.ts       Viewport that follows the party, clamped to world bounds
├── tilemap.ts      Tile grid storage, viewport-culled rendering
├── dungeon.ts      BSP procedural dungeon generation
├── party.ts        Party members, stats, formation, click-to-move pathfinding
├── pathfinding.ts  A* pathfinding and reachable-tile calculation
├── combat.ts       Turn-based combat state machine, dice rolls, player actions
└── enemies.ts      Enemy types, spawning, AI planning, movement, rendering
```

### Game Loop

The game uses a `requestAnimationFrame` loop with delta-time capping (max 50ms per frame) to prevent large jumps after tab-switches or lag spikes.

Each frame runs three phases in order:
1. **Input** — flush buffered key/mouse events into current-frame state
2. **Update** — move party or advance combat state (animation, AI turns, damage resolution)
3. **Render** — clear canvas, draw visible tiles, draw party/enemies, draw HUD overlays

### Combat State Machine

Combat uses a phase-based state machine that drives the entire flow:

```
player_select → player_move → player_animating → player_attack → attack_anim
                                                                      ↓
                enemy_turn → enemy_animating → enemy_attack_anim → [loop]
                                                                      ↓
                                                              combat_over
```

Each phase handles its own input, animation, and transition logic. The `updateCombat` function processes one phase per frame, keeping the game responsive during AI turns and animations.

### Camera

The camera centers on the party and clamps to world boundaries so you never see outside the map. It provides `screenToWorld` conversion for translating mouse clicks into tile coordinates.

### Tile Map

Tiles are stored in a flat array indexed by `row * cols + col`. Only tiles within the camera viewport are drawn each frame (viewport culling). Out-of-bounds lookups return `TILE_WALL` to prevent movement outside the map.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript | Type-safe game logic |
| Vite | Dev server with hot reload, production bundler |
| HTML Canvas 2D | All rendering |
