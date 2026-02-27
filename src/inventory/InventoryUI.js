import * as THREE from 'three';
import { BlockRegistry } from '../world/BlockRegistry.js';
import { Recipes } from './RecipeRegistry.js';

export class InventoryUI {
    constructor(inventory, inputManager) {
        this.inventory = inventory;
        this.inputManager = inputManager;
        this.uiManager = null; // Set externally from main.js

        this.mode = 'player'; // 'player', 'table', 'furnace'

        // DOM Elements
        this.uiLayer = document.getElementById('ui-layer');
        this.inventoryScreen = document.getElementById('inventory-screen');
        this.inventoryTitle = document.getElementById('inventory-title');

        // New UI Components
        this.playerPreviewPanel = document.getElementById('player-preview-panel');
        this.playerPreviewContainer = document.getElementById('player-preview-canvas-container');
        this.recipeBookBtn = document.getElementById('btn-toggle-recipe-book');
        this.recipeBookPanel = document.getElementById('recipe-book-panel');
        this.recipeSearch = document.getElementById('recipe-search');
        this.recipeList = document.getElementById('recipe-list');

        // Containers
        this.hotbarContainer = document.getElementById('hotbar');
        this.mainGridContainer = document.getElementById('inventory-grid');
        this.inventoryHotbarContainer = document.getElementById('inventory-hotbar');

        // Panels
        this.playerCraftingPanel = document.getElementById('player-crafting-panel');
        this.tableCraftingPanel = document.getElementById('table-crafting-panel');
        this.furnacePanel = document.getElementById('furnace-panel');

        // Crafting Grids
        this.playerCraftingGrid = document.getElementById('player-crafting-grid');
        this.tableCraftingGrid = document.getElementById('table-crafting-grid');
        this.playerCraftingResult = document.getElementById('player-crafting-result');
        this.tableCraftingResult = document.getElementById('table-crafting-result');

        // Furnace Slots
        this.furnaceInputSlot = document.getElementById('furnace-input');
        this.furnaceFuelSlot = document.getElementById('furnace-fuel');
        this.furnaceResultSlot = document.getElementById('furnace-result');
        this.furnaceProgressFg = document.getElementById('furnace-progress-fg');
        this.furnaceFireFg = document.getElementById('furnace-fire-fg');

        this.tooltip = document.getElementById('item-tooltip');

        this.isOpen = false;

        // Drag state
        this.draggedType = null; // 'inventory', 'crafting', 'result', 'furnace_input', 'furnace_fuel', 'furnace_result'
        this.draggedIndex = null;
        this.draggedItem = null;
        this.dragElement = null;

        this.hoveredType = null;
        this.hoveredIndex = null;

        // Preview state
        this.previewPitch = 0;
        this.previewYaw = 0;
        this.isPreviewDragging = false;
        this.previewLastP = { x: 0, y: 0 };

        this.initDOM();
        this.initPreview3D();
        this.initRecipeBook();
        this.setupEventListeners();
        this.render();
    }

    initDOM() {
        // HUD Hotbar
        for (let i = 0; i < 9; i++) {
            this.hotbarContainer.appendChild(this.createSlotElement('inventory', i));
        }

        // Main inventory
        for (let i = 9; i < 36; i++) {
            this.mainGridContainer.appendChild(this.createSlotElement('inventory', i));
        }

        // Screen Hotbar
        for (let i = 0; i < 9; i++) {
            this.inventoryHotbarContainer.appendChild(this.createSlotElement('inventory', i, true));
        }

        // Player Crafting 2x2
        for (let i = 0; i < 4; i++) {
            this.playerCraftingGrid.appendChild(this.createSlotElement('crafting_2x2', i));
        }
        this.setupSlotElement(this.playerCraftingResult, 'result_2x2', 0);

        // Table Crafting 3x3
        for (let i = 0; i < 9; i++) {
            this.tableCraftingGrid.appendChild(this.createSlotElement('crafting_3x3', i));
        }
        this.setupSlotElement(this.tableCraftingResult, 'result_3x3', 0);

        // Furnace
        this.setupSlotElement(this.furnaceInputSlot, 'furnace_input', 0);
        this.setupSlotElement(this.furnaceFuelSlot, 'furnace_fuel', 0);
        this.setupSlotElement(this.furnaceResultSlot, 'furnace_result', 0);
    }

    setupSlotElement(slot, type, index) {
        slot.dataset.type = type;
        slot.dataset.index = index;

        const icon = document.createElement('div');
        icon.className = 'item-icon';
        const count = document.createElement('div');
        count.className = 'item-count';

        slot.appendChild(icon);
        slot.appendChild(count);

        slot.addEventListener('mousedown', (e) => this.onSlotMouseDown(e, type, index));
        slot.addEventListener('mouseenter', (e) => this.onSlotMouseEnter(e, type, index));
        slot.addEventListener('mouseleave', (e) => this.onSlotMouseLeave(e));
    }

    createSlotElement(type, index, isScreenHotbar = false) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        if (isScreenHotbar) slot.dataset.isScreenHotbar = 'true';
        this.setupSlotElement(slot, type, index);
        return slot;
    }

    initPreview3D() {
        this.previewScene = new THREE.Scene();
        this.previewScene.background = new THREE.Color('#333');

        this.previewCamera = new THREE.PerspectiveCamera(50, 90 / 120, 0.1, 10);
        this.previewCamera.position.set(0, 1.2, 3);

        this.previewRenderer = new THREE.WebGLRenderer({ antialias: false });
        this.previewRenderer.setSize(90, 120);
        this.playerPreviewContainer.appendChild(this.previewRenderer.domElement);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(2, 5, 3);
        this.previewScene.add(dirLight);
        this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.5));

        // Player Mesh
        this.previewPlayerGroup = new THREE.Group();

        const bodyGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3366cc });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 1.0;
        this.previewPlayerGroup.add(body);

        const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.6;
        this.previewPlayerGroup.add(head);

        const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
        const armMat = new THREE.MeshLambertMaterial({ color: 0x3366cc });
        const la = new THREE.Mesh(armGeo, armMat); la.position.set(-0.4, 1.0, 0);
        const ra = new THREE.Mesh(armGeo, armMat); ra.position.set(0.4, 1.0, 0);
        this.previewPlayerGroup.add(la, ra);

        const legGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
        const legMat = new THREE.MeshLambertMaterial({ color: 0x333366 });
        const ll = new THREE.Mesh(legGeo, legMat); ll.position.set(-0.1, 0.35, 0);
        const rl = new THREE.Mesh(legGeo, legMat); rl.position.set(0.1, 0.35, 0);
        this.previewPlayerGroup.add(ll, rl);

        this.previewPlayerGroup.position.y = -0.5;
        this.previewScene.add(this.previewPlayerGroup);

        this.playerPreviewContainer.addEventListener('mousedown', (e) => {
            this.isPreviewDragging = true;
            this.previewLastP = { x: e.clientX, y: e.clientY };
        });

        this.animatePreview = () => {
            if (this.isOpen && this.mode === 'player') {
                this.previewRenderer.render(this.previewScene, this.previewCamera);
            }
            requestAnimationFrame(this.animatePreview);
        };
        this.animatePreview();
    }

    initRecipeBook() {
        this.recipeElements = [];
        this.recipeBookBtn.addEventListener('click', () => {
            this.recipeBookPanel.classList.toggle('hidden');
        });
        this.recipeSearch.addEventListener('input', () => this.populateRecipeList());
    }

    canCraftRecipe(recipe) {
        let availableCounts = {};
        for (let i = 0; i < 36; i++) {
            const item = this.inventory.slots[i];
            if (item) availableCounts[item.id] = (availableCounts[item.id] || 0) + item.count;
        }
        const craftSize = this.mode === 'player' ? 4 : 9;
        const craftType = this.mode === 'player' ? 'crafting_2x2' : 'crafting_3x3';
        for (let i = 0; i < craftSize; i++) {
            const item = this.getItemAt(craftType, i);
            if (item) availableCounts[item.id] = (availableCounts[item.id] || 0) + item.count;
        }

        let needed = {};
        if (recipe.type === 'shaped') {
            for (let r = 0; r < recipe.pattern.length; r++) {
                for (let c = 0; c < recipe.pattern[r].length; c++) {
                    const key = recipe.pattern[r][c];
                    if (key !== ' ') {
                        const id = recipe.keys[key];
                        needed[id] = (needed[id] || 0) + 1;
                    }
                }
            }
        } else {
            recipe.ingredients.forEach(i => {
                needed[i.id] = (needed[i.id] || 0) + i.count;
            });
        }

        for (const [id, count] of Object.entries(needed)) {
            if (!availableCounts[id] || availableCounts[id] < count) return false;
        }
        return true;
    }

    updateRecipeListAvailability() {
        if (!this.recipeElements) return;
        this.recipeElements.forEach(({ element, recipe }) => {
            if (this.canCraftRecipe(recipe)) {
                element.classList.remove('recipe-unavailable');
            } else {
                element.classList.add('recipe-unavailable');
            }
        });
    }

    populateRecipeList() {
        this.recipeList.innerHTML = '';
        this.recipeElements = [];
        const filter = this.recipeSearch.value.toLowerCase();

        Recipes.forEach(recipe => {
            const requires3x3 = recipe.type === 'shaped' && (recipe.pattern.length > 2 || recipe.pattern[0].length > 2);
            if (requires3x3 && this.mode === 'player') return; // Cannot craft this in 2x2 grid

            const resultDef = BlockRegistry[recipe.result.id];
            if (!resultDef) return;
            if (filter && !resultDef.name.toLowerCase().includes(filter)) return;

            const entry = document.createElement('div');
            entry.className = 'recipe-entry slot';

            const icon = document.createElement('div');
            icon.className = 'item-icon';
            const [u, v] = this.getTextureCoords(recipe.result.id);
            icon.style.backgroundImage = `url(${window.ATLAS_DATA_URL})`;
            icon.style.backgroundSize = `calc(16 * 100%) calc(16 * 100%)`;
            icon.style.backgroundPosition = `calc(${u} * -100%) calc(${v} * -100%)`;
            icon.style.imageRendering = 'pixelated';

            entry.appendChild(icon);

            entry.addEventListener('mouseenter', (e) => {
                this.previewRecipe = recipe;
                this.tooltip.textContent = resultDef.name;
                this.tooltip.classList.remove('hidden');
                this.updateTooltipPosition(e);
                this.render();
            });
            entry.addEventListener('mouseleave', () => {
                this.previewRecipe = null;
                this.tooltip.classList.add('hidden');
                this.render();
            });

            entry.addEventListener('click', (e) => {
                if (this.canCraftRecipe(recipe)) {
                    this.autofillRecipe(recipe, e.shiftKey);
                }
            });

            this.recipeList.appendChild(entry);
            this.recipeElements.push({ element: entry, recipe });
        });

        this.updateRecipeListAvailability();
    }

    autofillRecipe(recipe, isShiftClick = false) {
        const requires3x3 = recipe.type === 'shaped' && (recipe.pattern.length > 2 || recipe.pattern[0].length > 2);
        if (requires3x3 && this.mode !== 'table') {
            alert('This recipe requires a Crafting Table 3x3 grid.');
            return;
        }

        const gridWidth = this.mode === 'table' ? 3 : 2;
        let requirements = [];

        if (recipe.type === 'shaped') {
            for (let r = 0; r < recipe.pattern.length; r++) {
                for (let c = 0; c < recipe.pattern[r].length; c++) {
                    const key = recipe.pattern[r][c];
                    if (key !== ' ') {
                        const ingId = recipe.keys[key];
                        const gridIndex = (r * gridWidth) + c;
                        requirements.push({ id: ingId, gridIndex });
                    }
                }
            }
        } else {
            recipe.ingredients.forEach(ing => {
                for (let i = 0; i < ing.count; i++) {
                    requirements.push({ id: ing.id, shapeless: true });
                }
            });
        }

        // Check if the current grid perfectly matches the recipe to increment
        let currentSets = 0;
        const craftSize = this.mode === 'player' ? 4 : 9;
        const craftType = this.mode === 'player' ? 'crafting_2x2' : 'crafting_3x3';
        let gridMatches = true;
        let minStack = 64;

        if (recipe.type === 'shaped') {
            for (let i = 0; i < craftSize; i++) {
                const item = this.getItemAt(craftType, i);
                const req = requirements.find(r => r.gridIndex === i);
                if (req) {
                    if (!item || item.id !== req.id) { gridMatches = false; break; }
                    if (item.count < minStack) minStack = item.count;
                } else {
                    if (item) { gridMatches = false; break; }
                }
            }
        } else {
            // Shapeless matching is harder, assume 0 for now unless empty
            gridMatches = false;
        }

        if (gridMatches) {
            currentSets = minStack;
        } else {
            let isEmpty = true;
            for (let i = 0; i < craftSize; i++) if (this.getItemAt(craftType, i)) isEmpty = false;
            if (isEmpty) currentSets = 0; else currentSets = -1; // -1 means dirty grid
        }

        // Calculate max possible sets
        let availableCounts = {};
        for (let i = 0; i < 36; i++) {
            const item = this.inventory.slots[i];
            if (item) availableCounts[item.id] = (availableCounts[item.id] || 0) + item.count;
        }
        for (let i = 0; i < craftSize; i++) {
            const item = this.getItemAt(craftType, i);
            if (item) availableCounts[item.id] = (availableCounts[item.id] || 0) + item.count;
        }

        let neededCounts = {};
        requirements.forEach(req => neededCounts[req.id] = (neededCounts[req.id] || 0) + 1);

        let maxSets = 64;
        for (const [id, count] of Object.entries(neededCounts)) {
            const possible = Math.floor((availableCounts[id] || 0) / count);
            if (possible < maxSets) maxSets = possible;
        }

        let targetSets = isShiftClick ? maxSets : (currentSets >= 0 ? currentSets + 1 : 1);
        if (targetSets > maxSets) targetSets = maxSets;
        if (targetSets <= 0) return;

        this.clearCraftingGrid();

        // Fill grid with targetSets
        for (let set = 0; set < targetSets; set++) {
            let shapelessIndex = 0;
            for (const req of requirements) {
                let foundIndex = -1;
                for (let i = 0; i < 36; i++) {
                    const item = this.inventory.slots[i];
                    if (item && item.id === req.id && item.count > 0) {
                        foundIndex = i;
                        break;
                    }
                }

                if (foundIndex !== -1) {
                    const sourceItem = this.inventory.slots[foundIndex];
                    sourceItem.count--;
                    if (sourceItem.count === 0) this.inventory.slots[foundIndex] = null;

                    let targetGridIndex = req.shapeless ? shapelessIndex++ : req.gridIndex;
                    let existing = this.getItemAt(craftType, targetGridIndex);
                    if (existing) existing.count++;
                    else this.setItemAt(craftType, targetGridIndex, { id: req.id, count: 1 });
                }
            }
        }

        this.inventory.updateRecipe(this.mode === 'table');
        this.render();
    }

    clearCraftingGrid() {
        const size = this.mode === 'player' ? 4 : 9;
        const craftType = this.mode === 'player' ? 'crafting_2x2' : 'crafting_3x3';
        for (let i = 0; i < size; i++) {
            const item = this.getItemAt(craftType, i);
            if (item) {
                // Put back into main inventory
                for (let j = 0; j < 36; j++) {
                    if (!this.inventory.slots[j]) {
                        this.inventory.slots[j] = { ...item };
                        this.setItemAt(craftType, i, null);
                        break;
                    } else if (this.inventory.slots[j].id === item.id) {
                        const space = 64 - this.inventory.slots[j].count;
                        if (space >= item.count) {
                            this.inventory.slots[j].count += item.count;
                            this.setItemAt(craftType, i, null);
                            break;
                        }
                    }
                }
                // If inventory full, drops it (todo: real drop)
            }
        }
    }

    setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            // Only allow inventory/hotbar keys when game is in PLAYING state
            if (this.uiManager && this.uiManager.state !== 'PLAYING') return;

            if (e.code === 'KeyE') {
                this.toggleInventory();
            }

            if (!this.isOpen && e.code.startsWith('Digit') && e.code !== 'Digit0') {
                const num = parseInt(e.code.replace('Digit', ''));
                if (num >= 1 && num <= 9) {
                    this.inventory.activeHotbarIndex = num - 1;
                    this.render();
                }
            }
        });

        // Prevent browser context menu from interrupting split-stack drag
        this.uiLayer.addEventListener('contextmenu', e => e.preventDefault());

        window.addEventListener('wheel', (e) => {
            if (!this.isOpen && this.inputManager.isLocked) {
                if (e.deltaY > 0) {
                    this.inventory.activeHotbarIndex = (this.inventory.activeHotbarIndex + 1) % 9;
                } else {
                    this.inventory.activeHotbarIndex = (this.inventory.activeHotbarIndex - 1 + 9) % 9;
                }
                this.render();
            }
        });

        window.addEventListener('mouseup', () => {
            this.isPreviewDragging = false;
            this.onGlobalMouseUp();
        });
        window.addEventListener('mousemove', (e) => {
            if (this.isPreviewDragging) {
                const dx = e.clientX - this.previewLastP.x;
                const dy = e.clientY - this.previewLastP.y;
                this.previewYaw += dx * 0.01;
                this.previewPitch -= dy * 0.01;

                // Clamp pitch
                this.previewPitch = Math.max(-0.5, Math.min(0.5, this.previewPitch));

                this.previewPlayerGroup.rotation.y = this.previewYaw;
                // Rotate body slightly on pitch
                this.previewPlayerGroup.rotation.x = this.previewPitch;

                this.previewLastP = { x: e.clientX, y: e.clientY };
            }
            this.onGlobalMouseMove(e);
        });
    }

    openInventory() {
        this.mode = 'player';
        this.inventoryTitle.textContent = 'Inventory';
        this.openUI();
    }

    openCraftingTable() {
        this.mode = 'table';
        this.inventoryTitle.textContent = 'Crafting';
        this.openUI();
    }

    openFurnace() {
        this.mode = 'furnace';
        this.inventoryTitle.textContent = 'Furnace';
        this.openUI();
    }

    openUI() {
        this.isOpen = true;
        document.exitPointerLock();
        this.uiLayer.classList.remove('hidden');
        this.inventoryScreen.classList.remove('hidden');

        // Manage panel visibility
        this.playerCraftingPanel.classList.toggle('hidden', this.mode !== 'player');
        this.tableCraftingPanel.classList.toggle('hidden', this.mode !== 'table');
        this.furnacePanel.classList.toggle('hidden', this.mode !== 'furnace');

        // Show/Hide player preview ONLY in 'player' mode
        this.playerPreviewPanel.classList.toggle('hidden', this.mode !== 'player');

        this.populateRecipeList(); // Re-populate for 2x2 vs 3x3 filter
        this.render();
    }

    toggleInventory() {
        if (this.isOpen) {
            this.closeUI();
        } else {
            this.openInventory();
        }
    }

    closeUI() {
        this.isOpen = false;
        this.uiLayer.classList.add('hidden');
        this.inventoryScreen.classList.add('hidden');

        // Put dragged item back if closed mid-drag
        if (this.draggedItem) {
            this.setItemAt(this.draggedType, this.draggedIndex, this.draggedItem);
            this.draggedItem = null;
            this.dragElement?.remove();
            this.dragElement = null;
        }

        // We should spit out crafting items to world on close
        // For now, return them to main inventory if possible, else drop them
        const returnToInventory = (item) => {
            if (!item) return;
            // Attempt to add back to inventory
            for (let i = 0; i < 36; i++) {
                if (!this.inventory.slots[i]) {
                    this.inventory.slots[i] = item;
                    return;
                }
            }
        };

        if (this.mode === 'player' || this.mode === 'table') {
            const size = this.mode === 'player' ? 4 : 9;
            for (let i = 0; i < size; i++) {
                const mapIdx = this.mode === 'player' ? (i < 2 ? i : i + 1) : i;
                const item = this.inventory.getCraftingSlot(mapIdx);
                if (item) {
                    returnToInventory(item);
                    this.inventory.setCraftingSlot(mapIdx, null);
                }
            }
            this.inventory.updateRecipe(false);
        }

        this.inputManager.domElement.requestPointerLock();
        this.render();
    }

    getTextureCoords(tokenId) {
        // Special UI overrides for 3D items rendering in 2D inventory
        // Example: Torch block is just a stick model, but its icon is a 2D torch sprite at [2,1]
        const uiOverrides = {
            19: [2, 1], // Torch
            42: [14, 1], // Tall Grass
            43: [14, 2], // Red Flower
            44: [15, 1], // Yellow Flower
            // Tools are inherently 2D icons
        };

        if (uiOverrides[tokenId]) {
            return uiOverrides[tokenId];
        }

        const def = BlockRegistry[tokenId];
        if (!def || !def.textures) return [0, 0];
        // Standard block face fallbacks: try front, side, all, then top
        return def.textures.front || def.textures.all || def.textures.side || def.textures.top || [0, 0];
    }

    updateSlotDOM(element, item, isSelected, previewItem = null) {
        const icon = element.querySelector('.item-icon');
        const count = element.querySelector('.item-count');

        if (previewItem) {
            const [u, v] = this.getTextureCoords(previewItem.id);
            icon.style.backgroundImage = `url(${window.ATLAS_DATA_URL})`;
            icon.style.backgroundSize = `calc(16 * 100%) calc(16 * 100%)`;
            icon.style.backgroundPosition = `calc(${u} * -100%) calc(${v} * -100%)`;
            icon.style.opacity = '0.4';
            icon.style.imageRendering = 'pixelated';
            count.textContent = '';
        } else if (item) {
            const [u, v] = this.getTextureCoords(item.id);
            icon.style.backgroundImage = `url(${window.ATLAS_DATA_URL})`;
            icon.style.backgroundSize = `calc(16 * 100%) calc(16 * 100%)`;
            icon.style.backgroundPosition = `calc(${u} * -100%) calc(${v} * -100%)`;
            icon.style.opacity = '1.0';
            icon.style.imageRendering = 'pixelated';
            count.textContent = item.count > 1 ? item.count : '';
        } else {
            icon.style.backgroundImage = 'none';
            icon.style.opacity = '1.0';
            count.textContent = '';
        }

        if (isSelected) {
            element.classList.add('selected');
        } else {
            element.classList.remove('selected');
        }
    }

    getItemAt(type, index) {
        if (type === 'inventory') return this.inventory.getSlot(index);

        if (type === 'crafting_2x2') {
            // Map 0,1,2,3 -> 0,1,3,4
            const mapObj = { 0: 0, 1: 1, 2: 3, 3: 4 };
            return this.inventory.getCraftingSlot(mapObj[index]);
        }
        if (type === 'crafting_3x3') return this.inventory.getCraftingSlot(index);

        if (type === 'result_2x2' || type === 'result_3x3') return this.inventory.craftingResult;

        if (type === 'furnace_input') return this.inventory.getFurnaceSlot('input');
        if (type === 'furnace_fuel') return this.inventory.getFurnaceSlot('fuel');
        if (type === 'furnace_result') return this.inventory.getFurnaceSlot('result');

        return null;
    }

    setItemAt(type, index, item) {
        if (type === 'inventory') this.inventory.setSlot(index, item);

        if (type === 'crafting_2x2') {
            const mapObj = { 0: 0, 1: 1, 2: 3, 3: 4 };
            this.inventory.setCraftingSlot(mapObj[index], item);
            this.inventory.updateRecipe(false);
        }
        if (type === 'crafting_3x3') {
            this.inventory.setCraftingSlot(index, item);
            this.inventory.updateRecipe(true);
        }

        if (type === 'furnace_input') this.inventory.setFurnaceSlot('input', item);
        if (type === 'furnace_fuel') this.inventory.setFurnaceSlot('fuel', item);

        // Cannot directly set results
    }

    render() {
        // Render HUD Hotbar
        Array.from(this.hotbarContainer.children).forEach((slotEl, i) => {
            this.updateSlotDOM(slotEl, this.inventory.getSlot(i), i === this.inventory.activeHotbarIndex);
        });

        if (!this.isOpen) return; // Don't bother rendering rest if closed

        let previewLayout = new Array(9).fill(null);
        if (this.previewRecipe) {
            const gridWidth = this.mode === 'table' ? 3 : 2;
            if (this.previewRecipe.type === 'shaped') {
                for (let r = 0; r < this.previewRecipe.pattern.length; r++) {
                    for (let c = 0; c < this.previewRecipe.pattern[r].length; c++) {
                        const key = this.previewRecipe.pattern[r][c];
                        if (key !== ' ') {
                            const ingId = this.previewRecipe.keys[key];
                            const gridIndex = (r * gridWidth) + c;
                            if (gridIndex < 9) previewLayout[gridIndex] = { id: ingId };
                        }
                    }
                }
            } else {
                let idx = 0;
                this.previewRecipe.ingredients.forEach(ing => {
                    for (let i = 0; i < ing.count; i++) {
                        if (idx < 9) previewLayout[idx++] = { id: ing.id };
                    }
                });
            }
        }

        // Render Main Grid
        Array.from(this.mainGridContainer.children).forEach((slotEl, i) => {
            const actualIndex = i + 9;
            const item = (this.draggedType === 'inventory' && this.draggedIndex === actualIndex && !this.isSplitDrag) ? null : this.inventory.getSlot(actualIndex);
            this.updateSlotDOM(slotEl, item, false);
        });

        // Render Screen Hotbar
        Array.from(this.inventoryHotbarContainer.children).forEach((slotEl, i) => {
            const item = (this.draggedType === 'inventory' && this.draggedIndex === i && !this.isSplitDrag) ? null : this.inventory.getSlot(i);
            this.updateSlotDOM(slotEl, item, i === this.inventory.activeHotbarIndex);
        });

        if (this.mode === 'player') {
            Array.from(this.playerCraftingGrid.children).forEach((slotEl, i) => {
                const item = (this.draggedType === 'crafting_2x2' && this.draggedIndex === i) ? null : this.getItemAt('crafting_2x2', i);
                const pItem = (!item && this.previewRecipe && previewLayout[i]) ? previewLayout[i] : null;
                this.updateSlotDOM(slotEl, item, false, pItem);
            });
            const resultItem = (this.draggedType === 'result_2x2') ? null : this.inventory.craftingResult;
            const pResult = (!resultItem && this.previewRecipe) ? this.previewRecipe.result : null;
            this.updateSlotDOM(this.playerCraftingResult, resultItem, false, pResult);
        }

        if (this.mode === 'table') {
            Array.from(this.tableCraftingGrid.children).forEach((slotEl, i) => {
                const item = (this.draggedType === 'crafting_3x3' && this.draggedIndex === i) ? null : this.getItemAt('crafting_3x3', i);
                const pItem = (!item && this.previewRecipe && previewLayout[i]) ? previewLayout[i] : null;
                this.updateSlotDOM(slotEl, item, false, pItem);
            });
            const resultItem = (this.draggedType === 'result_3x3') ? null : this.inventory.craftingResult;
            const pResult = (!resultItem && this.previewRecipe) ? this.previewRecipe.result : null;
            this.updateSlotDOM(this.tableCraftingResult, resultItem, false, pResult);
        }

        if (this.mode === 'furnace') {
            const inItem = (this.draggedType === 'furnace_input') ? null : this.inventory.furnaceInput;
            this.updateSlotDOM(this.furnaceInputSlot, inItem, false);

            const fuelItem = (this.draggedType === 'furnace_fuel') ? null : this.inventory.furnaceFuel;
            this.updateSlotDOM(this.furnaceFuelSlot, fuelItem, false);

            const resItem = (this.draggedType === 'furnace_result') ? null : this.inventory.furnaceResult;
            this.updateSlotDOM(this.furnaceResultSlot, resItem, false);

            // Progress bars
            const fTime = this.inventory.fuelTime;
            const mTime = this.inventory.maxFuelTime || 1;
            this.furnaceFireFg.style.height = `${(fTime / mTime) * 100}%`;
            this.furnaceProgressFg.style.width = `${this.inventory.smeltProgress * 100}%`;
        }

        this.updateRecipeListAvailability();
    }

    // Drag and drop logic
    onSlotMouseDown(e, type, index) {
        if (!this.isOpen) return;

        let item = this.getItemAt(type, index);

        // If we click an empty slot while holding an item (handled in MouseUp mostly, but let's intercept single drop here maybe? No, let's keep all drops in MouseUp)
        if (!item && !this.draggedItem) return;

        // Start Drag or Shift-Click Transfer
        if (item && !this.draggedItem) {
            const isResult = type.startsWith('result') || type === 'furnace_result';

            if (e.shiftKey) {
                this.handleShiftClickTransfer(type, index, item);
                return;
            }

            // If right click, split stack
            if (e.button === 2 && !isResult && item.count > 1) {
                const takeCount = Math.floor(item.count / 2);
                item.count -= takeCount;
                this.draggedItem = { id: item.id, count: takeCount };
                this.draggedType = type;
                this.draggedIndex = index;
                this.isSplitDrag = true;
            } else {
                // Left click or size 1, take whole stack
                this.draggedItem = { ...item };

                // Remove from source conditionally
                if (!isResult) {
                    this.setItemAt(type, index, null);
                }
                this.draggedType = type;
                this.draggedIndex = index;
                this.isSplitDrag = false;
            }

            // Create floating element
            this.dragElement = document.createElement('div');
            this.dragElement.className = 'drag-item';
            const [u, v] = this.getTextureCoords(this.draggedItem.id);
            this.dragElement.style.backgroundImage = `url(${window.ATLAS_DATA_URL})`;
            this.dragElement.style.backgroundSize = `calc(16 * 100%) calc(16 * 100%)`;
            this.dragElement.style.backgroundPosition = `calc(${u} * -100%) calc(${v} * -100%)`;
            this.dragElement.style.imageRendering = 'pixelated';

            const count = document.createElement('div');
            count.className = 'item-count';
            count.textContent = this.draggedItem.count > 1 ? this.draggedItem.count : '';
            this.dragElement.appendChild(count);

            this.updateDragElementPosition(e);
            document.body.appendChild(this.dragElement);

            this.render();
        }
        // We already have a dragged item, and we clicked. 
        // If right click, drop 1 item into the slot
        else if (this.draggedItem && e.button === 2) {
            const isResult = type.startsWith('result') || type === 'furnace_result';
            if (isResult) return; // Can't drop into result

            let targetItem = this.getItemAt(type, index);
            if (!targetItem) {
                this.setItemAt(type, index, { id: this.draggedItem.id, count: 1 });
                this.draggedItem.count--;
            } else if (targetItem.id === this.draggedItem.id && targetItem.count < 64) {
                targetItem.count++;
                this.draggedItem.count--;
            }

            if (this.draggedItem.count === 0) {
                this.draggedItem = null;
                this.dragElement.remove();
                this.dragElement = null;
                this.draggedType = null;
            } else {
                // Update drag element count text
                this.dragElement.querySelector('.item-count').textContent = this.draggedItem.count > 1 ? this.draggedItem.count : '';
            }
            this.render();
        }
    }

    handleShiftClickTransfer(sourceType, sourceIndex, item) {
        let moved = false;
        const isResult = sourceType.startsWith('result') || sourceType === 'furnace_result';

        // From Crafting/Furnace -> Inventory
        if (sourceType !== 'inventory') {
            for (let i = 0; i < 36; i++) {
                const targetSlot = this.inventory.slots[i];
                if (!targetSlot) {
                    this.inventory.slots[i] = { ...item };
                    moved = true;
                    break;
                } else if (targetSlot.id === item.id) {
                    const space = 64 - targetSlot.count;
                    if (space >= item.count) {
                        targetSlot.count += item.count;
                        moved = true;
                        break;
                    } else if (space > 0) {
                        targetSlot.count = 64;
                        item.count -= space;
                        // Keep looping to find more space for remainder
                    }
                }
            }
            if (moved && isResult) {
                if (sourceType === 'result_2x2' || sourceType === 'result_3x3') {
                    this.inventory.consumeCraftingIngredients(sourceType === 'result_3x3');
                } else if (sourceType === 'furnace_result') {
                    this.inventory.setFurnaceSlot('result', null);
                }
            } else if (moved && !isResult) {
                this.setItemAt(sourceType, sourceIndex, null);
            }
        }
        // From Inventory -> Crafting/Furnace (Hotbar 0-8 -> Main 9-35, and vice versa?)
        // The user asked to fast transfer to crafting area. 
        // We will try to place it in the first empty crafting grid slot.
        else {
            const craftSize = this.mode === 'player' ? 4 : (this.mode === 'table' ? 9 : 0);
            const craftType = this.mode === 'player' ? 'crafting_2x2' : 'crafting_3x3';

            if (craftSize > 0) {
                for (let i = 0; i < craftSize; i++) {
                    const existing = this.getItemAt(craftType, i);
                    if (!existing) {
                        this.setItemAt(craftType, i, { ...item });
                        this.setItemAt(sourceType, sourceIndex, null);
                        moved = true;
                        break;
                    } else if (existing.id === item.id && existing.count < 64) {
                        const space = 64 - existing.count;
                        if (space >= item.count) {
                            existing.count += item.count;
                            this.setItemAt(sourceType, sourceIndex, null);
                            moved = true;
                            break;
                        } else {
                            existing.count = 64;
                            item.count -= space;
                        }
                    }
                }
            }

            // If we are in furnace mode and shifting from inventory... try fuel then input
            if (!moved && this.mode === 'furnace') {
                const heat = RecipeRegistry.getFuelValue(item.id);
                if (heat > 0 && !this.inventory.furnaceFuel) {
                    this.setItemAt('furnace_fuel', 0, { ...item });
                    this.setItemAt(sourceType, sourceIndex, null);
                    moved = true;
                } else if (!this.inventory.furnaceInput) {
                    this.setItemAt('furnace_input', 0, { ...item });
                    this.setItemAt(sourceType, sourceIndex, null);
                    moved = true;
                }
            }

            // Quick transfer between hotbar/inventory
            if (!moved) {
                if (sourceIndex < 9) {
                    // Hotbar -> Main Inv
                    for (let i = 9; i < 36; i++) {
                        if (!this.inventory.slots[i]) {
                            this.inventory.slots[i] = { ...item };
                            this.setItemAt(sourceType, sourceIndex, null);
                            moved = true;
                            break;
                        }
                    }
                } else {
                    // Main Inv -> Hotbar
                    for (let i = 0; i < 9; i++) {
                        if (!this.inventory.slots[i]) {
                            this.inventory.slots[i] = { ...item };
                            this.setItemAt(sourceType, sourceIndex, null);
                            moved = true;
                            break;
                        }
                    }
                }
            }
        }

        if (moved) this.render();
    }

    onSlotMouseEnter(e, type, index) {
        if (this.draggedItem) {
            this.hoveredType = type;
            this.hoveredIndex = index;
        }

        // Show tooltip if item exists and we aren't dragging
        const item = this.getItemAt(type, index);
        if (item && !this.draggedItem) {
            const blockDef = BlockRegistry[item.id];
            if (blockDef) {
                this.tooltip.textContent = blockDef.name || 'Unknown Item';
                this.tooltip.classList.remove('hidden');
                this.updateTooltipPosition(e);
            }
        }
    }

    onSlotMouseLeave(e) {
        this.tooltip.classList.add('hidden');
    }

    onGlobalMouseMove(e) {
        if (this.dragElement) {
            this.updateDragElementPosition(e);
        }
        if (!this.tooltip.classList.contains('hidden')) {
            this.updateTooltipPosition(e);
        }
    }

    updateTooltipPosition(e) {
        this.tooltip.style.left = `${e.clientX + 12}px`;
        this.tooltip.style.top = `${e.clientY - 20}px`;
    }

    updateDragElementPosition(e) {
        if (this.dragElement) {
            this.dragElement.style.left = `${e.clientX - 18}px`; // Center on mouse
            this.dragElement.style.top = `${e.clientY - 18}px`;
        }
    }

    onGlobalMouseUp() {
        if (this.draggedItem) {
            // We released the mouse. If it wasn't a right-click drop-1 action (which resolves immediately),
            // we should drop the whole stack here.

            const isSourceResult = this.draggedType.startsWith('result') || this.draggedType === 'furnace_result';
            const isTargetResult = this.hoveredType !== null && (this.hoveredType.startsWith('result') || this.hoveredType === 'furnace_result');

            if (this.hoveredType !== null && !isTargetResult) {
                const targetType = this.hoveredType;
                const targetIndex = this.hoveredIndex;
                const targetItem = this.getItemAt(targetType, targetIndex);

                // If dropping into same slot we picked up from, just put it back
                if (targetType === this.draggedType && targetIndex === this.draggedIndex) {
                    if (!isSourceResult) {
                        this.setItemAt(targetType, targetIndex, this.draggedItem);
                    }
                }
                // If dropping onto matching item, MERGE
                else if (targetItem && targetItem.id === this.draggedItem.id) {
                    // Combine counts
                    const spaceLeft = 64 - targetItem.count;
                    if (spaceLeft >= this.draggedItem.count) {
                        targetItem.count += this.draggedItem.count;
                        this.draggedItem = null;
                    } else {
                        targetItem.count = 64;
                        this.draggedItem.count -= spaceLeft;
                        // Return remaining to original slot
                        if (!isSourceResult) {
                            this.setItemAt(this.draggedType, this.draggedIndex, this.draggedItem);
                        }
                    }
                    if (isSourceResult && !this.draggedItem) {
                        if (this.draggedType === 'result_2x2' || this.draggedType === 'result_3x3') {
                            this.inventory.consumeCraftingIngredients(this.draggedType === 'result_3x3');
                        } else if (this.draggedType === 'furnace_result') {
                            this.inventory.setFurnaceSlot('result', null);
                        }
                    }
                }
                // If dropping into EMPTY slot
                else if (!targetItem) {
                    this.setItemAt(targetType, targetIndex, this.draggedItem);
                    if (isSourceResult) {
                        if (this.draggedType === 'result_2x2' || this.draggedType === 'result_3x3') {
                            this.inventory.consumeCraftingIngredients(this.draggedType === 'result_3x3');
                        } else if (this.draggedType === 'furnace_result') {
                            this.inventory.setFurnaceSlot('result', null);
                        }
                    }
                    this.draggedItem = null;
                }
                // If dropping onto DIFFERENT item, SWAP
                else {
                    if (isSourceResult) {
                        // Cannot swap a result with another item easily, drag is cancelled
                        // Handled automatically as drag drops to floor or vanishes if returning is impossible.
                        // Actually, result swap cancel means we don't complete the craft. Drop remains in mouse or vanished.
                    } else {
                        if (this.isSplitDrag) {
                            // Cancel drop, return dragged item to source
                            const original = this.getItemAt(this.draggedType, this.draggedIndex);
                            original.count += this.draggedItem.count;
                        } else {
                            // Standard swap
                            this.setItemAt(targetType, targetIndex, this.draggedItem);
                            this.setItemAt(this.draggedType, this.draggedIndex, targetItem);
                        }
                        this.draggedItem = null;
                    }
                }
            } else {
                // Dropped outside, or into result slot. Put it back to source.
                if (!isSourceResult) {
                    const original = this.getItemAt(this.draggedType, this.draggedIndex);
                    if (original && original.id === this.draggedItem.id) {
                        original.count += this.draggedItem.count;
                    } else {
                        this.setItemAt(this.draggedType, this.draggedIndex, this.draggedItem);
                    }
                }
            }

            // Cleanup Drag State
            if (this.dragElement) {
                this.dragElement.remove();
                this.dragElement = null;
            }
            this.draggedItem = null;
            this.draggedType = null;
            this.draggedIndex = null;
            this.hoveredType = null;
            this.hoveredIndex = null;
            this.isSplitDrag = false;

            this.tooltip.classList.add('hidden'); // Hide tooltip after drop

            this.render();
        }
    }
}
