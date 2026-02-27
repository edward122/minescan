import { Blocks } from '../world/BlockRegistry.js';

export const Recipes = [
    // 1. Oak Planks
    { type: 'shapeless', ingredients: [{ id: Blocks.WOOD, count: 1 }], result: { id: Blocks.OAK_PLANKS, count: 4 } },

    // 2. Sticks (Vertical)
    { type: 'shaped', pattern: [['A'], ['A']], keys: { 'A': Blocks.OAK_PLANKS }, result: { id: Blocks.STICK, count: 4 } },

    // 3. Crafting Table
    { type: 'shaped', pattern: [['A', 'A'], ['A', 'A']], keys: { 'A': Blocks.OAK_PLANKS }, result: { id: Blocks.CRAFTING_TABLE, count: 1 } },

    // 4. Torch (now uses coal instead of coal ore)
    { type: 'shaped', pattern: [['A'], ['B']], keys: { 'A': Blocks.COAL, 'B': Blocks.STICK }, result: { id: Blocks.TORCH, count: 4 } },
    // Legacy: also allow coal ore for torch
    { type: 'shaped', pattern: [['A'], ['B']], keys: { 'A': Blocks.COAL_ORE, 'B': Blocks.STICK }, result: { id: Blocks.TORCH, count: 4 } },

    // 5. Furnace
    { type: 'shaped', pattern: [['A', 'A', 'A'], ['A', ' ', 'A'], ['A', 'A', 'A']], keys: { 'A': Blocks.COBBLESTONE }, result: { id: Blocks.FURNACE, count: 1 } },

    // 6. Chest
    { type: 'shaped', pattern: [['A', 'A', 'A'], ['A', ' ', 'A'], ['A', 'A', 'A']], keys: { 'A': Blocks.OAK_PLANKS }, result: { id: Blocks.CHEST, count: 1 } },

    // 7. Bookshelf
    { type: 'shaped', pattern: [['A', 'A', 'A'], ['B', 'B', 'B'], ['A', 'A', 'A']], keys: { 'A': Blocks.OAK_PLANKS, 'B': Blocks.OAK_PLANKS }, result: { id: Blocks.BOOKSHELF, count: 1 } },

    // 8. TNT
    { type: 'shaped', pattern: [['A', 'B', 'A'], ['B', 'A', 'B'], ['A', 'B', 'A']], keys: { 'A': Blocks.SAND, 'B': Blocks.COAL }, result: { id: Blocks.TNT, count: 1 } },

    // 9. Door (6 planks)
    { type: 'shaped', pattern: [['A', 'A'], ['A', 'A'], ['A', 'A']], keys: { 'A': Blocks.OAK_PLANKS }, result: { id: Blocks.OAK_DOOR, count: 3 } },

    // 10. Fence (4 planks + 2 sticks)
    { type: 'shaped', pattern: [['A', 'B', 'A'], ['A', 'B', 'A']], keys: { 'A': Blocks.OAK_PLANKS, 'B': Blocks.STICK }, result: { id: Blocks.OAK_FENCE, count: 3 } },

    // 11. Ladder (7 sticks)
    { type: 'shaped', pattern: [['A', ' ', 'A'], ['A', 'A', 'A'], ['A', ' ', 'A']], keys: { 'A': Blocks.STICK }, result: { id: Blocks.LADDER, count: 3 } },

    // 12. Slab (3 planks)
    { type: 'shaped', pattern: [['A', 'A', 'A']], keys: { 'A': Blocks.OAK_PLANKS }, result: { id: Blocks.OAK_SLAB, count: 6 } },

    // 13. Stairs (6 planks)
    { type: 'shaped', pattern: [['A', ' ', ' '], ['A', 'A', ' '], ['A', 'A', 'A']], keys: { 'A': Blocks.OAK_PLANKS }, result: { id: Blocks.OAK_STAIRS, count: 4 } },

    // 14. Sign (6 planks + 1 stick)
    { type: 'shaped', pattern: [['A', 'A', 'A'], ['A', 'A', 'A'], [' ', 'B', ' ']], keys: { 'A': Blocks.OAK_PLANKS, 'B': Blocks.STICK }, result: { id: Blocks.SIGN, count: 3 } },

    // 15. Trapdoor (6 planks)
    { type: 'shaped', pattern: [['A', 'A', 'A'], ['A', 'A', 'A']], keys: { 'A': Blocks.OAK_PLANKS }, result: { id: Blocks.TRAPDOOR, count: 2 } },

    // 16. Bed (3 wool + 3 planks)
    { type: 'shaped', pattern: [['A', 'A', 'A'], ['B', 'B', 'B']], keys: { 'A': Blocks.WOOL_WHITE, 'B': Blocks.OAK_PLANKS }, result: { id: Blocks.BED, count: 1 } },
    // Also allow red wool
    { type: 'shaped', pattern: [['A', 'A', 'A'], ['B', 'B', 'B']], keys: { 'A': Blocks.WOOL_RED, 'B': Blocks.OAK_PLANKS }, result: { id: Blocks.BED, count: 1 } },
];

// Tools now use proper ingots/diamonds instead of ores
const materials = [
    { mat: Blocks.OAK_PLANKS, pref: 'WOOD' },
    { mat: Blocks.COBBLESTONE, pref: 'STONE' },
    { mat: Blocks.IRON_INGOT, pref: 'IRON' },
    { mat: Blocks.GOLD_INGOT, pref: 'GOLD' },
    { mat: Blocks.DIAMOND, pref: 'DIAMOND' }
];

materials.forEach(({ mat, pref }) => {
    // Pickaxe
    Recipes.push({ type: 'shaped', pattern: [['A', 'A', 'A'], [' ', 'B', ' '], [' ', 'B', ' ']], keys: { 'A': mat, 'B': Blocks.STICK }, result: { id: Blocks[`${pref}_PICKAXE`], count: 1 } });
    // Axe
    Recipes.push({ type: 'shaped', pattern: [['A', 'A'], ['A', 'B'], [' ', 'B']], keys: { 'A': mat, 'B': Blocks.STICK }, result: { id: Blocks[`${pref}_AXE`], count: 1 } });
    // Shovel
    Recipes.push({ type: 'shaped', pattern: [['A'], ['B'], ['B']], keys: { 'A': mat, 'B': Blocks.STICK }, result: { id: Blocks[`${pref}_SHOVEL`], count: 1 } });
    // Sword
    Recipes.push({ type: 'shaped', pattern: [['A'], ['A'], ['B']], keys: { 'A': mat, 'B': Blocks.STICK }, result: { id: Blocks[`${pref}_SWORD`], count: 1 } });
});

export class RecipeRegistry {
    static getCraftingResult(grid, gridWidth) {
        // grid is an array of items [ {id, count}, null, {id, count}, ... ]
        // gridWidth is 2 for 2x2, 3 for 3x3

        // First, crop the grid to the bounds of the actual items
        let minX = gridWidth, minY = gridWidth, maxX = -1, maxY = -1;
        let hasItems = false;

        const items = [];
        for (let i = 0; i < grid.length; i++) {
            if (grid[i]) {
                const row = Math.floor(i / gridWidth);
                const col = i % gridWidth;
                if (col < minX) minX = col;
                if (row < minY) minY = row;
                if (col > maxX) maxX = col;
                if (row > maxY) maxY = row;
                hasItems = true;
                items.push(grid[i].id);
            }
        }

        if (!hasItems) return null;

        const croppedWidth = maxX - minX + 1;
        const croppedHeight = maxY - minY + 1;

        // Check against recipes
        for (const recipe of Recipes) {
            if (recipe.type === 'shapeless') {
                // Count ingredients needed vs given
                const needed = {};
                for (const ing of recipe.ingredients) {
                    needed[ing.id] = (needed[ing.id] || 0) + ing.count;
                }
                const given = {};
                for (const id of items) {
                    given[id] = (given[id] || 0) + 1; // Each slot counts as 1 ingredient unit for shapeless
                }
                let match = true;
                if (Object.keys(needed).length !== Object.keys(given).length) match = false;
                for (const id in needed) {
                    if (needed[id] !== given[id]) match = false;
                }
                if (match) return { ...recipe.result }; // Return copy
            } else if (recipe.type === 'shaped') {
                const patH = recipe.pattern.length;
                const patW = recipe.pattern[0].length;

                // Only matches if it fits perfectly
                if (patW === croppedWidth && patH === croppedHeight) {
                    let match = true;
                    for (let r = 0; r < patH; r++) {
                        for (let c = 0; c < patW; c++) {
                            const expectedKey = recipe.pattern[r][c];
                            const expectedId = expectedKey === ' ' ? null : recipe.keys[expectedKey];

                            const gridIndex = ((minY + r) * gridWidth) + (minX + c);
                            const actualItem = grid[gridIndex];
                            const actualId = actualItem ? actualItem.id : null;

                            if (expectedId !== actualId) {
                                match = false;
                                break;
                            }
                        }
                        if (!match) break;
                    }
                    if (match) return { ...recipe.result };
                }
            }
        }

        return null;
    }

    static getSmeltingResult(inputId) {
        const smeltingRecipes = {
            [Blocks.COAL_ORE]: { id: Blocks.COAL, count: 1 },
            [Blocks.IRON_ORE]: { id: Blocks.IRON_INGOT, count: 1 },
            [Blocks.GOLD_ORE]: { id: Blocks.GOLD_INGOT, count: 1 },
            [Blocks.DIAMOND_ORE]: { id: Blocks.DIAMOND, count: 1 },
            [Blocks.SAND]: { id: Blocks.GLASS, count: 1 },
            [Blocks.COBBLESTONE]: { id: Blocks.STONE, count: 1 },
            [Blocks.RAW_PORKCHOP]: { id: Blocks.COOKED_PORKCHOP, count: 1 },
            [Blocks.RAW_BEEF]: { id: Blocks.COOKED_BEEF, count: 1 },
        };
        return smeltingRecipes[inputId] ? { ...smeltingRecipes[inputId] } : null;
    }

    static getFuelValue(fuelId) {
        const fuels = {
            [Blocks.WOOD]: 15,
            [Blocks.OAK_PLANKS]: 15,
            [Blocks.STICK]: 5,
            [Blocks.COAL]: 80,
            [Blocks.COAL_ORE]: 80, // Coal ore itself acts as coal for compat
            [Blocks.SAPLING]: 5,
            [Blocks.BOOKSHELF]: 15,
        };
        return fuels[fuelId] || 0;
    }
}
