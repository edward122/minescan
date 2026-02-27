export const Blocks = {
    AIR: 0,
    DIRT: 1,
    GRASS: 2,
    STONE: 3,
    WOOD: 4,
    LEAVES: 5,
    SAND: 6,
    GLASS: 7,
    WATER: 8,
    OAK_PLANKS: 9,
    COBBLESTONE: 10,
    COAL_ORE: 11,
    IRON_ORE: 12,
    GOLD_ORE: 13,
    DIAMOND_ORE: 14,

    STICK: 15,
    CRAFTING_TABLE: 16,
    FURNACE: 17,
    CHEST: 18,
    TORCH: 19,

    WOOD_PICKAXE: 20, WOOD_AXE: 21, WOOD_SHOVEL: 22, WOOD_SWORD: 23,
    STONE_PICKAXE: 24, STONE_AXE: 25, STONE_SHOVEL: 26, STONE_SWORD: 27,
    IRON_PICKAXE: 28, IRON_AXE: 29, IRON_SHOVEL: 30, IRON_SWORD: 31,
    GOLD_PICKAXE: 32, GOLD_AXE: 33, GOLD_SHOVEL: 34, GOLD_SWORD: 35,
    DIAMOND_PICKAXE: 36, DIAMOND_AXE: 37, DIAMOND_SHOVEL: 38, DIAMOND_SWORD: 39,

    SNOW: 40,
    BEDROCK: 41,
    TALL_GRASS: 42,
    FLOWER_RED: 43,
    FLOWER_YELLOW: 44,

    RAW_PORKCHOP: 45,
    RAW_BEEF: 46,
    BREAD: 47,

    LAVA: 48,
    GRAVEL: 49,
    CLAY: 50,
    KELP: 51,
    LILY_PAD: 52,
    MOSSY_COBBLESTONE: 53,
    LANTERN: 54,
    CACTUS: 55,

    // Phase 1 — Proper smelting items
    COAL: 56,
    IRON_INGOT: 57,
    GOLD_INGOT: 58,
    DIAMOND: 59,
    COOKED_PORKCHOP: 60,
    COOKED_BEEF: 61,

    // Phase 1 — New building blocks
    BOOKSHELF: 62,
    TNT: 63,
    WOOL_WHITE: 64,
    WOOL_RED: 65,
    WOOL_BLUE: 66,
    WOOL_GREEN: 67,
    WOOL_YELLOW: 68,
    WOOL_BLACK: 69,

    // Phase 2 — Custom-shape blocks
    OAK_DOOR: 70,
    OAK_FENCE: 71,
    LADDER: 72,
    OAK_SLAB: 73,
    OAK_STAIRS: 74,
    SIGN: 75,
    TRAPDOOR: 76,
    BED: 77,
};

// Map face directory identifiers to standard names
// 0: left, 1: right, 2: bottom, 3: top, 4: back, 5: front
const faceNames = ['side', 'side', 'bottom', 'top', 'side', 'side'];

// Tool durability by material
const toolDurability = { wood: 60, stone: 132, iron: 251, gold: 33, diamond: 1562 };

export const BlockRegistry = {
    [Blocks.AIR]: { name: 'Air', transparent: true },
    [Blocks.DIRT]: { name: 'Dirt', hardness: 0.5, bestTool: 'shovel', textures: { all: [0, 0] } },
    [Blocks.GRASS]: { name: 'Grass', hardness: 0.6, bestTool: 'shovel', textures: { top: [1, 2], side: [1, 0], bottom: [1, 1] } },
    [Blocks.STONE]: { name: 'Stone', hardness: 1.5, bestTool: 'pickaxe', textures: { all: [2, 0] } },
    [Blocks.WOOD]: { name: 'Wood Log', hardness: 2.0, bestTool: 'axe', textures: { top: [3, 1], side: [3, 0], bottom: [3, 1] } },
    [Blocks.LEAVES]: { name: 'Leaves', hardness: 0.2, transparent: true, textures: { all: [4, 0] } },
    [Blocks.SAND]: { name: 'Sand', hardness: 0.5, bestTool: 'shovel', textures: { all: [5, 0] } },
    [Blocks.GLASS]: { name: 'Glass', hardness: 0.3, transparent: true, textures: { all: [6, 0] } },
    [Blocks.WATER]: { name: 'Water', transparent: true, isFluid: true, textures: { all: [7, 0] } },
    [Blocks.OAK_PLANKS]: { name: 'Oak Planks', hardness: 2.0, bestTool: 'axe', textures: { all: [8, 0] } },
    [Blocks.COBBLESTONE]: { name: 'Cobblestone', hardness: 2.0, bestTool: 'pickaxe', textures: { all: [9, 0] } },
    [Blocks.COAL_ORE]: { name: 'Coal Ore', hardness: 3.0, bestTool: 'pickaxe', textures: { all: [10, 0] } },
    [Blocks.IRON_ORE]: { name: 'Iron Ore', hardness: 3.0, bestTool: 'pickaxe', textures: { all: [11, 0] } },
    [Blocks.GOLD_ORE]: { name: 'Gold Ore', hardness: 3.0, bestTool: 'pickaxe', textures: { all: [12, 0] } },
    [Blocks.DIAMOND_ORE]: { name: 'Diamond Ore', hardness: 3.0, bestTool: 'pickaxe', textures: { all: [13, 0] } },

    [Blocks.STICK]: { name: 'Stick', textures: { all: [0, 0] } },
    [Blocks.CRAFTING_TABLE]: { name: 'Crafting Table', hardness: 2.5, bestTool: 'axe', textures: { top: [8, 0], side: [4, 0], bottom: [8, 0] } },
    [Blocks.FURNACE]: { name: 'Furnace', hardness: 3.5, bestTool: 'pickaxe', textures: { front: [9, 0], side: [9, 0], top: [9, 0], bottom: [9, 0] } },
    [Blocks.CHEST]: { name: 'Chest', hardness: 2.5, bestTool: 'axe', textures: { all: [8, 0] } },
    [Blocks.TORCH]: { name: 'Torch', hardness: 0.0, transparent: true, noCollision: true, crossShape: true, emitLight: 15, textures: { all: [2, 1] } },

    // Tools — now with durability
    [Blocks.WOOD_PICKAXE]: { name: 'Wooden Pickaxe', toolType: 'pickaxe', toolTier: 1, attackDamage: 2, maxDurability: toolDurability.wood, textures: { all: [0, 6] } },
    [Blocks.WOOD_AXE]: { name: 'Wooden Axe', toolType: 'axe', toolTier: 1, attackDamage: 3, maxDurability: toolDurability.wood, textures: { all: [1, 6] } },
    [Blocks.WOOD_SHOVEL]: { name: 'Wooden Shovel', toolType: 'shovel', toolTier: 1, attackDamage: 1, maxDurability: toolDurability.wood, textures: { all: [2, 6] } },
    [Blocks.WOOD_SWORD]: { name: 'Wooden Sword', toolType: 'sword', toolTier: 1, attackDamage: 4, maxDurability: toolDurability.wood, textures: { all: [3, 6] } },
    [Blocks.STONE_PICKAXE]: { name: 'Stone Pickaxe', toolType: 'pickaxe', toolTier: 2, attackDamage: 3, maxDurability: toolDurability.stone, textures: { all: [0, 7] } },
    [Blocks.STONE_AXE]: { name: 'Stone Axe', toolType: 'axe', toolTier: 2, attackDamage: 4, maxDurability: toolDurability.stone, textures: { all: [1, 7] } },
    [Blocks.STONE_SHOVEL]: { name: 'Stone Shovel', toolType: 'shovel', toolTier: 2, attackDamage: 2, maxDurability: toolDurability.stone, textures: { all: [2, 7] } },
    [Blocks.STONE_SWORD]: { name: 'Stone Sword', toolType: 'sword', toolTier: 2, attackDamage: 5, maxDurability: toolDurability.stone, textures: { all: [3, 7] } },
    [Blocks.IRON_PICKAXE]: { name: 'Iron Pickaxe', toolType: 'pickaxe', toolTier: 3, attackDamage: 4, maxDurability: toolDurability.iron, textures: { all: [0, 8] } },
    [Blocks.IRON_AXE]: { name: 'Iron Axe', toolType: 'axe', toolTier: 3, attackDamage: 5, maxDurability: toolDurability.iron, textures: { all: [1, 8] } },
    [Blocks.IRON_SHOVEL]: { name: 'Iron Shovel', toolType: 'shovel', toolTier: 3, attackDamage: 3, maxDurability: toolDurability.iron, textures: { all: [2, 8] } },
    [Blocks.IRON_SWORD]: { name: 'Iron Sword', toolType: 'sword', toolTier: 3, attackDamage: 6, maxDurability: toolDurability.iron, textures: { all: [3, 8] } },
    [Blocks.GOLD_PICKAXE]: { name: 'Gold Pickaxe', toolType: 'pickaxe', toolTier: 2, attackDamage: 3, maxDurability: toolDurability.gold, textures: { all: [0, 9] } },
    [Blocks.GOLD_AXE]: { name: 'Gold Axe', toolType: 'axe', toolTier: 2, attackDamage: 4, maxDurability: toolDurability.gold, textures: { all: [1, 9] } },
    [Blocks.GOLD_SHOVEL]: { name: 'Gold Shovel', toolType: 'shovel', toolTier: 2, attackDamage: 2, maxDurability: toolDurability.gold, textures: { all: [2, 9] } },
    [Blocks.GOLD_SWORD]: { name: 'Gold Sword', toolType: 'sword', toolTier: 2, attackDamage: 5, maxDurability: toolDurability.gold, textures: { all: [3, 9] } },
    [Blocks.DIAMOND_PICKAXE]: { name: 'Diamond Pickaxe', toolType: 'pickaxe', toolTier: 4, attackDamage: 5, maxDurability: toolDurability.diamond, textures: { all: [0, 10] } },
    [Blocks.DIAMOND_AXE]: { name: 'Diamond Axe', toolType: 'axe', toolTier: 4, attackDamage: 6, maxDurability: toolDurability.diamond, textures: { all: [1, 10] } },
    [Blocks.DIAMOND_SHOVEL]: { name: 'Diamond Shovel', toolType: 'shovel', toolTier: 4, attackDamage: 4, maxDurability: toolDurability.diamond, textures: { all: [2, 10] } },
    [Blocks.DIAMOND_SWORD]: { name: 'Diamond Sword', toolType: 'sword', toolTier: 4, attackDamage: 7, maxDurability: toolDurability.diamond, textures: { all: [3, 10] } },

    [Blocks.SNOW]: { name: 'Snow', hardness: 0.2, bestTool: 'shovel', textures: { all: [14, 0] } },
    [Blocks.BEDROCK]: { name: 'Bedrock', hardness: -1, textures: { all: [15, 0] } },
    [Blocks.TALL_GRASS]: { name: 'Tall Grass', hardness: 0.0, transparent: true, noCollision: true, crossShape: true, textures: { all: [14, 1] } },
    [Blocks.FLOWER_RED]: { name: 'Red Flower', hardness: 0.0, transparent: true, noCollision: true, crossShape: true, textures: { all: [14, 2] } },
    [Blocks.FLOWER_YELLOW]: { name: 'Yellow Flower', hardness: 0.0, transparent: true, noCollision: true, crossShape: true, textures: { all: [15, 1] } },

    [Blocks.RAW_PORKCHOP]: { name: 'Raw Porkchop', foodRestore: 3, textures: { all: [0, 3] } },
    [Blocks.RAW_BEEF]: { name: 'Raw Beef', foodRestore: 3, textures: { all: [1, 3] } },
    [Blocks.BREAD]: { name: 'Bread', foodRestore: 5, textures: { all: [2, 3] } },

    [Blocks.LAVA]: { name: 'Lava', hardness: -1, transparent: true, isFluid: true, emitLight: 15, textures: { all: [3, 3] } },
    [Blocks.GRAVEL]: { name: 'Gravel', hardness: 0.6, bestTool: 'shovel', textures: { all: [4, 3] } },
    [Blocks.CLAY]: { name: 'Clay', hardness: 0.6, bestTool: 'shovel', textures: { all: [5, 3] } },
    [Blocks.KELP]: { name: 'Kelp', hardness: 0.0, transparent: true, noCollision: true, crossShape: true, textures: { all: [6, 3] } },
    [Blocks.LILY_PAD]: { name: 'Lily Pad', hardness: 0.0, transparent: true, noCollision: true, textures: { all: [7, 3] } },
    [Blocks.MOSSY_COBBLESTONE]: { name: 'Mossy Cobblestone', hardness: 2.0, bestTool: 'pickaxe', textures: { all: [8, 3] } },
    [Blocks.LANTERN]: { name: 'Lantern', hardness: 0.5, transparent: true, noCollision: false, emitLight: 15, textures: { all: [4, 1] } },
    [Blocks.CACTUS]: { name: 'Cactus', hardness: 0.4, transparent: true, textures: { top: [5, 1], side: [6, 1], bottom: [5, 1] } },

    // Phase 1 — Smelting result items (not placeable, inventory-only)
    [Blocks.COAL]: { name: 'Coal', textures: { all: [0, 4] } },
    [Blocks.IRON_INGOT]: { name: 'Iron Ingot', textures: { all: [1, 4] } },
    [Blocks.GOLD_INGOT]: { name: 'Gold Ingot', textures: { all: [2, 4] } },
    [Blocks.DIAMOND]: { name: 'Diamond', textures: { all: [3, 4] } },
    [Blocks.COOKED_PORKCHOP]: { name: 'Cooked Porkchop', foodRestore: 8, textures: { all: [4, 4] } },
    [Blocks.COOKED_BEEF]: { name: 'Cooked Beef', foodRestore: 8, textures: { all: [5, 4] } },

    // Phase 1 — New building blocks
    [Blocks.BOOKSHELF]: { name: 'Bookshelf', hardness: 1.5, bestTool: 'axe', textures: { top: [8, 0], side: [6, 4], bottom: [8, 0] } },
    [Blocks.TNT]: { name: 'TNT', hardness: 0.0, textures: { top: [8, 4], side: [7, 4], bottom: [8, 4] } },
    [Blocks.WOOL_WHITE]: { name: 'White Wool', hardness: 0.8, textures: { all: [9, 4] } },
    [Blocks.WOOL_RED]: { name: 'Red Wool', hardness: 0.8, textures: { all: [10, 4] } },
    [Blocks.WOOL_BLUE]: { name: 'Blue Wool', hardness: 0.8, textures: { all: [11, 4] } },
    [Blocks.WOOL_GREEN]: { name: 'Green Wool', hardness: 0.8, textures: { all: [12, 4] } },
    [Blocks.WOOL_YELLOW]: { name: 'Yellow Wool', hardness: 0.8, textures: { all: [13, 4] } },
    [Blocks.WOOL_BLACK]: { name: 'Black Wool', hardness: 0.8, textures: { all: [14, 4] } },

    // Phase 2 — Custom-shape blocks
    [Blocks.OAK_DOOR]: { name: 'Oak Door', hardness: 3.0, bestTool: 'axe', transparent: true, isDoor: true, textures: { all: [0, 11] } },
    [Blocks.OAK_FENCE]: { name: 'Oak Fence', hardness: 2.0, bestTool: 'axe', transparent: true, isFence: true, textures: { all: [1, 11] } },
    [Blocks.LADDER]: { name: 'Ladder', hardness: 0.4, bestTool: 'axe', transparent: true, noCollision: true, isLadder: true, climbable: true, textures: { all: [2, 11] } },
    [Blocks.OAK_SLAB]: { name: 'Oak Slab', hardness: 2.0, bestTool: 'axe', transparent: true, isSlab: true, halfBlock: true, textures: { all: [8, 0] } },
    [Blocks.OAK_STAIRS]: { name: 'Oak Stairs', hardness: 2.0, bestTool: 'axe', transparent: true, isStairs: true, textures: { all: [8, 0] } },
    [Blocks.SIGN]: { name: 'Sign', hardness: 1.0, bestTool: 'axe', transparent: true, noCollision: true, textures: { all: [3, 11] } },
    [Blocks.TRAPDOOR]: { name: 'Trapdoor', hardness: 3.0, bestTool: 'axe', transparent: true, isTrapdoor: true, textures: { all: [4, 11] } },
    [Blocks.BED]: { name: 'Bed', hardness: 0.2, transparent: true, isBed: true, textures: { top: [5, 11], side: [6, 11], bottom: [8, 0] } },
};

export function getBlockTextureCoords(voxel, faceIndex) {
    const blockDef = BlockRegistry[voxel];
    if (!blockDef || !blockDef.textures) return [0, 0];

    const faceName = faceNames[faceIndex];
    if (blockDef.textures[faceName]) {
        return blockDef.textures[faceName];
    }
    return blockDef.textures.all || [0, 0];
}

export function isBlockTransparent(voxel) {
    if (voxel === 0) return true;
    const blockDef = BlockRegistry[voxel];
    return blockDef ? !!blockDef.transparent : false;
}

export function isBlockNoCollision(voxel) {
    if (voxel === 0) return true;
    const blockDef = BlockRegistry[voxel];
    return blockDef ? !!blockDef.noCollision : false;
}

export function getBlockHardness(voxel) {
    const blockDef = BlockRegistry[voxel];
    if (!blockDef) return 1;
    if (blockDef.hardness === undefined) return 0;
    return blockDef.hardness;
}

export function getToolData(itemId) {
    const blockDef = BlockRegistry[itemId];
    if (!blockDef) return null;
    if (!blockDef.toolType) return null;
    return { type: blockDef.toolType, tier: blockDef.toolTier || 0, damage: blockDef.attackDamage || 1 };
}

export function getMaxDurability(itemId) {
    const blockDef = BlockRegistry[itemId];
    return blockDef ? blockDef.maxDurability || 0 : 0;
}
