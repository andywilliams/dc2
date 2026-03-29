/**
 * Item data model & definitions: types, rarity tiers, stat modifiers,
 * and the item registry. Pure data — no UI or rendering dependencies.
 */

// ── Item types ──────────────────────────────────────────────────────────────

export type ItemType = "weapon" | "armor" | "consumable";

export type ItemSlot = "weapon" | "armour" | "accessory";

// ── Rarity tiers ────────────────────────────────────────────────────────────

export type Rarity = "common" | "uncommon" | "rare" | "epic";

export interface RarityProperties {
  label: string;
  color: string;
  statMultiplier: number;
  /** Drop weight modifier — lower means rarer. */
  dropWeightFactor: number;
}

export const RARITY_TIERS: Record<Rarity, RarityProperties> = {
  common: {
    label: "Common",
    color: "#aaaaaa",
    statMultiplier: 1.0,
    dropWeightFactor: 1.0,
  },
  uncommon: {
    label: "Uncommon",
    color: "#44cc44",
    statMultiplier: 1.25,
    dropWeightFactor: 0.6,
  },
  rare: {
    label: "Rare",
    color: "#4488ff",
    statMultiplier: 1.6,
    dropWeightFactor: 0.3,
  },
  epic: {
    label: "Epic",
    color: "#cc44ff",
    statMultiplier: 2.0,
    dropWeightFactor: 0.1,
  },
};

/** Ordered list from most common to rarest, for iteration. */
export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic"];

// ── Stat modifiers ──────────────────────────────────────────────────────────

export interface StatModifiers {
  atk?: number;
  def?: number;
  maxHp?: number;
  moveRange?: number;
}

// ── Consumable effects ──────────────────────────────────────────────────────

export type ConsumableEffect =
  | { kind: "heal"; amount: number }
  | { kind: "buff"; stat: keyof StatModifiers; amount: number; turns: number };

// ── Item definition (template in the registry) ──────────────────────────────

export interface ItemDef {
  /** Unique string key for this item definition. */
  key: string;
  name: string;
  itemType: ItemType;
  /** Equipment slot — only meaningful for weapon/armor items. */
  slot: ItemSlot | null;
  baseMods: StatModifiers;
  rarity: Rarity;
  icon: string;
  /** Base color override; if not set, uses the rarity color. */
  color?: string;
  /** For consumables: what happens when used. */
  consumableEffect?: ConsumableEffect;
}

// ── Runtime item instance ───────────────────────────────────────────────────

export interface Item {
  id: number;
  defKey: string;
  name: string;
  itemType: ItemType;
  slot: ItemSlot;
  mods: StatModifiers;
  rarity: Rarity;
  color: string;
  icon: string;
  /** Floor level the item was obtained on. */
  tier: number;
  consumableEffect?: ConsumableEffect;
}

let nextItemId = 1;

/** Create a runtime item instance from a definition, applying rarity scaling and floor tier. */
export function createItemFromDef(def: ItemDef, tier: number): Item {
  const rarityProps = RARITY_TIERS[def.rarity];
  const scaledMods = applyRarityScaling(def.baseMods, rarityProps.statMultiplier);

  return {
    id: nextItemId++,
    defKey: def.key,
    name: def.name,
    itemType: def.itemType,
    slot: def.slot ?? "accessory", // consumables default to accessory slot for compatibility
    mods: scaledMods,
    rarity: def.rarity,
    color: def.color ?? rarityProps.color,
    icon: def.icon,
    tier,
    consumableEffect: def.consumableEffect,
  };
}

/** Create a raw item (for backward compatibility with existing loot table code). */
export function createItem(
  name: string,
  slot: ItemSlot,
  mods: StatModifiers,
  color: string,
  icon: string,
  tier: number,
  rarity: Rarity = "common",
  itemType: ItemType = "weapon",
): Item {
  return {
    id: nextItemId++,
    defKey: "",
    name,
    itemType,
    slot,
    mods,
    rarity,
    color,
    icon,
    tier,
  };
}

function applyRarityScaling(mods: StatModifiers, multiplier: number): StatModifiers {
  if (multiplier === 1.0) return { ...mods };
  const scaled: StatModifiers = {};
  if (mods.atk) scaled.atk = Math.round(mods.atk * multiplier);
  if (mods.def) scaled.def = Math.round(mods.def * multiplier);
  if (mods.maxHp) scaled.maxHp = Math.round(mods.maxHp * multiplier);
  if (mods.moveRange) scaled.moveRange = mods.moveRange; // never scale move range
  return scaled;
}

// ── Item registry ───────────────────────────────────────────────────────────

const ITEM_REGISTRY: Map<string, ItemDef> = new Map();

function register(def: ItemDef): ItemDef {
  ITEM_REGISTRY.set(def.key, def);
  return def;
}

// ── Weapons ─────────────────────────────────────────────────────────────────

export const IRON_SWORD = register({
  key: "iron_sword",
  name: "Iron Sword",
  itemType: "weapon",
  slot: "weapon",
  baseMods: { atk: 2 },
  rarity: "common",
  icon: "/",
  color: "#aab0bb",
});

export const STEEL_BLADE = register({
  key: "steel_blade",
  name: "Steel Blade",
  itemType: "weapon",
  slot: "weapon",
  baseMods: { atk: 3 },
  rarity: "uncommon",
  icon: "/",
  color: "#ccd0dd",
});

export const WAR_AXE = register({
  key: "war_axe",
  name: "War Axe",
  itemType: "weapon",
  slot: "weapon",
  baseMods: { atk: 4, def: -1 },
  rarity: "rare",
  icon: "P",
  color: "#bb7744",
});

// ── Armor ───────────────────────────────────────────────────────────────────

export const LEATHER_VEST = register({
  key: "leather_vest",
  name: "Leather Vest",
  itemType: "armor",
  slot: "armour",
  baseMods: { def: 1 },
  rarity: "common",
  icon: "T",
  color: "#8b6914",
});

export const CHAIN_MAIL = register({
  key: "chain_mail",
  name: "Chain Mail",
  itemType: "armor",
  slot: "armour",
  baseMods: { def: 2 },
  rarity: "uncommon",
  icon: "#",
  color: "#999999",
});

export const DRAGON_SCALE = register({
  key: "dragon_scale",
  name: "Dragon Scale",
  itemType: "armor",
  slot: "armour",
  baseMods: { def: 4 },
  rarity: "epic",
  icon: "D",
  color: "#cc3333",
});

// ── Consumables ─────────────────────────────────────────────────────────────

export const HEALING_POTION = register({
  key: "healing_potion",
  name: "Healing Potion",
  itemType: "consumable",
  slot: null,
  baseMods: {},
  rarity: "common",
  icon: "!",
  color: "#ff4466",
  consumableEffect: { kind: "heal", amount: 15 },
});

export const GREATER_HEALING_POTION = register({
  key: "greater_healing_potion",
  name: "Greater Healing Potion",
  itemType: "consumable",
  slot: null,
  baseMods: {},
  rarity: "uncommon",
  icon: "!",
  color: "#ff6688",
  consumableEffect: { kind: "heal", amount: 30 },
});

export const STRENGTH_ELIXIR = register({
  key: "strength_elixir",
  name: "Strength Elixir",
  itemType: "consumable",
  slot: null,
  baseMods: {},
  rarity: "rare",
  icon: "!",
  color: "#ff8844",
  consumableEffect: { kind: "buff", stat: "atk", amount: 3, turns: 5 },
});

// ── Registry access ─────────────────────────────────────────────────────────

/** Get an item definition by key. */
export function getItemDef(key: string): ItemDef | undefined {
  return ITEM_REGISTRY.get(key);
}

/** Get all registered item definitions. */
export function getAllItemDefs(): ItemDef[] {
  return Array.from(ITEM_REGISTRY.values());
}

/** Get item definitions filtered by type. */
export function getItemDefsByType(itemType: ItemType): ItemDef[] {
  return getAllItemDefs().filter((d) => d.itemType === itemType);
}

/** Get item definitions filtered by rarity. */
export function getItemDefsByRarity(rarity: Rarity): ItemDef[] {
  return getAllItemDefs().filter((d) => d.rarity === rarity);
}
