import { Blocks, getMaxDurability } from '../world/BlockRegistry.js';
import { RecipeRegistry } from './RecipeRegistry.js';

export class Inventory {
    constructor() {
        // 0-8: Hotbar
        // 9-35: Main Inventory
        this.slots = new Array(36).fill(null);

        // 0-8: 3x3 Crafting Grid (2x2 uses indices 0,1,3,4)
        this.craftingGrid = new Array(9).fill(null);
        this.craftingResult = null;

        // Furnace slots
        this.furnaceInput = null;
        this.furnaceFuel = null;
        this.furnaceResult = null;

        // Furnace state
        this.fuelTime = 0;       // How long the current fuel lasts
        this.maxFuelTime = 0;    // For UI progress
        this.smeltProgress = 0;  // How far along the current item is (0 to 1)

        // Initialize starting items
        this.slots[0] = { id: Blocks.DIRT, count: 64 };
        this.slots[1] = { id: Blocks.STONE, count: 64 };
        this.slots[2] = { id: Blocks.WOOD, count: 64 };
        this.slots[3] = { id: Blocks.LEAVES, count: 64 };
        this.slots[4] = { id: Blocks.SAND, count: 64 };
        this.slots[5] = { id: Blocks.GLASS, count: 64 };
        this.slots[6] = { id: Blocks.WATER, count: 64 };
        this.slots[7] = { id: Blocks.DIAMOND_ORE, count: 64 };
        this.slots[8] = { id: Blocks.OAK_PLANKS, count: 64 };

        // Fill inventory interior a bit
        this.slots[9] = { id: Blocks.COAL_ORE, count: 64 };
        this.slots[10] = { id: Blocks.IRON_ORE, count: 64 };
        this.slots[11] = { id: Blocks.GOLD_ORE, count: 64 };

        this.activeHotbarIndex = 0;
    }

    // --- Main Inventory Methods ---
    getSlot(index) {
        return this.slots[index];
    }

    setSlot(index, item) {
        this.slots[index] = item;
    }

    swapSlots(indexA, indexB) {
        const temp = this.slots[indexA];
        this.slots[indexA] = this.slots[indexB];
        this.slots[indexB] = temp;
    }

    addCount(index, countToAdd) {
        const item = this.slots[index];
        if (!item) return countToAdd;
        item.count += countToAdd;
        if (item.count > 64) {
            const excess = item.count - 64;
            item.count = 64;
            return excess;
        }
        return 0;
    }

    // Hotbar specific
    getActiveItem() {
        return this.slots[this.activeHotbarIndex];
    }

    consumeActiveItem() {
        const item = this.slots[this.activeHotbarIndex];
        if (item) {
            item.count -= 1;
            if (item.count <= 0) {
                this.slots[this.activeHotbarIndex] = null;
            }
            return true;
        }
        return false;
    }

    // Damage the tool in the active hotbar slot. Returns true if tool broke.
    damageActiveTool() {
        const item = this.slots[this.activeHotbarIndex];
        if (!item) return false;
        const maxDur = getMaxDurability(item.id);
        if (maxDur <= 0) return false; // Not a tool

        // Initialize durability if not set
        if (item.durability === undefined) {
            item.durability = maxDur;
        }

        item.durability -= 1;
        if (item.durability <= 0) {
            this.slots[this.activeHotbarIndex] = null;
            return true; // Tool broke
        }
        return false;
    }

    // --- Crafting Methods ---
    getCraftingSlot(index) {
        return this.craftingGrid[index];
    }

    setCraftingSlot(index, item) {
        this.craftingGrid[index] = item;
        this.updateRecipe();
    }

    updateRecipe(is3x3 = false) {
        // The backing craftingGrid is always a 9-element array representing a 3x3 grid.
        // 2x2 crafting places items at indices 0, 1, 3, 4.
        this.craftingResult = RecipeRegistry.getCraftingResult(this.craftingGrid, 3);
    }

    consumeCraftingIngredients(is3x3 = false) {
        const size = is3x3 ? 9 : 4;
        // In 2x2 mode, we only check 0,1,3,4 but it's safe to loop through all if others are null
        for (let i = 0; i < size; i++) {
            if (this.craftingGrid[i]) {
                this.craftingGrid[i].count -= 1;
                if (this.craftingGrid[i].count <= 0) {
                    this.craftingGrid[i] = null;
                }
            }
        }
        this.updateRecipe(is3x3);
    }

    // --- Furnace Methods ---
    getFurnaceSlot(type) {
        if (type === 'input') return this.furnaceInput;
        if (type === 'fuel') return this.furnaceFuel;
        if (type === 'result') return this.furnaceResult;
        return null;
    }

    setFurnaceSlot(type, item) {
        if (type === 'input') this.furnaceInput = item;
        if (type === 'fuel') this.furnaceFuel = item;
        if (type === 'result') this.furnaceResult = item;
    }

    updateFurnace(dt) {
        // Furnace ticking logic
        // Only progress if there is an input and a valid recipe
        const recipe = this.furnaceInput ? RecipeRegistry.getSmeltingResult(this.furnaceInput.id) : null;
        const canSmelt = recipe && (!this.furnaceResult || (this.furnaceResult.id === recipe.id && this.furnaceResult.count < 64));

        if (this.fuelTime > 0) {
            this.fuelTime -= dt;
            if (this.fuelTime <= 0) this.fuelTime = 0;
        }

        if (canSmelt) {
            // Need fuel to continue smelting
            if (this.fuelTime <= 0 && this.furnaceFuel) {
                const heat = RecipeRegistry.getFuelValue(this.furnaceFuel.id);
                if (heat > 0) {
                    this.maxFuelTime = heat;
                    this.fuelTime = heat;
                    this.furnaceFuel.count -= 1;
                    if (this.furnaceFuel.count <= 0) this.furnaceFuel = null;
                }
            }

            if (this.fuelTime > 0) {
                this.smeltProgress += dt / 10.0; // 10 seconds to smelt an item
                if (this.smeltProgress >= 1.0) {
                    this.smeltProgress = 0;
                    this.furnaceInput.count -= 1;
                    if (this.furnaceInput.count <= 0) this.furnaceInput = null;

                    if (this.furnaceResult) {
                        this.furnaceResult.count += recipe.count || 1;
                    } else {
                        this.furnaceResult = { id: recipe.id, count: recipe.count || 1 };
                    }
                }
            } else {
                this.smeltProgress = 0; // Lost heat, lose progress
            }
        } else {
            this.smeltProgress = 0;
        }
    }
}
