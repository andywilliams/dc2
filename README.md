# DC2 — Dungeon Crawler

A turn-based dungeon crawler built with TypeScript and HTML Canvas. Explore 7 floors of procedurally generated dungeons with a 4-character party, fight enemies in tactical combat, collect loot, and defeat the Dungeon Lord to win.

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
| **Click tile** | Move party to target tile (during move phase) |
| `Space` | End turn |
| `E` | Descend stairs (when on exit stairs) |
| `R` | Regenerate dungeon |
| `I` | Toggle inventory panel |
| `1`–`4` | Select character in inventory |
| **Click item** | Equip item to selected character (inventory open) |

## Gameplay

### Exploration

You control a 4-character party navigating procedurally generated dungeons. Click a floor tile to move — reachable tiles are highlighted based on remaining move points. Press `Space` to end your turn, which also triggers enemy turns.

Each floor has entry stairs (where you spawn) and exit stairs. Press `E` on the exit stairs to descend to the next floor. The dungeon has **7 floors** total, with a boss encounter on the final floor. See [Floor Progression](#floor-progression) for details.

### The Party

Your party moves as a 2×2 group on the grid. Each character has base stats that can be boosted by equipment:

| Character | HP | ATK | DEF | Move | Color |
|-----------|---:|----:|----:|-----:|-------|
| Knight | 30 | 8 | 6 | 5 | Blue |
| Mage | 18 | 12 | 2 | 4 | Purple |
| Rogue | 22 | 10 | 3 | 7 | Green |
| Cleric | 24 | 5 | 5 | 4 | Gold |

The Party HUD (bottom-left) shows each character's HP bar and current move points.

### Combat

Combat triggers when the party enters an enemy's detection range. It resolves on the dungeon grid in two phases:

1. **Player phase** — Select a character → move → choose attack target
2. **Enemy phase** — Each enemy moves toward the nearest party member and attacks if in range

**Dice rolls** determine outcomes: a d20 hit check against the target's DEF, then damage calculated from ATK minus DEF with a random modifier. Effective stats (base + equipment bonuses) are used for all combat calculations.

### Enemies

Enemies spawn in dungeon rooms and scale in strength per floor (see [Floor Progression](#floor-progression)). Each type has distinct AI behavior:

| Type | HP | ATK | DEF | Move | Atk Range | Detection | Behavior |
|----------|---:|----:|----:|-----:|-----------:|----------:|----------|
| Skeleton | 14 | 6 | 3 | 3 | 1 | 5 | Balanced, direct chase |
| Slime | 24 | 4 | 5 | 2 | 1 | 4 | Slow, tanky |
| Bat | 8 | 5 | 1 | 6 | 1 | 7 | Fast, fragile |
| Goblin | 12 | 7 | 2 | 3 | 3 | 6 | Ranged, keeps distance |

Enemies are idle until the party enters their detection range, shown by a red aggro indicator.

#### The Dungeon Lord (Boss)

The final floor features the **Dungeon Lord** — a boss enemy that spawns in the last room. The boss is always aware of the party (no detection phase) and uses aggressive AI with extended range.

| Stat | Value |
|------|------:|
| HP | 80 |
| ATK | 12 |
| DEF | 6 |
| Move | 4 |
| Atk Range | 2 |
| Detection | 10 (always aggro) |

The boss appears as a larger sprite with a gold crown and a dark red aura. Defeating the Dungeon Lord on floor 7 triggers the victory screen.

### Loot & Inventory

Defeated enemies have a **50% chance** to drop an item. Treasure chests are placed in ~40% of dungeon rooms and open automatically when the party walks over them. Chests contain rarer loot than enemy drops.

**Item stats scale with floor depth** — deeper floors yield stronger gear (20% bonus per floor beyond the first). Move range bonuses are not scaled.

Press `I` to open the inventory panel. From there:

- Press `1`–`4` to select a character
- Click an item in the bag to equip it to the selected character
- Equipping an item to an occupied slot automatically unequips the current item back to the bag

#### Item Types

Items fall into three categories:

| Type | Description |
|-------------|------------------------------------------------------|
| **Weapon** | Equippable in the weapon slot. Primarily boosts ATK. |
| **Armor** | Equippable in the armour slot. Primarily boosts DEF. |
| **Consumable** | Single-use items like potions and elixirs. Heal HP or grant temporary stat buffs. |

#### Equipment Slots

Each character has three equipment slots:

| Slot | Effect |
|-----------|--------|
| **Weapon** | Primarily boosts ATK |
| **Armour** | Primarily boosts DEF |
| **Accessory** | Varied bonuses (move range, HP, ATK, or DEF) |

#### Rarity Tiers

Every item has a rarity that affects its drop frequency and stat scaling:

| Rarity | Color | Stat Multiplier | Drop Weight |
|------------|-----------|----------------:|------------:|
| Common | Grey | 1.0× | 1.0 |
| Uncommon | Green | 1.25× | 0.6 |
| Rare | Blue | 1.6× | 0.3 |
| Epic | Purple | 2.0× | 0.1 |

Higher rarity items have their base stats multiplied by the rarity's stat multiplier (except move range, which is never scaled). Drop weight controls how frequently each rarity appears — lower values mean rarer drops.

#### Item Registry

All items are defined in a central registry (`src/items.ts`). Each definition includes a unique key, base stat modifiers, rarity, and display properties. Runtime item instances are created from these definitions with rarity scaling applied.

| Item | Type | Slot | Base Stats | Rarity |
|-------------------------|------------|-----------|----------------|----------|
| Iron Sword | Weapon | Weapon | +2 ATK | Common |
| Steel Blade | Weapon | Weapon | +3 ATK | Uncommon |
| War Axe | Weapon | Weapon | +4 ATK, −1 DEF | Rare |
| Leather Vest | Armor | Armour | +1 DEF | Common |
| Chain Mail | Armor | Armour | +2 DEF | Uncommon |
| Dragon Scale | Armor | Armour | +4 DEF | Epic |
| Healing Potion | Consumable | — | Heals 15 HP | Common |
| Greater Healing Potion | Consumable | — | Heals 30 HP | Uncommon |
| Strength Elixir | Consumable | — | +3 ATK for 5 turns | Rare |

The inventory holds up to **20 items**. If the bag is full, new drops are lost.

## Floor Progression

The dungeon has **7 floors**. Each floor is a freshly generated dungeon with its own rooms, enemies, and loot.

### Descending

Stand on the exit stairs and press `E` to descend. Your party keeps its current HP and inventory but resets position to the new floor's spawn point. On the final floor, the exit stairs are blocked — you must defeat the Dungeon Lord to win.

### Difficulty Scaling

Both enemy stats and enemy count increase with depth:

- **Stat scaling** — All enemy HP, ATK, and DEF are multiplied by `1 + (floor − 1) × 0.15`. By floor 7, enemies have roughly **1.9×** their base stats.
- **Enemy count** — Rooms spawn 1–2 enemies on floor 1. The maximum increases by 1 for every 2 floors descended (up to 2–4 per room on deeper floors).

### Win & Lose Conditions

| Condition | Trigger | Screen |
|-----------|---------|--------|
| **Victory** | Defeat the Dungeon Lord on floor 7 | Gold starfield, survival stats, press `R` to replay |
| **Game Over** | All 4 party members reach 0 HP | Red vignette, floor reached, press `R` to retry |

The HUD displays your current floor as `Floor X/7` and marks the boss floor with a `(BOSS)` label.

## Procedural Dungeon Generation

Each floor is generated using a **Binary Space Partition (BSP)** algorithm:

1. **Split** — Recursively divide the map into leaf nodes
2. **Place rooms** — Create a randomly sized room in each leaf
3. **Carve corridors** — Connect sibling rooms through their parent nodes
4. **Place doors** — Add door tiles at room entrances
5. **Place stairs** — Entry stairs in the first room, exit stairs in the last

Press `R` to regenerate the dungeon with a new layout.

## Architecture

```
src/
├── main.ts          Game loop, state management, rendering, integration
├── input.ts         Keyboard + mouse input with per-frame buffering
├── camera.ts        Viewport that follows the party, clamped to world bounds
├── tilemap.ts       Tile grid storage, viewport-culled rendering
├── dungeon.ts       BSP dungeon generation (rooms, corridors, doors, stairs)
├── party.ts         Party characters, stats, formation, grid movement
├── pathfinding.ts   A* pathfinding and reachable-tile calculation
├── enemies.ts       Enemy types, spawning, AI behavior, detection
├── combat.ts        Turn-based combat state machine, dice rolls, animations
├── items.ts         Item data model: types, rarity tiers, stat modifiers, registry
└── loot.ts          Loot tables, chests, drop logic, equipment, inventory UI
```

### Game Loop

The game uses a `requestAnimationFrame` loop with delta-time capping (max 50ms per frame) to prevent large jumps after tab-switches or lag spikes.

Each frame runs three phases in order:
1. **Input** — flush buffered key/mouse events into current-frame state
2. **Update** — process movement, combat, enemy AI, and loot interactions
3. **Render** — draw map, entities, HUD, and inventory overlay

### Key Systems

- **Pathfinding** — A* algorithm calculates movement paths; BFS floods reachable tiles within move range for the highlight overlay
- **Camera** — Centers on the party and clamps to world boundaries; provides `screenToWorld` conversion for mouse clicks
- **Combat** — State machine with 9 phases covering selection, movement, attack animations, and enemy turns; resolves victory/game-over conditions on combat end
- **Floor progression** — 7-floor dungeon with stat scaling, boss spawn on final floor, and win/lose end screens
- **Items** — Pure data module defining item templates, rarity tiers, and stat modifiers; registry pattern with lookup functions (`getItemDef`, `getItemDefsByType`, `getItemDefsByRarity`)
- **Loot** — Weighted random drops with floor scaling; equipment modifies effective stats used in combat

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript | Type-safe game logic |
| Vite | Dev server with hot reload, production bundler |
| HTML Canvas 2D | All rendering |
