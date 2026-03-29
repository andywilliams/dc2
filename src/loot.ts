/**
 * Loot & inventory system: item definitions, loot tables, equipment,
 * chests, and inventory UI.
 */

import { TILE_SIZE } from "./tilemap";
import { Character } from "./party";

// ── Item types ─────────────────────────────────────────────────────────────

export type ItemSlot = "weapon" | "armour" | "accessory";

export interface StatModifiers {
  atk?: number;
  def?: number;
  maxHp?: number;
  moveRange?: number;
}

export interface Item {
  id: number;
  name: string;
  slot: ItemSlot;
  mods: StatModifiers;
  color: string;
  icon: string;
  /** Floor level the item dropped on (used for display). */
  tier: number;
}

let nextItemId = 1;

function createItem(
  name: string,
  slot: ItemSlot,
  mods: StatModifiers,
  color: string,
  icon: string,
  tier: number,
): Item {
  return { id: nextItemId++, name, slot, mods, color, icon, tier };
}

// ── Equipment on characters ─────────────────────────────────────────────────

export interface Equipment {
  weapon: Item | null;
  armour: Item | null;
  accessory: Item | null;
}

export function createEquipment(): Equipment {
  return { weapon: null, armour: null, accessory: null };
}

/** Get total stat bonus from equipped items. */
export function getEquipmentBonus(equip: Equipment): StatModifiers {
  const total: StatModifiers = { atk: 0, def: 0, maxHp: 0, moveRange: 0 };
  for (const slot of ["weapon", "armour", "accessory"] as ItemSlot[]) {
    const item = equip[slot];
    if (item) {
      total.atk! += item.mods.atk ?? 0;
      total.def! += item.mods.def ?? 0;
      total.maxHp! += item.mods.maxHp ?? 0;
      total.moveRange! += item.mods.moveRange ?? 0;
    }
  }
  return total;
}

/** Get effective stat value (base + equipment). */
export function getEffectiveStat(
  char: Character,
  stat: "atk" | "def" | "moveRange",
): number {
  const bonus = getEquipmentBonus(char.equipment);
  return char.stats[stat] + (bonus[stat] ?? 0);
}

export function getEffectiveMaxHp(char: Character): number {
  const bonus = getEquipmentBonus(char.equipment);
  return char.stats.maxHp + (bonus.maxHp ?? 0);
}

// ── Inventory ──────────────────────────────────────────────────────────────

export interface Inventory {
  items: Item[];
  maxSize: number;
}

export function createInventory(maxSize = 20): Inventory {
  return { items: [], maxSize };
}

export function addItem(inv: Inventory, item: Item): boolean {
  if (inv.items.length >= inv.maxSize) return false;
  inv.items.push(item);
  return true;
}

export function removeItem(inv: Inventory, itemId: number): Item | null {
  const idx = inv.items.findIndex((i) => i.id === itemId);
  if (idx < 0) return null;
  return inv.items.splice(idx, 1)[0];
}

export function equipItem(
  inv: Inventory,
  itemId: number,
  char: Character,
): boolean {
  const item = inv.items.find((i) => i.id === itemId);
  if (!item) return false;

  const slot = item.slot;
  const current = char.equipment[slot];

  // Unequip current item back to inventory
  if (current) {
    inv.items.push(current);
  }

  // Equip new item
  char.equipment[slot] = item;
  const idx = inv.items.indexOf(item);
  if (idx >= 0) inv.items.splice(idx, 1);

  // If equipping maxHp bonus, heal by the bonus amount
  if (item.mods.maxHp && item.mods.maxHp > 0) {
    char.stats.hp = Math.min(char.stats.hp + item.mods.maxHp, getEffectiveMaxHp(char));
  }

  return true;
}

export function unequipItem(
  inv: Inventory,
  slot: ItemSlot,
  char: Character,
): boolean {
  const item = char.equipment[slot];
  if (!item) return false;
  if (inv.items.length >= inv.maxSize) return false;

  char.equipment[slot] = null;
  inv.items.push(item);

  // Clamp HP to new effective max
  const newMax = getEffectiveMaxHp(char);
  if (char.stats.hp > newMax) char.stats.hp = newMax;

  return true;
}

// ── Loot tables ──────────────────────────────────────────────────────────────

interface LootEntry {
  name: string;
  slot: ItemSlot;
  mods: StatModifiers;
  color: string;
  icon: string;
  weight: number; // relative drop chance
}

const WEAPON_POOL: LootEntry[] = [
  { name: "Iron Sword", slot: "weapon", mods: { atk: 2 }, color: "#aab0bb", icon: "/", weight: 10 },
  { name: "Steel Blade", slot: "weapon", mods: { atk: 3 }, color: "#ccd0dd", icon: "/", weight: 6 },
  { name: "War Axe", slot: "weapon", mods: { atk: 4, def: -1 }, color: "#bb7744", icon: "P", weight: 4 },
  { name: "Magic Staff", slot: "weapon", mods: { atk: 3, maxHp: 5 }, color: "#9966cc", icon: "|", weight: 3 },
  { name: "Flame Dagger", slot: "weapon", mods: { atk: 5 }, color: "#ff6633", icon: "!", weight: 2 },
];

const ARMOUR_POOL: LootEntry[] = [
  { name: "Leather Vest", slot: "armour", mods: { def: 1 }, color: "#8b6914", icon: "T", weight: 10 },
  { name: "Chain Mail", slot: "armour", mods: { def: 2 }, color: "#999999", icon: "#", weight: 6 },
  { name: "Iron Plate", slot: "armour", mods: { def: 3, moveRange: -1 }, color: "#778899", icon: "H", weight: 4 },
  { name: "Mage Robe", slot: "armour", mods: { def: 1, maxHp: 8 }, color: "#4466aa", icon: "n", weight: 3 },
  { name: "Dragon Scale", slot: "armour", mods: { def: 4 }, color: "#cc3333", icon: "D", weight: 2 },
];

const ACCESSORY_POOL: LootEntry[] = [
  { name: "Speed Ring", slot: "accessory", mods: { moveRange: 1 }, color: "#44cccc", icon: "o", weight: 8 },
  { name: "Power Amulet", slot: "accessory", mods: { atk: 2 }, color: "#cc4444", icon: "v", weight: 6 },
  { name: "Shield Charm", slot: "accessory", mods: { def: 2 }, color: "#4488cc", icon: "v", weight: 6 },
  { name: "Life Pendant", slot: "accessory", mods: { maxHp: 10 }, color: "#44cc44", icon: "v", weight: 5 },
  { name: "Hero Medal", slot: "accessory", mods: { atk: 1, def: 1, maxHp: 5 }, color: "#ffcc00", icon: "*", weight: 2 },
];

const ALL_LOOT = [...WEAPON_POOL, ...ARMOUR_POOL, ...ACCESSORY_POOL];

function pickWeightedRandom(pool: LootEntry[]): LootEntry {
  const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return pool[pool.length - 1];
}

/** Scale item stats based on floor — higher floors give better loot. */
function scaleItemForFloor(mods: StatModifiers, floor: number): StatModifiers {
  if (floor <= 1) return { ...mods };
  const mult = 1 + (floor - 1) * 0.2;
  const scaled: StatModifiers = {};
  if (mods.atk) scaled.atk = Math.round(mods.atk * mult);
  if (mods.def) scaled.def = Math.round(mods.def * mult);
  if (mods.maxHp) scaled.maxHp = Math.round(mods.maxHp * mult);
  if (mods.moveRange) scaled.moveRange = mods.moveRange; // don't scale move range
  return scaled;
}

/** Generate a random loot drop. Returns null if nothing drops (50% chance). */
export function rollEnemyDrop(floor: number): Item | null {
  if (Math.random() > 0.5) return null; // 50% drop rate
  const entry = pickWeightedRandom(ALL_LOOT);
  const mods = scaleItemForFloor(entry.mods, floor);
  return createItem(entry.name, entry.slot, mods, entry.color, entry.icon, floor);
}

/** Generate chest loot — always drops, slightly better quality. */
export function rollChestLoot(floor: number): Item {
  // Chests favour rarer items: filter to lower weight entries
  const pool = ALL_LOOT.filter((e) => e.weight <= 6);
  const entry = pool.length > 0 ? pickWeightedRandom(pool) : pickWeightedRandom(ALL_LOOT);
  const mods = scaleItemForFloor(entry.mods, floor);
  const name = floor >= 3 ? `Fine ${entry.name}` : entry.name;
  return createItem(name, entry.slot, mods, entry.color, entry.icon, floor);
}

// ── Chests (world entities) ────────────────────────────────────────────────

export interface Chest {
  id: number;
  col: number;
  row: number;
  opened: boolean;
  item: Item;
}

let nextChestId = 1;

export function createChest(col: number, row: number, item: Item): Chest {
  return { id: nextChestId++, col, row, opened: false, item };
}

export function renderChests(
  ctx: CanvasRenderingContext2D,
  chests: Chest[],
): void {
  for (const chest of chests) {
    if (chest.opened) continue;
    const px = chest.col * TILE_SIZE;
    const py = chest.row * TILE_SIZE;

    // Chest body
    ctx.fillStyle = "#8b6914";
    ctx.fillRect(px + 6, py + 10, 20, 14);

    // Chest lid
    ctx.fillStyle = "#b8860b";
    ctx.fillRect(px + 5, py + 7, 22, 6);

    // Metal band
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(px + 14, py + 8, 4, 3);

    // Lock
    ctx.fillStyle = "#ffd700";
    ctx.fillRect(px + 14, py + 14, 4, 4);
  }
}

// ── Inventory UI ────────────────────────────────────────────────────────────

export interface InventoryUI {
  open: boolean;
  selectedCharIdx: number;
  selectedItemIdx: number;
  scrollOffset: number;
}

export function createInventoryUI(): InventoryUI {
  return { open: false, selectedCharIdx: 0, selectedItemIdx: -1, scrollOffset: 0 };
}

/** Format stat modifiers as a readable string. */
function formatMods(mods: StatModifiers): string {
  const parts: string[] = [];
  if (mods.atk) parts.push(`${mods.atk > 0 ? "+" : ""}${mods.atk} ATK`);
  if (mods.def) parts.push(`${mods.def > 0 ? "+" : ""}${mods.def} DEF`);
  if (mods.maxHp) parts.push(`${mods.maxHp > 0 ? "+" : ""}${mods.maxHp} HP`);
  if (mods.moveRange) parts.push(`${mods.moveRange > 0 ? "+" : ""}${mods.moveRange} MOV`);
  return parts.join(" ");
}

/** Render the inventory panel. */
export function renderInventoryUI(
  ctx: CanvasRenderingContext2D,
  inv: Inventory,
  characters: Character[],
  ui: InventoryUI,
  canvasW: number,
  canvasH: number,
): void {
  if (!ui.open) return;

  const panelW = 520;
  const panelH = 400;
  const panelX = (canvasW - panelW) / 2;
  const panelY = (canvasH - panelH) / 2;

  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.92)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "#ffd700";
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  // Title
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 14px monospace";
  ctx.fillText("INVENTORY", panelX + 10, panelY + 20);
  ctx.fillStyle = "#888";
  ctx.font = "10px monospace";
  ctx.fillText(`${inv.items.length}/${inv.maxSize} items — [I] close — [1-4] select char — click item to equip`, panelX + 110, panelY + 20);

  // Character equipment panel (left side)
  const charX = panelX + 10;
  let charY = panelY + 36;

  for (let ci = 0; ci < characters.length; ci++) {
    const char = characters[ci];
    const isSelected = ci === ui.selectedCharIdx;
    const rowH = 70;

    // Highlight selected character
    if (isSelected) {
      ctx.fillStyle = "rgba(255, 215, 0, 0.1)";
      ctx.fillRect(charX, charY, 240, rowH);
      ctx.strokeStyle = "#ffd700";
      ctx.lineWidth = 1;
      ctx.strokeRect(charX, charY, 240, rowH);
    }

    // Character name and stats
    ctx.fillStyle = isSelected ? char.color : "#888";
    ctx.font = "bold 11px monospace";
    ctx.fillText(`[${ci + 1}] ${char.name}`, charX + 4, charY + 14);

    const bonus = getEquipmentBonus(char.equipment);
    ctx.fillStyle = "#aaa";
    ctx.font = "9px monospace";
    ctx.fillText(
      `ATK:${char.stats.atk}${bonus.atk ? "+" + bonus.atk : ""} DEF:${char.stats.def}${bonus.def ? "+" + bonus.def : ""} HP:${char.stats.hp}/${getEffectiveMaxHp(char)}`,
      charX + 4,
      charY + 28,
    );

    // Equipment slots
    const slots: ItemSlot[] = ["weapon", "armour", "accessory"];
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const item = char.equipment[slot];
      const slotY = charY + 34 + si * 12;
      ctx.fillStyle = "#666";
      ctx.font = "9px monospace";
      ctx.fillText(`${slot}:`, charX + 8, slotY + 8);
      if (item) {
        ctx.fillStyle = item.color;
        ctx.fillText(`${item.icon} ${item.name} (${formatMods(item.mods)})`, charX + 70, slotY + 8);
      } else {
        ctx.fillStyle = "#444";
        ctx.fillText("— empty —", charX + 70, slotY + 8);
      }
    }

    charY += rowH + 4;
  }

  // Item list (right side)
  const listX = panelX + 260;
  const listY = panelY + 36;
  const listW = 250;
  const listH = panelH - 46;
  const itemRowH = 20;
  const maxVisible = Math.floor(listH / itemRowH);

  ctx.fillStyle = "rgba(30, 30, 40, 0.8)";
  ctx.fillRect(listX, listY, listW, listH);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 1;
  ctx.strokeRect(listX, listY, listW, listH);

  ctx.fillStyle = "#aaa";
  ctx.font = "bold 10px monospace";
  ctx.fillText("Bag", listX + 4, listY + 14);

  if (inv.items.length === 0) {
    ctx.fillStyle = "#555";
    ctx.font = "10px monospace";
    ctx.fillText("No items yet", listX + 4, listY + 32);
  }

  const startIdx = ui.scrollOffset;
  const endIdx = Math.min(inv.items.length, startIdx + maxVisible - 1);

  for (let i = startIdx; i < endIdx; i++) {
    const item = inv.items[i];
    const iy = listY + 20 + (i - startIdx) * itemRowH;
    const isSelected = i === ui.selectedItemIdx;

    if (isSelected) {
      ctx.fillStyle = "rgba(255, 215, 0, 0.15)";
      ctx.fillRect(listX + 1, iy, listW - 2, itemRowH);
    }

    // Item icon and name
    ctx.fillStyle = item.color;
    ctx.font = "10px monospace";
    ctx.fillText(`${item.icon} ${item.name}`, listX + 4, iy + 14);

    // Stats
    ctx.fillStyle = "#888";
    ctx.font = "9px monospace";
    ctx.fillText(formatMods(item.mods), listX + 140, iy + 14);

    // Slot type
    ctx.fillStyle = "#555";
    ctx.fillText(`[${item.slot}]`, listX + listW - 56, iy + 14);
  }
}

/** Handle click on inventory UI. Returns true if click was consumed. */
export function handleInventoryClick(
  ui: InventoryUI,
  inv: Inventory,
  characters: Character[],
  mouseX: number,
  mouseY: number,
  canvasW: number,
  canvasH: number,
): boolean {
  if (!ui.open) return false;

  const panelW = 520;
  const panelH = 400;
  const panelX = (canvasW - panelW) / 2;
  const panelY = (canvasH - panelH) / 2;

  // Outside panel — ignore
  if (mouseX < panelX || mouseX > panelX + panelW || mouseY < panelY || mouseY > panelY + panelH) {
    return true; // consume click to prevent game actions while inventory open
  }

  // Character selection (left panel)
  const charX = panelX + 10;
  let charY = panelY + 36;
  for (let ci = 0; ci < characters.length; ci++) {
    const rowH = 70;
    if (mouseX >= charX && mouseX <= charX + 240 && mouseY >= charY && mouseY <= charY + rowH) {
      ui.selectedCharIdx = ci;
      return true;
    }
    charY += rowH + 4;
  }

  // Item list click (right panel)
  const listX = panelX + 260;
  const listY = panelY + 36;
  const listW = 250;
  const itemRowH = 20;

  if (mouseX >= listX && mouseX <= listX + listW && mouseY >= listY + 20) {
    const relY = mouseY - (listY + 20);
    const idx = ui.scrollOffset + Math.floor(relY / itemRowH);
    if (idx >= 0 && idx < inv.items.length) {
      // Equip the item to selected character
      const char = characters[ui.selectedCharIdx];
      if (char) {
        equipItem(inv, inv.items[idx].id, char);
      }
      return true;
    }
  }

  return true;
}
