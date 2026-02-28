import './style.css';
import * as THREE from 'three';
import { VoxelWorld } from './world/VoxelWorld.js';
import { ChunkManager } from './world/ChunkManager.js';
import { createTextureAtlas } from './world/TextureAtlas.js';
import { InputManager } from './engine/InputManager.js';
import { Player } from './player/Player.js';
import { VoxelRaycaster } from './interaction/Raycaster.js';
import { BlockHighlight } from './interaction/Highlight.js';
import { Blocks, BlockRegistry, getBlockHardness, getToolData } from './world/BlockRegistry.js';
import { TerrainGenerator } from './world/TerrainGenerator.js';
import { Inventory } from './inventory/Inventory.js';
import { InventoryUI } from './inventory/InventoryUI.js';
import { SkyManager } from './world/SkyManager.js';
import { LightingManager } from './world/LightingManager.js';
import { EntityManager } from './entities/EntityManager.js';
import { Mob } from './entities/Mob.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { UIManager } from './ui/UIManager.js';
import { DebugOverlay } from './ui/DebugOverlay.js';
import { StorageManager } from './persistence/StorageManager.js';
import { ParticleSystem } from './fx/ParticleSystem.js';
import { PeerManager } from './network/PeerManager.js';

const storage = new StorageManager();
await storage.init();
let worldKey = null; // Set dynamically when a world is selected

const container = document.getElementById('app');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(scene.background, 20, 100);
window.scene = scene;

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(32, 100, 64); // Start higher up to accommodate high terrain

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const inputManager = new InputManager(renderer.domElement);

const skyManager = new SkyManager(scene);
const lightingManager = new LightingManager(scene);

const { texture, dataURL } = createTextureAtlas();
const opaqueMaterial = new THREE.MeshStandardMaterial({
  map: texture,
  side: THREE.FrontSide,
  transparent: false,
  vertexColors: true,
  roughness: 0.8,
  metalness: 0.1,
});

const transparentMaterial = new THREE.MeshStandardMaterial({
  map: texture,
  side: THREE.FrontSide,
  alphaTest: 0.1,
  transparent: true,
  vertexColors: true,
  roughness: 0.8,
  metalness: 0.1,
});

// Expose atlas globally or pass to UI
window.ATLAS_DATA_URL = dataURL;

const world = new VoxelWorld({ chunkSize: 32 });
const chunkManager = new ChunkManager(world, scene, opaqueMaterial, transparentMaterial);
const player = new Player(camera, inputManager, world);
player.position.set(32, 100, 32); // Also spawn player higher

const inventory = new Inventory();
const inventoryUI = new InventoryUI(inventory, inputManager);

const raycaster = new VoxelRaycaster(world);
const entityRaycaster = new THREE.Raycaster();
const highlight = new BlockHighlight(scene);

// Pre-allocated reusable objects to avoid GC pressure
const _rayOrigin = new THREE.Vector2(0, 0);
const _forwardVec = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, -1);

// Dirty flag for inventory UI — only re-render when something changed
let inventoryDirty = true;
const _markInventoryDirty = () => { inventoryDirty = true; };
let terrainGenerator = null;
let currentWorldSeed = null; // Track current world seed for worker

const generatedColumns = new Set();
const activeChunkRequests = new Set();
const terrainQueue = [];
const terrainQueueSet = new Set();
const chunkLoadQueue = [];
const chunkLoadQueueSet = new Set();
const pendingMeshRebuilds = new Set();

const entityManager = new EntityManager(scene, world);
entityManager.skyManager = skyManager;
entityManager._onItemPickedUp = _markInventoryDirty;
player.entityManager = entityManager;

// HOST: Broadcast mob death item drops to peers
window.addEventListener('item-dropped', (e) => {
  if (peerManager.isConnected && peerManager.isHost) {
    const item = e.detail.item;
    peerManager.sendItemDrop(item.itemId, item.count, item.mesh.position.x, item.mesh.position.y, item.mesh.position.z);
  }
});

const audioSystem = new AudioSystem();
player.audioSystem = audioSystem;

const uiManager = new UIManager(inputManager);
inventoryUI.uiManager = uiManager;

// --- Item Drop Callback ---
// Called by InventoryUI when the player drops items (Q key, Ctrl+Q, drag-out-of-inventory)
inventoryUI.onDropItem = (itemId, count) => {
  // Calculate drop position: at eye height, slightly forward
  const dropDir = new THREE.Vector3(0, 0, -1);
  dropDir.applyQuaternion(camera.quaternion);
  dropDir.normalize();

  const dropPos = player.position.clone();
  dropPos.y += 1.6; // Eye height
  dropPos.addScaledVector(dropDir, 0.5); // Spawn just in front of the face

  // Throw velocity: exact camera direction * speed
  const throwVel = new THREE.Vector3(
    dropDir.x * 6,
    dropDir.y * 6,
    dropDir.z * 6
  );

  entityManager.addDroppedItem(itemId, count, dropPos, throwVel);

  // Multiplayer sync
  if (peerManager.isConnected) {
    if (peerManager.isHost) {
      peerManager.sendItemDrop(itemId, count, dropPos.x, dropPos.y, dropPos.z);
    } else {
      peerManager.sendPlayerDrop(itemId, count, dropPos.x, dropPos.y, dropPos.z);
    }
  }

  _markInventoryDirty();
};

const debugOverlay = new DebugOverlay();
const particleSystem = new ParticleSystem(scene);

// ---- Settings Application ----
// Cache settings to avoid calling getSettings() every frame
let cachedSettings = null;
let lightUpdateCounter = 0;

function applySettings(settings) {
  // Shadows
  if (settings.shadows === 'off') {
    renderer.shadowMap.enabled = false;
  } else {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = settings.shadows === 'basic'
      ? THREE.BasicShadowMap
      : THREE.PCFSoftShadowMap;
  }
  // Need to flag all materials as needing update after shadow type change
  renderer.shadowMap.needsUpdate = true;

  // Resolution scale
  const scale = (settings.resolution || 100) / 100;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);

  // Mouse sensitivity
  player.mouseSensitivity = 0.002 * (settings.sensitivity / 100);

  // Volume
  audioSystem.setVolume((settings.volume || 100) / 100);

  // Particles
  particleSystem.enabled = settings.particles !== 'off';
  particleSystem.reduced = settings.particles === 'reduced';
}

// Apply saved settings on startup
cachedSettings = uiManager.getSettings();
applySettings(cachedSettings);

// Live settings changes
uiManager.onSettingsChanged = (settings) => {
  cachedSettings = settings;
  applySettings(settings);
};

async function refreshWorldList() {
  const worlds = await storage.listWorlds();
  uiManager.renderWorldList(worlds);
}

async function startWorld(selectedWorldId, seed) {
  worldKey = selectedWorldId;

  // Clear old world data
  world.chunks.clear();
  world.dirtyChunks.clear();
  generatedColumns.clear();
  activeChunkRequests.clear();
  terrainQueue.length = 0;
  terrainQueueSet.clear();
  chunkLoadQueue.length = 0;
  chunkLoadQueueSet.clear();
  pendingMeshRebuilds.clear();

  // Remove old chunk meshes
  for (const [cellId, entry] of chunkManager.meshes.entries()) {
    if (entry.opaque) { scene.remove(entry.opaque); entry.opaque.geometry.dispose(); }
    if (entry.transparent) { scene.remove(entry.transparent); entry.transparent.geometry.dispose(); }
  }
  chunkManager.meshes.clear();

  // Clear entities
  for (const entity of entityManager.entities) {
    if (entity.mesh) scene.remove(entity.mesh);
  }
  entityManager.entities = [];
  for (const item of entityManager.droppedItems) {
    if (item.mesh) scene.remove(item.mesh);
  }
  entityManager.droppedItems = [];

  // Clear torch positions
  lightingManager.torchPositions.clear();

  // Create terrain generator with world seed
  currentWorldSeed = seed || 'minecraft_seed';
  terrainGenerator = new TerrainGenerator(currentWorldSeed);

  // Reset player
  player.position.set(32, 100, 32);
  player.velocity.set(0, 0, 0);
  player.health = player.maxHealth;
  player.hunger = player.maxHunger;
  player.air = player.maxAir;
  player.updateHUD();
  camera.position.set(32, 100, 64);

  // Load saved player state
  const playerState = await storage.loadPlayerState(worldKey);
  if (playerState) {
    player.position.fromArray(playerState.position);
    camera.quaternion.fromArray(playerState.quaternion);
    for (let i = 0; i < playerState.inventory.length; i++) {
      inventory.slots[i] = playerState.inventory[i] || null;
    }
  } else {
    // New world starter items
    for (let i = 0; i < inventory.slots.length; i++) inventory.slots[i] = null;
    inventory.slots[0] = { id: Blocks.TORCH, count: 64 };
  }
  inventoryUI.render();

  // Load block change log for multiplayer sync
  const savedBlockLog = await storage.loadPlayerState(worldKey + '_blocklog');
  if (savedBlockLog && Array.isArray(savedBlockLog)) {
    blockChangeMap.clear();
    for (const entry of savedBlockLog) {
      blockChangeMap.set(`${entry.x},${entry.y},${entry.z}`, entry.blockId);
    }
  } else {
    blockChangeMap.clear();
  }

  // Load chests
  window.chestInventories = await storage.loadAllChests(worldKey);

  // Define Chest UI callbacks
  window.onChestClosed = (chestPos, chestPos2 = null) => {
    const chestId = `${chestPos.x},${chestPos.y},${chestPos.z}`;
    const inv = window.chestInventories.get(chestId);
    storage.saveChest(worldKey, chestId, inv);

    // Close animation sync
    const currentId = world.getVoxel(chestPos.x, chestPos.y, chestPos.z);

    // Save second
    if (chestPos2) {
      const chestId2 = `${chestPos2.x},${chestPos2.y},${chestPos2.z}`;
      const inv2 = window.chestInventories.get(chestId2);
      if (inv2) storage.saveChest(worldKey, chestId2, inv2);
    }

    const positionsToAnimate = [];
    if (currentId === Blocks.CHEST_OPEN) positionsToAnimate.push(chestPos);
    if (chestPos2 && world.getVoxel(chestPos2.x, chestPos2.y, chestPos2.z) === Blocks.CHEST_OPEN) {
      positionsToAnimate.push(chestPos2);
    }

    if (positionsToAnimate.length > 0) {
      playChestAnimation(positionsToAnimate, false, () => {
        positionsToAnimate.forEach(pos => {
          world.setVoxel(pos.x, pos.y, pos.z, Blocks.CHEST, true, true);
          updateVoxelGeometry(pos.x, pos.y, pos.z);
          addBlockChange(pos.x, pos.y, pos.z, Blocks.CHEST);
          if (peerManager.isConnected) peerManager.sendBlockChange(pos.x, pos.y, pos.z, Blocks.CHEST);
        });
      });
    }
  };

  window.onChestSlotUpdated = (chestPos, index, item) => {
    const chestId = `${chestPos.x},${chestPos.y},${chestPos.z}`;
    storage.saveChest(worldKey, chestId, window.chestInventories.get(chestId));
    if (peerManager.isConnected) {
      peerManager.sendEvent('CHEST_UPDATE_SLOT', { x: chestPos.x, y: chestPos.y, z: chestPos.z, index, item });
    }
  };

  // Pre-generate terrain around spawn — burst load for fast startup
  const spawnCoords = world.computeChunkCoordinates(player.position.x, player.position.y, player.position.z);
  const burstRenderDist = Math.min(cachedSettings.renderDistance || 8, 6); // Burst load up to RD 6
  const burstDistSq = burstRenderDist * burstRenderDist;

  // Sort columns by distance so closest generate first
  const burstColumns = [];
  for (let x = -burstRenderDist; x <= burstRenderDist; x++) {
    for (let z = -burstRenderDist; z <= burstRenderDist; z++) {
      const dist = x * x + z * z;
      if (dist > burstDistSq) continue; // Circular
      burstColumns.push({ x, z, dist });
    }
  }
  burstColumns.sort((a, b) => a.dist - b.dist);

  for (const col of burstColumns) {
    const cx = spawnCoords.chunkX + col.x;
    const cz = spawnCoords.chunkZ + col.z;
    const colId = `${cx},${cz}`;
    generatedColumns.add(colId);
    terrainGenerator.generateChunkData(world, cx, cz);
  }

  // Load saved chunks from DB — overwrites generated terrain with player modifications
  const chunkLoadPromises = [];
  for (let x = -burstRenderDist; x <= burstRenderDist; x++) {
    for (let z = -burstRenderDist; z <= burstRenderDist; z++) {
      if (x * x + z * z > burstDistSq) continue;
      for (let y = -1; y <= 5; y++) {
        const cx = spawnCoords.chunkX + x;
        const cy = spawnCoords.chunkY + y;
        const cz = spawnCoords.chunkZ + z;
        const cellId = `${cx},${cy},${cz}`;
        chunkLoadPromises.push(
          storage.loadChunk(worldKey, cellId).then(savedChunk => {
            if (savedChunk) {
              world.chunks.set(cellId, savedChunk);
            } else {
              // Only mark as dirty if not already saved (new terrain)
              if (world.chunks.has(cellId)) {
                world.dirtyChunks.add(cellId);
              }
            }
          }).catch(e => console.error('Chunk load error:', e))
        );
      }
    }
  }
  await Promise.all(chunkLoadPromises);

  // Build meshes after saved data is loaded
  for (let x = -burstRenderDist; x <= burstRenderDist; x++) {
    for (let z = -burstRenderDist; z <= burstRenderDist; z++) {
      if (x * x + z * z > burstDistSq) continue;
      for (let y = -1; y <= 5; y++) {
        chunkManager.updateCellGeometry(
          (spawnCoords.chunkX + x) * world.chunkSize,
          (spawnCoords.chunkY + y) * world.chunkSize,
          (spawnCoords.chunkZ + z) * world.chunkSize
        );
      }
    }
  }

  lastChunkId = `${spawnCoords.chunkX},${spawnCoords.chunkY},${spawnCoords.chunkZ}`;

  // Start playing
  uiManager.startGame();
}

// Wire UI callbacks
uiManager.onWorldSelected = (selectedWorldId, seed) => {
  startWorld(selectedWorldId, seed);
};

uiManager.onWorldCreated = async (name, seed) => {
  const newWorld = await storage.createWorld(name, seed);
  await refreshWorldList();
  // Auto-start the new world
  startWorld(newWorld.id, newWorld.seed);
};

uiManager.onWorldDeleted = async (selectedWorldId) => {
  await storage.deleteWorld(selectedWorldId);
  await refreshWorldList();
};

uiManager.onQuitToTitle = async () => {
  await saveWorldState();
  // Disconnect multiplayer — this kicks all connected peers
  if (peerManager.isConnected) peerManager.disconnect();
  worldKey = null;
  await refreshWorldList();
};

// Load world list on startup
refreshWorldList();

// Death + Respawn
window.addEventListener('player-death', () => {
  audioSystem.playDeath();
  document.exitPointerLock();

  for (let i = 0; i < inventory.slots.length; i++) {
    const slot = inventory.slots[i];
    if (slot) {
      entityManager.addDroppedItem(slot.id, slot.count, player.position.clone());
      inventory.slots[i] = null;
    }
  }
  inventoryUI.render();
  uiManager.showDeathScreen();

  // Broadcast death to other players
  if (peerManager.isConnected) peerManager.sendPlayerDeath();
});

uiManager.onRespawn = () => {
  player.respawn();
  inventory.slots[0] = { id: Blocks.DIRT, count: 64 };
  inventory.slots[1] = { id: Blocks.STONE, count: 64 };
  inventory.slots[2] = { id: Blocks.WOOD, count: 64 };
  inventoryUI.render();

  // Broadcast respawn to other players
  if (peerManager.isConnected) peerManager.sendPlayerRespawn(player.position);
};

inputManager.onPointerLockLost = () => {
  // Don't show pause menu if chat is open (chat will handle it)
  if (typeof chatOpen !== 'undefined' && chatOpen) return;
  uiManager.handlePointerLockLost();
  saveWorldState();
};

uiManager.onStartGame = () => {
  if (!inputManager.isLocked) {
    renderer.domElement.requestPointerLock();
  }
};

// Helper to update chunks after voxel change
function updateVoxelGeometry(x, y, z) {
  const updatedChunkIds = new Set();
  const addChunk = (cx, cy, cz) => {
    const chunkId = world.computeChunkId(cx, cy, cz);
    if (!updatedChunkIds.has(chunkId)) {
      updatedChunkIds.add(chunkId);
      chunkManager.updateCellGeometry(cx, cy, cz);
    }
  };
  addChunk(x, y, z);
  addChunk(x - 1, y, z);
  addChunk(x + 1, y, z);
  addChunk(x, y - 1, z);
  addChunk(x, y + 1, z);
  addChunk(x, y, z - 1);
  addChunk(x, y, z + 1);
}

let activeIntersection = null;

// Mining state
let isMining = false;
let miningProgress = 0;
let miningTarget = null; // { x, y, z, blockId }
let isLeftMouseDown = false;
const miningProgressEl = document.getElementById('mining-progress');
const miningProgressBar = document.getElementById('mining-progress-bar');

// Lava damage
let lavaDamageTimer = 0;

// Mining crack overlay
let crackOverlayMesh = null;
const crackTextures = [];

// Pre-generate 10 crack stage textures as standalone canvases
for (let stage = 0; stage < 10; stage++) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  // Transparent background
  ctx.clearRect(0, 0, 32, 32);
  // Draw cracks — more lines and thicker at higher stages
  ctx.strokeStyle = `rgba(0,0,0,${0.3 + stage * 0.07})`;
  ctx.lineWidth = 1 + Math.floor(stage / 4);
  const numCracks = 2 + stage * 2;
  for (let i = 0; i < numCracks; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * 32, Math.random() * 32);
    ctx.lineTo(Math.random() * 32, Math.random() * 32);
    if (stage > 3) ctx.lineTo(Math.random() * 32, Math.random() * 32);
    if (stage > 6) ctx.lineTo(Math.random() * 32, Math.random() * 32);
    ctx.stroke();
  }
  // Darken overall
  ctx.fillStyle = `rgba(0,0,0,${stage * 0.03})`;
  ctx.fillRect(0, 0, 32, 32);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  crackTextures.push(tex);
}

function createCrackOverlay() {
  const geo = new THREE.BoxGeometry(1.006, 1.006, 1.006);
  const mat = new THREE.MeshBasicMaterial({
    map: crackTextures[0],
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}

function updateCrackStage(mesh, stage) {
  mesh.material.map = crackTextures[stage];
  mesh.material.needsUpdate = true;
}

function getMineSpeed(blockId) {
  const hardness = getBlockHardness(blockId);
  if (hardness < 0) return 0; // unbreakable (bedrock)
  if (hardness <= 0) return 99; // instant break (flowers, torches)

  const activeItem = inventory.getActiveItem();
  const toolData = activeItem ? getToolData(activeItem.id) : null;
  const blockDef = BlockRegistry[blockId];

  let speed = 1.0; // base speed
  if (toolData && blockDef && toolData.type === blockDef.bestTool) {
    speed = 1.0 + toolData.tier * 2.0; // Correct tool: 3x to 9x faster
  }

  return speed / hardness;
}

// Block change log for multiplayer — records all block modifications
// Uses a Map keyed by "x,y,z" for automatic deduplication (only latest change kept)
// This stays bounded: N unique positions modified, not N total modifications
let blockChangeMap = new Map(); // key: "x,y,z", value: blockId

function addBlockChange(x, y, z, blockId) {
  blockChangeMap.set(`${x},${y},${z}`, blockId);
}

function getBlockChangeLog() {
  // Convert map to array for replay/save
  const log = [];
  for (const [key, blockId] of blockChangeMap) {
    const [x, y, z] = key.split(',').map(Number);
    log.push({ x, y, z, blockId });
  }
  return log;
}

function getAdjacentChests(x, y, z) {
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  const chests = [];
  for (const [dx, dy, dz] of dirs) {
    const id = world.getVoxel(x + dx, y + dy, z + dz);
    if (id === Blocks.CHEST || id === Blocks.CHEST_OPEN) {
      chests.push({ x: x + dx, y: y + dy, z: z + dz });
    }
  }
  return chests;
}

// Pending block changes from host replay — deferred until terrain is generated
// Map<colId, Array<{x, y, z, blockId}>>
let pendingBlockChanges = new Map();

function breakBlock(px, py, pz) {
  const blockId = world.getVoxel(px, py, pz);
  if (!blockId) return;

  if (blockId === Blocks.TORCH) {
    lightingManager.removeTorch(px, py, pz);
    particleSystem.removeTorchEmitter(px, py, pz);
  }

  let actualDropId = blockId;
  let otherY = py;

  if (blockId === Blocks.OAK_DOOR_TOP || blockId === Blocks.OAK_DOOR_TOP_OPEN) {
    actualDropId = Blocks.OAK_DOOR;
    otherY = py - 1;
  } else if (blockId === Blocks.OAK_DOOR || blockId === Blocks.OAK_DOOR_BOTTOM_OPEN) {
    actualDropId = Blocks.OAK_DOOR;
    otherY = py + 1;
  } else if (blockId === Blocks.TRAPDOOR_OPEN) {
    actualDropId = Blocks.TRAPDOOR;
  }

  if (otherY !== py) {
    const otherId = world.getVoxel(px, otherY, pz);
    if (otherId === Blocks.OAK_DOOR || otherId === Blocks.OAK_DOOR_BOTTOM_OPEN || otherId === Blocks.OAK_DOOR_TOP || otherId === Blocks.OAK_DOOR_TOP_OPEN) {
      world.setVoxel(px, otherY, pz, 0, true, true);
      updateVoxelGeometry(px, otherY, pz);
      addBlockChange(px, otherY, pz, 0);
      if (peerManager.isConnected) peerManager.sendBlockChange(px, otherY, pz, 0);
    }
  }

  world.setVoxel(px, py, pz, 0, true, true);
  audioSystem.playBlockBreak();
  particleSystem.emitBlockBreak(px, py, pz, blockId);
  updateVoxelGeometry(px, py, pz);
  // Always log block changes for multiplayer sync (even before hosting)
  addBlockChange(px, py, pz, 0);
  if (peerManager.isConnected) {
    peerManager.sendBlockChange(px, py, pz, 0);
    peerManager.sendSoundEffect('break', px, py, pz);
  }

  if (blockId === Blocks.CHEST || blockId === Blocks.CHEST_OPEN) {
    if (blockId === Blocks.CHEST_OPEN) inventoryUI.closeUI();
    const chestId = `${px},${py},${pz}`;
    if (window.chestInventories && window.chestInventories.has(chestId)) {
      const inv = window.chestInventories.get(chestId);
      for (const item of inv) {
        if (item && item.count > 0) {
          const blockCenter = new THREE.Vector3(px + 0.5, py + 0.5, pz + 0.5);
          const vel = new THREE.Vector3((Math.random() - 0.5) * 5, 3, (Math.random() - 0.5) * 5);
          entityManager.addDroppedItem(item.id, item.count, blockCenter, vel);
          if (peerManager.isConnected && peerManager.isHost) {
            peerManager.sendItemDrop(item.id, item.count, blockCenter.x, blockCenter.y, blockCenter.z);
          }
        }
      }
      window.chestInventories.delete(chestId);
      if (typeof worldKey !== 'undefined') {
        storage.saveChest(worldKey, chestId, null);
      }
    }
  }

  if (blockId !== Blocks.BEDROCK && blockId !== Blocks.LAVA) {
    // Eject item towards player to prevent clipping into ceiling blocks
    const blockCenter = new THREE.Vector3(px + 0.5, py + 0.5, pz + 0.5);
    const playerHead = player.position.clone();
    playerHead.y += 1.6; // aim for head

    const ejectDir = new THREE.Vector3().subVectors(playerHead, blockCenter).normalize();
    const ejectVel = new THREE.Vector3(ejectDir.x * 4, Math.max(2, ejectDir.y * 5), ejectDir.z * 4);

    entityManager.addDroppedItem(actualDropId, 1, blockCenter, ejectVel);
    // HOST: broadcast item drop to peers
    if (peerManager.isConnected && peerManager.isHost) {
      peerManager.sendItemDrop(actualDropId, 1, blockCenter.x, blockCenter.y, blockCenter.z);
    }
  }

  // Damage tool durability
  const toolBroke = inventory.damageActiveTool();
  if (toolBroke) {
    audioSystem.playBlockBreak(); // Tool break sound
  }
  inventoryUI.updateHotbar();
}

function stopMining() {
  isMining = false;
  miningProgress = 0;
  miningTarget = null;
  miningProgressEl.classList.add('hidden');
  miningProgressBar.style.width = '0%';
  if (crackOverlayMesh) crackOverlayMesh.visible = false;
}

window.addEventListener('mousedown', (e) => {
  audioSystem.init(); // Initialize audio context on first user interaction

  if (!inputManager.isLocked || inventoryUI.isOpen) return;

  if (e.button === 0) { // Left click: Attack Mob or start mining
    isLeftMouseDown = true;

    // Check mobs first
    entityRaycaster.setFromCamera(_rayOrigin, camera);
    const mobMeshes = entityManager.entities.filter(m => m.mesh).map(m => m.mesh);
    const entityIntersects = entityRaycaster.intersectObjects(mobMeshes, true);

    for (const hit of entityIntersects) {
      const hitMob = entityManager.entities.find(mob => mob.mesh === hit.object || mob.mesh.children.includes(hit.object) || mob.mesh.children.some(c => c.children.includes(hit.object)));
      if (hitMob) {
        const dist = hitMob.mesh.position.distanceTo(player.position);
        if (dist < 5 && playerAttackCooldown <= 0) {
          playerAttackCooldown = 0.4; // Attack cooldown

          // Damage based on held weapon
          const activeItem = inventory.getActiveItem();
          const toolData = activeItem ? getToolData(activeItem.id) : null;
          let damage = toolData ? toolData.damage : 1;

          // Critical hit: 1.5x damage when falling
          const isCritical = player.velocity.y < -1 && !player.isGrounded;
          if (isCritical) {
            damage = Math.ceil(damage * 1.5);
          }

          hitMob.takeDamage(damage);
          audioSystem.playHit();

          // Knockback
          const kbDir = new THREE.Vector3().subVectors(hitMob.mesh.position, player.position);
          kbDir.y = 0;
          if (kbDir.lengthSq() < 0.01) { kbDir.set(Math.random() - 0.5, 0, Math.random() - 0.5); }
          kbDir.normalize();

          const kbForce = isCritical ? 14 : 10;
          hitMob.velocity.x = kbDir.x * kbForce;
          hitMob.velocity.y = isCritical ? 10 : 8;
          hitMob.velocity.z = kbDir.z * kbForce;
          hitMob.knockbackTimer = 0.5;
          return;
        }
      }
    }

    // --- PvP: Check remote player meshes ---
    if (peerManager.isConnected && playerAttackCooldown <= 0) {
      const playerMeshArray = Array.from(remotePlayerMeshes.values()).filter(m => m.visible);
      const pvpIntersects = entityRaycaster.intersectObjects(playerMeshArray, true);
      for (const hit of pvpIntersects) {
        // Find which remote player was hit
        let hitPlayerId = null;
        for (const [id, mesh] of remotePlayerMeshes) {
          if (mesh === hit.object || mesh.children.includes(hit.object)
            || mesh.children.some(c => c === hit.object || c.children?.includes(hit.object))) {
            hitPlayerId = id;
            break;
          }
        }
        if (hitPlayerId) {
          const hitMesh = remotePlayerMeshes.get(hitPlayerId);
          const dist = hitMesh.position.distanceTo(player.position);
          if (dist < 5) {
            playerAttackCooldown = 0.4;

            const activeItem = inventory.getActiveItem();
            const toolData = activeItem ? getToolData(activeItem.id) : null;
            let damage = toolData ? toolData.damage : 1;
            const isCritical = player.velocity.y < -1 && !player.isGrounded;
            if (isCritical) damage = Math.ceil(damage * 1.5);

            audioSystem.playHit();

            // Calculate knockback direction
            const kbDir = new THREE.Vector3().subVectors(hitMesh.position, player.position);
            kbDir.y = 0;
            if (kbDir.lengthSq() < 0.01) { kbDir.set(Math.random() - 0.5, 0, Math.random() - 0.5); }
            kbDir.normalize();
            const kbForce = isCritical ? 14 : 10;

            // Send hit to the target player
            peerManager.sendPlayerHit(hitPlayerId, damage, {
              x: kbDir.x * kbForce,
              y: isCritical ? 10 : 8,
              z: kbDir.z * kbForce,
            }, isCritical);

            // Visual feedback: flash red using hitFlashTimer (auto-restored in animate loop)
            hitMesh.traverse(child => {
              if (child.isMesh && child.material) {
                child.material.color.setHex(0xff3333);
              }
            });
            hitMesh.userData.hitFlashTimer = 0.2; // 200ms flash
            hitMesh.userData.punchTimer = 0; // reset their punch if any

            // Durability damage on weapon
            if (activeItem && toolData) {
              activeItem.durability = (activeItem.durability ?? toolData.durability) - 1;
              if (activeItem.durability <= 0) {
                inventory.slots[inventory.activeSlot] = null;
              }
              inventoryUI.render();
            }
            return;
          }
        }
      }
    }

    // Start mining the targeted block
    if (activeIntersection) {
      const px = activeIntersection.position.x;
      const py = activeIntersection.position.y;
      const pz = activeIntersection.position.z;
      const blockId = world.getVoxel(px, py, pz);

      if (blockId && getBlockHardness(blockId) >= 0) {
        const speed = getMineSpeed(blockId);
        if (speed >= 20) {
          // Instant break (hardness 0 blocks like torch, flowers, grass)
          breakBlock(px, py, pz);
        } else {
          // Start mining timer
          isMining = true;
          miningProgress = 0;
          miningTarget = { x: px, y: py, z: pz, blockId };
          miningProgressEl.classList.remove('hidden');
        }
      }
    }
  } else if (e.button === 2) { // Right click: Place or Eat
    if (activeIntersection) {
      // Interactive Blocks Support
      const targetBlockId = world.getVoxel(activeIntersection.position.x, activeIntersection.position.y, activeIntersection.position.z);
      if (targetBlockId === Blocks.CRAFTING_TABLE) {
        inventoryUI.openCraftingTable();
        return;
      } else if (targetBlockId === Blocks.FURNACE) {
        inventoryUI.openFurnace();
        return;
      } else if (targetBlockId === Blocks.CHEST || targetBlockId === Blocks.CHEST_OPEN) {
        const tx = activeIntersection.position.x;
        const ty = activeIntersection.position.y;
        const tz = activeIntersection.position.z;
        const adj = getAdjacentChests(tx, ty, tz);
        const pos1 = { x: tx, y: ty, z: tz };
        const pos2 = adj.length > 0 ? adj[0] : null;

        const positionsToAnimate = [pos1];
        if (pos2 && world.getVoxel(pos2.x, pos2.y, pos2.z) === targetBlockId) {
          positionsToAnimate.push(pos2);
        }

        if (targetBlockId === Blocks.CHEST) {
          playChestAnimation(positionsToAnimate, true, () => {
            positionsToAnimate.forEach(pos => {
              world.setVoxel(pos.x, pos.y, pos.z, Blocks.CHEST_OPEN, true, true);
              addBlockChange(pos.x, pos.y, pos.z, Blocks.CHEST_OPEN);
              if (peerManager.isConnected) peerManager.sendBlockChange(pos.x, pos.y, pos.z, Blocks.CHEST_OPEN);
              updateVoxelGeometry(pos.x, pos.y, pos.z);
            });
          });
        }

        inventoryUI.openChest(pos1, pos2);
        return;
      } else if (targetBlockId === Blocks.OAK_DOOR || targetBlockId === Blocks.OAK_DOOR_BOTTOM_OPEN ||
        targetBlockId === Blocks.OAK_DOOR_TOP || targetBlockId === Blocks.OAK_DOOR_TOP_OPEN ||
        targetBlockId === Blocks.TRAPDOOR || targetBlockId === Blocks.TRAPDOOR_OPEN) {

        const tx = activeIntersection.position.x;
        const ty = activeIntersection.position.y;
        const tz = activeIntersection.position.z;

        let newTargetId = targetBlockId;
        let otherY = ty;
        let newOtherId = targetBlockId;

        if (targetBlockId === Blocks.OAK_DOOR) { newTargetId = Blocks.OAK_DOOR_BOTTOM_OPEN; otherY = ty + 1; newOtherId = Blocks.OAK_DOOR_TOP_OPEN; }
        else if (targetBlockId === Blocks.OAK_DOOR_BOTTOM_OPEN) { newTargetId = Blocks.OAK_DOOR; otherY = ty + 1; newOtherId = Blocks.OAK_DOOR_TOP; }
        else if (targetBlockId === Blocks.OAK_DOOR_TOP) { newTargetId = Blocks.OAK_DOOR_TOP_OPEN; otherY = ty - 1; newOtherId = Blocks.OAK_DOOR_BOTTOM_OPEN; }
        else if (targetBlockId === Blocks.OAK_DOOR_TOP_OPEN) { newTargetId = Blocks.OAK_DOOR_TOP; otherY = ty - 1; newOtherId = Blocks.OAK_DOOR; }
        else if (targetBlockId === Blocks.TRAPDOOR) { newTargetId = Blocks.TRAPDOOR_OPEN; }
        else if (targetBlockId === Blocks.TRAPDOOR_OPEN) { newTargetId = Blocks.TRAPDOOR; }

        world.setVoxel(tx, ty, tz, newTargetId, true, true);
        updateVoxelGeometry(tx, ty, tz);
        addBlockChange(tx, ty, tz, newTargetId);
        if (peerManager.isConnected) peerManager.sendBlockChange(tx, ty, tz, newTargetId);

        if (otherY !== ty) {
          world.setVoxel(tx, otherY, tz, newOtherId, true, true);
          updateVoxelGeometry(tx, otherY, tz);
          addBlockChange(tx, otherY, tz, newOtherId);
          if (peerManager.isConnected) peerManager.sendBlockChange(tx, otherY, tz, newOtherId);
        }

        audioSystem.playBlockPlace(); // Door/trapdoor toggling sound
        return;
      }

      const placePos = activeIntersection.position.clone().add(activeIntersection.normal);
      // Don't place inside player
      const dist = placePos.distanceTo(player.position);
      if (dist > 1.5) {
        const activeItem = inventory.getActiveItem();
        if (activeItem && activeItem.count > 0) {
          // Check if it's food - eat it instead of placing
          const itemDef = BlockRegistry[activeItem.id];
          if (itemDef && itemDef.foodRestore) {
            if (player.hunger < player.maxHunger) {
              player.hunger = Math.min(player.maxHunger, player.hunger + itemDef.foodRestore);
              player.updateHUD();
              inventory.consumeActiveItem();
              inventoryUI.render();
              audioSystem.playBlockPlace(); // Eating sound
            }
          } else {
            // Normal block placement
            if (activeItem.id === Blocks.OAK_DOOR) {
              const aboveBlock = world.getVoxel(placePos.x, placePos.y + 1, placePos.z);
              if (aboveBlock !== Blocks.AIR) {
                // Cannot place door if blocked above
                return;
              }
              world.setVoxel(placePos.x, placePos.y + 1, placePos.z, Blocks.OAK_DOOR_TOP, true, true);
              updateVoxelGeometry(placePos.x, placePos.y + 1, placePos.z);
              addBlockChange(placePos.x, placePos.y + 1, placePos.z, Blocks.OAK_DOOR_TOP);
              if (peerManager.isConnected) peerManager.sendBlockChange(placePos.x, placePos.y + 1, placePos.z, Blocks.OAK_DOOR_TOP);
            }

            if (activeItem.id === Blocks.CHEST || activeItem.id === Blocks.CHEST_OPEN) {
              const adj = getAdjacentChests(placePos.x, placePos.y, placePos.z);
              if (adj.length > 1) return; // Prevent 3-way junctions
              if (adj.length === 1) {
                const adjOfAdj = getAdjacentChests(adj[0].x, adj[0].y, adj[0].z);
                if (adjOfAdj.length > 0) return; // Prevent extending an existing double chest
              }
            }

            world.setVoxel(placePos.x, placePos.y, placePos.z, activeItem.id, true, true);

            if (activeItem.id === Blocks.TORCH) {
              lightingManager.addTorch(placePos.x, placePos.y, placePos.z);
              particleSystem.addTorchEmitter(placePos.x, placePos.y, placePos.z);
            }

            audioSystem.playBlockPlace();
            inventory.consumeActiveItem();
            inventoryUI.render();
            updateVoxelGeometry(placePos.x, placePos.y, placePos.z);
            // Always log block changes for multiplayer sync
            addBlockChange(placePos.x, placePos.y, placePos.z, activeItem.id);
            if (peerManager.isConnected) {
              peerManager.sendBlockChange(placePos.x, placePos.y, placePos.z, activeItem.id);
              peerManager.sendSoundEffect('place', placePos.x, placePos.y, placePos.z);
            }
          }
        }
      }
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    isLeftMouseDown = false;
    stopMining();
  }
});

// Terrain is generated dynamically in the animate loop

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Listen for mob attacks
window.addEventListener('mob-attack', (e) => {
  const damage = e.detail.damage;
  const mob = e.detail.mob;

  audioSystem.playHit();
  player.takeDamage(damage);

  // Slight knockback from mob
  const kbDir = new THREE.Vector3().subVectors(player.position, mob.mesh.position);
  if (kbDir.lengthSq() < 0.01) {
    kbDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
  }
  kbDir.normalize();
  player.velocity.x += kbDir.x * 10;
  player.velocity.y += 5;
  player.velocity.z += kbDir.z * 10;
});

// Handle creeper explosions
window.addEventListener('creeper-explosion', (e) => {
  const { x, y, z, radius, damage } = e.detail;

  // Update all affected chunk meshes
  for (let dx = -radius - 1; dx <= radius + 1; dx++) {
    for (let dy = -radius - 1; dy <= radius + 1; dy++) {
      for (let dz = -radius - 1; dz <= radius + 1; dz++) {
        updateVoxelGeometry(x + dx, y + dy, z + dz);
      }
    }
  }

  // Damage player based on distance
  const distToPlayer = player.position.distanceTo(new THREE.Vector3(x, y, z));
  if (distToPlayer < radius * 2) {
    const dmgFactor = 1 - (distToPlayer / (radius * 2));
    const actualDamage = Math.floor(damage * dmgFactor);
    if (actualDamage > 0) {
      player.takeDamage(actualDamage);
      audioSystem.playHit();
      // Explosion knockback
      const kbDir = new THREE.Vector3().subVectors(player.position, new THREE.Vector3(x, y, z)).normalize();
      player.velocity.x += kbDir.x * 15;
      player.velocity.y += 8;
      player.velocity.z += kbDir.z * 15;
    }
  }
});

// Attack cooldown for player melee
let playerAttackCooldown = 0;

// ---- Multiplayer (WebRTC P2P) ----
const peerManager = new PeerManager();
const remotePlayerMeshes = new Map(); // id -> THREE.Group
const _mpTempVec3 = new THREE.Vector3(); // reusable vector for lerp

// Main menu: Join controls
const mpNameInput = document.getElementById('mp-name');
const btnMpJoin = document.getElementById('btn-mp-join');
const mpRoomCodeInput = document.getElementById('mp-room-code');
const mpStatus = document.getElementById('mp-status');

// Pause menu: Host controls
const mpHostNameInput = document.getElementById('mp-host-name');
const btnMpHost = document.getElementById('btn-mp-host');
const btnMpDisconnect = document.getElementById('btn-mp-disconnect');
const mpHostControls = document.getElementById('mp-host-controls');
const mpActive = document.getElementById('mp-active');
const mpRoomDisplay = document.getElementById('mp-room-display');
const mpPeerList = document.getElementById('mp-peer-list');
const mpPauseStatus = document.getElementById('mp-pause-status');

// Host button (in pause menu): start hosting the current world
btnMpHost.addEventListener('click', () => {
  const name = mpHostNameInput.value.trim() || 'Player';
  mpPauseStatus.textContent = 'Creating room...';
  mpPauseStatus.style.color = '#ff8';
  peerManager.setWorldSeed(currentWorldSeed);
  peerManager.setWorldTime(skyManager.time);
  peerManager.hostWorld(name);
});

// Join button (in main menu): connect to a host room
btnMpJoin.addEventListener('click', () => {
  const code = mpRoomCodeInput.value.trim();
  if (!code || code.length < 4) {
    mpStatus.textContent = 'Enter a valid room code';
    mpStatus.style.color = '#f88';
    return;
  }
  const name = mpNameInput.value.trim() || 'Player';
  mpStatus.textContent = 'Connecting...';
  mpStatus.style.color = '#ff8';
  peerManager.joinWorld(code, name);
});

// Disconnect / Stop hosting
btnMpDisconnect.addEventListener('click', () => {
  peerManager.disconnect();
});

function showMpActive(roomCode) {
  mpHostControls.classList.add('hidden');
  mpActive.classList.remove('hidden');
  mpRoomDisplay.innerHTML = `<div class="room-label">Room Code (share this!)</div><div class="room-code">${roomCode}</div>`;
}

function hideMpActive() {
  mpHostControls.classList.remove('hidden');
  mpActive.classList.add('hidden');
  mpRoomDisplay.innerHTML = '';
  mpPeerList.innerHTML = '';
}

function createRemotePlayerMesh(name) {
  const group = new THREE.Group();

  // Generate unique colors based on player name hash
  function hashName(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return h >>> 0;
  }
  const nameHash = hashName(name || 'Player');
  const hue = (nameHash % 360) / 360;
  const bodyColor = new THREE.Color().setHSL(hue, 0.6, 0.4);
  const legColor = new THREE.Color().setHSL(hue, 0.4, 0.25);

  // Body (cloned materials so color changes don't bleed)
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.0;
  group.add(body);

  // Head
  const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.6;
  group.add(head);

  // Arms (each gets its own cloned material)
  const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
  const leftArm = new THREE.Mesh(armGeo, new THREE.MeshLambertMaterial({ color: bodyColor }));
  leftArm.position.set(-0.4, 1.0, 0);
  const rightArm = new THREE.Mesh(armGeo, new THREE.MeshLambertMaterial({ color: bodyColor }));
  rightArm.position.set(0.4, 1.0, 0);
  group.add(leftArm, rightArm);

  // Legs (each gets its own cloned material)
  const legGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
  const leftLeg = new THREE.Mesh(legGeo, new THREE.MeshLambertMaterial({ color: legColor }));
  leftLeg.position.set(-0.1, 0.35, 0);
  const rightLeg = new THREE.Mesh(legGeo, new THREE.MeshLambertMaterial({ color: legColor }));
  rightLeg.position.set(0.1, 0.35, 0);
  group.add(leftLeg, rightLeg);

  // Nametag (sprite)
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(name || 'Player', 128, 42);

  const tagTexture = new THREE.CanvasTexture(canvas);
  const tagMat = new THREE.SpriteMaterial({ map: tagTexture, transparent: true });
  const tagSprite = new THREE.Sprite(tagMat);
  tagSprite.scale.set(2, 0.5, 1);
  tagSprite.position.y = 2.2;
  group.add(tagSprite);

  // Store original colors for flash reset
  const origColors = new Map();
  group.traverse(child => {
    if (child.isMesh && child.material) {
      origColors.set(child, child.material.color.getHex());
    }
  });

  // Store part references for animation
  group.userData = {
    leftArm, rightArm, leftLeg, rightLeg, head,
    origColors,
    playerName: name || 'Player',
    targetPos: null,
    targetRotY: 0,
    targetPitchX: 0,
    walkTime: 0,
    isDead: false,
    hitFlashTimer: 0,
    punchTimer: 0,
  };

  return group;
}

// ---- PeerManager callbacks ----

peerManager.onRoomCreated = (roomCode) => {
  showMpActive(roomCode);
  mpPauseStatus.textContent = `Hosting — code: ${roomCode}`;
  mpPauseStatus.style.color = '#8f8';
};

peerManager.onConnected = (id) => {
  if (!peerManager.isHost) {
    // Joiner connected via main menu
    mpStatus.textContent = `Connected (${id})`;
    mpStatus.style.color = '#8f8';
    // Hide host controls in pause menu for joiners (not their world)
    mpHostControls.classList.add('hidden');
  } else {
    mpPauseStatus.textContent = `Hosting — connected`;
    mpPauseStatus.style.color = '#8f8';
  }
};

peerManager.onDisconnected = () => {
  mpPauseStatus.textContent = '';
  mpStatus.textContent = 'Disconnected';
  mpStatus.style.color = '#f88';
  hideMpActive();
  // Show host controls again (in case joiner was hiding them)
  mpHostControls.classList.remove('hidden');
  // Clean up remote player meshes
  for (const [id, mesh] of remotePlayerMeshes) {
    scene.remove(mesh);
  }
  remotePlayerMeshes.clear();

  // Clean up remote mobs
  for (const [id, entry] of remoteMobMeshes) {
    scene.remove(entry.mesh);
  }
  remoteMobMeshes.clear();

  // If we were a joiner, kick back to title
  if (!peerManager.isHost && worldKey) {
    addChatMessage('', 'Host disconnected — returning to menu', true);
    setTimeout(() => {
      uiManager.showMainMenu();
    }, 1500);
  }
};

peerManager.onError = (message) => {
  mpPauseStatus.textContent = message;
  mpPauseStatus.style.color = '#f88';
  mpStatus.textContent = message;
  mpStatus.style.color = '#f88';
};

peerManager.onPlayerJoin = (id, data) => {
  const mesh = createRemotePlayerMesh(data.name);
  // Offset Y down by 1.6 because player.position is at eye height
  mesh.position.set(data.x || 32, (data.y || 100) - 1.6, data.z || 32);
  scene.add(mesh);
  remotePlayerMeshes.set(id, mesh);
  addChatMessage('', `${data.name || id} joined the game`, true);

  // HOST: Replay block change log to the new joiner
  // Each change is a tiny message (x, y, z, blockId) — no size limit issues
  if (peerManager.isHost && blockChangeMap.size > 0) {
    // Find the peer's connection to send directly
    let targetConn = null;
    for (const [, info] of peerManager.connections) {
      if (info.id === id && info.conn?.open) {
        targetConn = info.conn;
        break;
      }
    }
    if (targetConn) {
      // Convert to array for batched sending
      const changeLog = getBlockChangeLog();
      const BATCH_SIZE = 50;
      let i = 0;
      const sendBatch = () => {
        const end = Math.min(i + BATCH_SIZE, changeLog.length);
        for (; i < end; i++) {
          const change = changeLog[i];
          targetConn.send({
            type: 'block',
            x: change.x,
            y: change.y,
            z: change.z,
            blockId: change.blockId,
          });
        }
        if (i < changeLog.length) {
          setTimeout(sendBatch, 50); // Small delay between batches
        } else {
          console.log(`[Host] Replayed ${changeLog.length} block changes to joiner ${id}`);
        }
      };
      // Delay initial send to let peer generate terrain first
      setTimeout(sendBatch, 2000);
    }
  }
};

peerManager.onPlayerLeave = (id) => {
  const playerName = peerManager.remotePlayers.get(id)?.name || id;
  const mesh = remotePlayerMeshes.get(id);
  if (mesh) {
    scene.remove(mesh);
    remotePlayerMeshes.delete(id);
  }
  addChatMessage('', `${playerName} left the game`, true);
};

peerManager.onPlayerMove = (id, data) => {
  const mesh = remotePlayerMeshes.get(id);
  if (mesh) {
    // Store target — actual interpolation happens per-frame in animate()
    const ud = mesh.userData;
    // Offset Y down by 1.6 because player.position is at eye height
    ud.targetPos = { x: data.x, y: data.y - 1.6, z: data.z };
    ud.targetRotY = data.ry || 0;
    ud.targetPitchX = data.rx || 0;
    // Arm swing flags from move message
    if (data.p) ud.punchTimer = 0.3; // punching
    if (data.m) ud.punchTimer = Math.max(ud.punchTimer, 0.15); // mining (shorter swing)
  }
};

peerManager.onBlockChange = (x, y, z, blockId) => {
  // Record block change on host for future joiners
  if (peerManager.isHost) {
    addBlockChange(x, y, z, blockId);
  }

  // Check if the chunk's column has been generated yet
  const cs = world.chunkSize;
  const colId = `${Math.floor(x / cs)},${Math.floor(z / cs)}`;
  if (!generatedColumns.has(colId)) {
    // Terrain not generated yet — defer this change
    if (!pendingBlockChanges.has(colId)) {
      pendingBlockChanges.set(colId, []);
    }
    pendingBlockChanges.get(colId).push({ x, y, z, blockId });
    return;
  }
  if (animatingChests.has(`${x},${y},${z}`)) {
    return; // Handled by group animation logic triggered earlier
  }

  // Check if we're removing a torch (old block was a torch)
  const oldBlockId = world.getVoxel(x, y, z);
  if (oldBlockId === Blocks.TORCH && blockId !== Blocks.TORCH) {
    lightingManager.removeTorch(x, y, z);
    particleSystem.removeTorchEmitter(x, y, z);
  }

  if (blockId === Blocks.CHEST_OPEN && oldBlockId === Blocks.CHEST) {
    const adj = getAdjacentChests(x, y, z);
    const pos1 = { x, y, z };
    const positionsToAnimate = [pos1];
    if (adj.length > 0) {
      const pos2 = adj[0];
      if (world.getVoxel(pos2.x, pos2.y, pos2.z) === Blocks.CHEST) positionsToAnimate.push(pos2);
    }
    playChestAnimation(positionsToAnimate, true, () => {
      positionsToAnimate.forEach(pos => {
        world.setVoxel(pos.x, pos.y, pos.z, blockId, true, true);
        updateVoxelGeometry(pos.x, pos.y, pos.z);
      });
    });
  } else if (blockId === Blocks.CHEST && oldBlockId === Blocks.CHEST_OPEN) {
    const adj = getAdjacentChests(x, y, z);
    const pos1 = { x, y, z };
    const positionsToAnimate = [pos1];
    if (adj.length > 0) {
      const pos2 = adj[0];
      if (world.getVoxel(pos2.x, pos2.y, pos2.z) === Blocks.CHEST_OPEN) positionsToAnimate.push(pos2);
    }
    playChestAnimation(positionsToAnimate, false, () => {
      positionsToAnimate.forEach(pos => {
        world.setVoxel(pos.x, pos.y, pos.z, blockId, true, true);
        updateVoxelGeometry(pos.x, pos.y, pos.z);
      });
    });
  } else {
    world.setVoxel(x, y, z, blockId, true, true);
    updateVoxelGeometry(x, y, z);
  }

  // If placing a torch, add light and particles
  if (blockId === Blocks.TORCH) {
    lightingManager.addTorch(x, y, z);
    particleSystem.addTorchEmitter(x, y, z);
  }
};

peerManager.onPeerListChanged = (list) => {
  mpPeerList.innerHTML = list.map(p => {
    const kickBtn = peerManager.isHost
      ? `<button class="mc-button-kick" onclick="window._kickPlayer('${p.id}')" title="Kick">✕</button>`
      : '';
    return `<div class="peer-entry"><span>${p.name}</span>${kickBtn}</div>`;
  }).join('');
};

// Expose kick function for inline onclick
window._kickPlayer = (assignedId) => {
  peerManager.kickPlayer(assignedId);
};

// JOINER: Receive mob states from host and display with lerp
peerManager.onMobSync = (mobStates) => {
  const seenIds = new Set();
  for (const mob of mobStates) {
    seenIds.add(mob.id);
    if (mob.d) {
      // Mob is dead — remove if exists
      const existing = remoteMobMeshes.get(mob.id);
      if (existing) {
        scene.remove(existing.mesh);
        remoteMobMeshes.delete(mob.id);
      }
      continue;
    }
    let entry = remoteMobMeshes.get(mob.id);
    if (!entry) {
      // Create new remote mob mesh (visual only, no AI)
      try {
        const mobObj = new Mob(mob.t, new THREE.Vector3(mob.x, mob.y, mob.z), scene, world);
        mobObj.mobId = mob.id;
        entry = {
          mesh: mobObj.mesh,
          mob: mobObj,
          targetPos: { x: mob.x, y: mob.y, z: mob.z },
          targetRotY: mob.ry,
        };
        remoteMobMeshes.set(mob.id, entry);
      } catch (e) {
        console.error('Error creating remote mob:', e);
        continue;
      }
    }
    // Update target for lerp
    entry.targetPos = { x: mob.x, y: mob.y, z: mob.z };
    entry.targetRotY = mob.ry;
  }
  // Remove mobs not in latest state
  for (const [id, entry] of remoteMobMeshes) {
    if (!seenIds.has(id)) {
      scene.remove(entry.mesh);
      remoteMobMeshes.delete(id);
    }
  }
};

// HOST: Peer hit a mob — apply damage
peerManager.onMobHit = (mobId, damage) => {
  const mob = entityManager.entities.find(e => e.mobId === mobId);
  if (mob && !mob.isDead) {
    mob.takeDamage(damage);
  }
};

// JOINER: Receive item drops from host and create visual dropped items
peerManager.onItemDrop = (itemId, count, x, y, z) => {
  entityManager.addDroppedItem(itemId, count, new THREE.Vector3(x, y, z));
};

// Receive remote sound effects and play them based on distance
peerManager.onRemoteSound = (sound, x, y, z) => {
  const dist = player.position.distanceTo(new THREE.Vector3(x, y, z));
  if (dist < 32) { // Only play within 32 blocks
    const volume = Math.max(0, 1 - dist / 32);
    if (sound === 'break') audioSystem.playBlockBreak(volume);
    else if (sound === 'place') audioSystem.playBlockPlace(volume);
    else if (sound === 'hit') audioSystem.playHit(volume);
  }
};

// HOST: Respond to chunk requests from peers
peerManager.onChunkRequest = (chunkIds, peerId) => {
  for (const chunkId of chunkIds) {
    const chunkData = world.chunks.get(chunkId);
    if (chunkData) {
      peerManager.sendChunkData(peerId, chunkId, chunkData);
    }
  }
};

// JOINER: Receive chunk data from host
peerManager.onChunkDataReceived = (chunkId, data) => {
  world.chunks.set(chunkId, data);

  // Mark this column as already generated so terrain generator won't overwrite it
  const parts = chunkId.split(',').map(Number);
  const colId = `${parts[0]},${parts[2]}`;
  generatedColumns.add(colId);

  // Remove from terrain queue if pending (prevents seed-generated overwrite)
  if (terrainQueueSet.has(colId)) {
    terrainQueueSet.delete(colId);
    const idx = terrainQueue.findIndex(item => item.colId === colId);
    if (idx !== -1) terrainQueue.splice(idx, 1);
  }

  // Rebuild mesh for this chunk
  chunkManager.updateCellGeometry(
    parts[0] * world.chunkSize,
    parts[1] * world.chunkSize,
    parts[2] * world.chunkSize
  );
};

// Chest Animation Logic
const animatingChests = new Map();

function buildChestPartGeometry(minX, minY, minZ, maxX, maxY, maxZ, isLid = false) {
  const positions = [], normals = [], uvs = [], indices = [], colors = [];
  const faceBrightness = [0.8, 0.8, 0.6, 1.0, 0.7, 0.9];
  world._addChestPartMesh(0, 0, 0, minX, minY, minZ, maxX, maxY, maxZ,
    positions, normals, uvs, indices, colors,
    16, 256, 256, 0.5 / 256, faceBrightness, isLid);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  return geo;
}

function playChestAnimation(positions, isOpen, callback) {
  const mainPos = positions[0];
  const chestId = `${mainPos.x},${mainPos.y},${mainPos.z}`;
  if (animatingChests.has(chestId)) {
    if (callback) callback();
    return;
  }

  // Double chest bounding box calculation
  let minX = 1 / 16, maxX = 15 / 16;
  let minZ = 1 / 16, maxZ = 15 / 16;

  // If double chest, we expand the visual bounds of the mainPos to encompass the second chest
  if (positions.length > 1) {
    const pos2 = positions[1];
    if (pos2.x > mainPos.x) maxX = 1 + 15 / 16; // Expand right
    if (pos2.x < mainPos.x) minX = -15 / 16;    // Expand left
    if (pos2.z > mainPos.z) maxZ = 1 + 15 / 16; // Expand forward
    if (pos2.z < mainPos.z) minZ = -15 / 16;    // Expand backward
  }

  const baseGeo = buildChestPartGeometry(minX, 0, minZ, maxX, 10 / 16, maxZ, false);
  const lidGeo = buildChestPartGeometry(minX, 10 / 16, minZ, maxX, 14 / 16, maxZ, true);

  const material = new THREE.MeshLambertMaterial({
    map: texture, // Uses the globally scoped 'texture' from line 51
    vertexColors: true,
    transparent: true,
    alphaTest: 0.1,
  });

  const baseMesh = new THREE.Mesh(baseGeo, material);
  const lidMesh = new THREE.Mesh(lidGeo, material);

  const lidPivot = new THREE.Group();
  // Pivot point translates to hinge location (back of the chest, so minZ)
  lidPivot.position.set(0, 10 / 16, 1 / 16);
  // Mesh geometry was generated from Y=10/16 to 14/16 and Z=minZ to maxZ. 
  // We shift it so its back edge perfectly hugs the pivot at Z=1/16.
  lidMesh.position.set(0, -10 / 16, -1 / 16);
  lidPivot.add(lidMesh);

  const group = new THREE.Group();
  group.position.set(mainPos.x, mainPos.y, mainPos.z);
  group.add(baseMesh);
  group.add(lidPivot);
  scene.add(group);

  // Hide the static voxels
  positions.forEach(pos => {
    world.setVoxel(pos.x, pos.y, pos.z, 0, false, true);
    updateVoxelGeometry(pos.x, pos.y, pos.z);
  });

  const duration = 250;
  const startTime = performance.now();
  const startRot = isOpen ? 0 : -Math.PI / 2;
  const endRot = isOpen ? -Math.PI / 2 : 0;

  lidPivot.rotation.x = startRot;
  animatingChests.set(chestId, true);
  audioSystem.playBlockPlace(); // Optional sound to simulate chest clunk

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1.0);
    const ease = Math.sin((t * Math.PI) / 2);
    lidPivot.rotation.x = startRot + (endRot - startRot) * ease;

    if (t < 1.0) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(group);
      baseGeo.dispose();
      lidGeo.dispose();
      animatingChests.delete(chestId);
      if (callback) callback();
    }
  }
  requestAnimationFrame(animate);
}

// HOST: Resolve returning peer spawn positions and inventory from saved state
peerManager.onResolvePeerSpawn = (playerName) => {
  if (_cachedPeerPositions) {
    for (const [, data] of Object.entries(_cachedPeerPositions)) {
      if (data.name === playerName) {
        const result = { x: 32, y: 100, z: 32, inventory: null };
        if (data.position) {
          result.x = data.position.x;
          result.y = data.position.y;
          result.z = data.position.z;
        }
        if (data.inventory) {
          result.inventory = data.inventory;
        }
        return result;
      }
    }
  }
  return null;
};

peerManager.onEvent = (type, payload) => {
  if (type === 'CHEST_UPDATE_SLOT') {
    const chestId = `${payload.x},${payload.y},${payload.z}`;
    if (!window.chestInventories) window.chestInventories = new Map();
    if (!window.chestInventories.has(chestId)) {
      window.chestInventories.set(chestId, new Array(27).fill(null));
    }
    const inv = window.chestInventories.get(chestId);
    inv[payload.index] = payload.item;
    if (typeof worldKey !== 'undefined') storage.saveChest(worldKey, chestId, inv);

    // Update UI if open
    if (inventoryUI.isOpen && inventoryUI.mode === 'chest' && inventoryUI.activeChestPos) {
      const activeId = `${inventoryUI.activeChestPos.x},${inventoryUI.activeChestPos.y},${inventoryUI.activeChestPos.z}`;
      if (activeId === chestId) {
        inventoryUI.render();
      }
    }
  }
};

// Cache for peer positions (loaded when hosting starts)
let _cachedPeerPositions = null;

// Load cached peer positions when hosting starts
btnMpHost.addEventListener('click', async () => {
  // Load saved peer positions for this world
  const saved = await storage.loadPlayerState(worldKey + '_peers');
  _cachedPeerPositions = saved || null;
});

// ---- Chat System ----
const chatContainer = document.getElementById('chat-container');
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
let chatOpen = false;
let chatText = '';

function addChatMessage(name, message, isSystem = false) {
  const div = document.createElement('div');
  div.className = 'chat-message' + (isSystem ? ' system-msg' : '');
  if (isSystem) {
    div.textContent = message;
  } else {
    // Escape HTML to avoid XSS
    const safeName = name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeMsg = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    div.innerHTML = `<span class="chat-name">${safeName}</span>: ${safeMsg}`;
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;

  // Fade out after 8 seconds
  setTimeout(() => {
    div.classList.add('fading');
    setTimeout(() => {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, 600);
  }, 8000);
}

function openChat() {
  chatOpen = true;
  chatText = '';
  chatInput.classList.remove('hidden');
  chatInput.value = '';
  chatContainer.classList.add('chat-active');
  // Don't exit pointer lock — we'll capture keys at the window level
}

function closeChat() {
  chatOpen = false;
  chatText = '';
  chatInput.classList.add('hidden');
  chatInput.value = '';
  chatContainer.classList.remove('chat-active');
}

// Capture ALL keydown events before anything else
window.addEventListener('keydown', (e) => {
  // If chat is open, intercept everything
  if (chatOpen) {
    e.preventDefault();
    e.stopImmediatePropagation();

    if (e.key === 'Enter') {
      const msg = chatText.trim();
      if (msg && peerManager.isConnected) {
        peerManager.sendChat(msg);
        addChatMessage(peerManager.playerName || 'You', msg);
      }
      closeChat();
    } else if (e.key === 'Escape') {
      closeChat();
    } else if (e.key === 'Backspace') {
      chatText = chatText.slice(0, -1);
      chatInput.value = chatText;
    } else if (e.key.length === 1 && chatText.length < 200) {
      // Single printable character
      chatText += e.key;
      chatInput.value = chatText;
    }
    return;
  }

  // T opens chat (only when playing, pointer locked, connected, inventory closed)
  if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.altKey) {
    if (inputManager.isLocked && peerManager.isConnected && !inventoryUI.isOpen
      && uiManager.state === 'PLAYING') {
      openChat();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
}, true); // <-- Use CAPTURE phase to intercept before InputManager

// Also intercept keyup in capture phase to prevent InputManager stale keys
window.addEventListener('keyup', (e) => {
  if (chatOpen) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

peerManager.onChatMessage = (id, name, message) => {
  addChatMessage(name, message);
};

// ---- Time Sync (joiner receives host time) ----
peerManager.onTimeSync = (time) => {
  if (!peerManager.isHost) {
    skyManager.time = time;
  }
};

// ---- Player Death/Respawn Sync ----
peerManager.onPlayerDeath = (id) => {
  const mesh = remotePlayerMeshes.get(id);
  if (mesh) {
    mesh.visible = false;
    mesh.userData.isDead = true;
  }
  addChatMessage('', `${peerManager.remotePlayers.get(id)?.name || id} died`, true);
};

peerManager.onPlayerRespawn = (id, data) => {
  const mesh = remotePlayerMeshes.get(id);
  if (mesh) {
    mesh.visible = true;
    mesh.userData.isDead = false;
    mesh.position.set(data.x || 32, (data.y || 100) - 1.6, data.z || 32);
  }
};

// Received a hit from another player — apply damage + knockback locally
peerManager.onPlayerHit = (data) => {
  const damage = data.damage || 1;
  const isCritical = data.isCritical || false;

  player.takeDamage(damage);
  audioSystem.playHit();

  // Apply knockback
  player.velocity.x += (data.kbX || 0);
  player.velocity.y += (data.kbY || 0);
  player.velocity.z += (data.kbZ || 0);

  // Camera shake for feedback
  const shakeIntensity = isCritical ? 0.15 : 0.08;
  const origRotX = camera.rotation.x;
  const origRotZ = camera.rotation.z;
  camera.rotation.x += (Math.random() - 0.5) * shakeIntensity;
  camera.rotation.z += (Math.random() - 0.5) * shakeIntensity;
  setTimeout(() => {
    camera.rotation.x = origRotX;
    camera.rotation.z = origRotZ;
  }, 100);
};

// JOINER: Receive world info (seed) from host and set up terrain
peerManager.onWorldInfo = async (seed) => {
  if (peerManager.isHost) return; // Host doesn't need this

  // Use a temporary world key (not saved to DB world list)
  // This prevents the joiner from seeing "MP:" worlds in their world list
  const tempKey = `_mp_temp_${peerManager.roomCode}`;
  await startWorld(tempKey, seed);

  // Apply saved spawn position from host
  if (peerManager.spawnPosition) {
    player.position.set(
      peerManager.spawnPosition.x,
      peerManager.spawnPosition.y,
      peerManager.spawnPosition.z
    );
  }

  // Apply saved inventory from host (returning player gets their items back)
  if (peerManager.receivedInventory) {
    for (let i = 0; i < peerManager.receivedInventory.length; i++) {
      inventory.slots[i] = peerManager.receivedInventory[i] || null;
    }
    inventoryUI.render();
  }
};

// Position sync throttle
let mpSyncTimer = 0;
let mpTimeSyncTimer = 0;
let mpInventorySyncTimer = 0;
let mpMobSyncTimer = 0;

// Remote mob display (peers only)
const remoteMobMeshes = new Map(); // mobId -> { mesh, targetPos, targetRotY, type }

let lastChunkId = '';
let lastTime = performance.now();
let lastSaveTime = performance.now();

async function saveWorldState() {
  // Only host or solo player saves world state — joiners shouldn't persist MP worlds
  if (peerManager.isConnected && !peerManager.isHost) return;
  const pState = {
    position: player.position.toArray(),
    quaternion: camera.quaternion.toArray(),
    inventory: inventory.slots
  };
  await storage.savePlayerState(worldKey, pState);

  // Save remote player positions (host only) so they can respawn correctly
  if (peerManager.isHost && peerManager.isConnected) {
    const peerPositions = {};
    for (const [id, data] of peerManager.remotePlayers) {
      peerPositions[id] = {
        name: data.name,
        position: data.position,
        rotation: data.rotation,
        inventory: data.inventory || null,
      };
    }
    await storage.savePlayerState(worldKey + '_peers', peerPositions);
  }

  const dirty = Array.from(world.dirtyChunks);
  world.dirtyChunks.clear();
  let savedCount = 0;
  for (const chunkId of dirty) {
    const chunkData = world.chunks.get(chunkId);
    if (chunkData) {
      await storage.saveChunk(worldKey, chunkId, chunkData);
      savedCount++;
    }
  }
  console.log(`Auto-saved world. Dirty chunks saved: ${savedCount}`);

  // Save block change log for multiplayer persistence
  if (blockChangeMap.size > 0) {
    await storage.savePlayerState(worldKey + '_blocklog', getBlockChangeLog());
  }
}

function animate() {
  requestAnimationFrame(animate);

  const isPaused = uiManager.state !== 'PLAYING';
  // In singleplayer: full pause (stop everything)
  // In multiplayer: keep world running (entities, remote players, sky, etc.)
  if (!worldKey) return;
  if (isPaused && !peerManager.isConnected) return; // Singleplayer pause

  const time = performance.now();
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  if (time - lastSaveTime > 10000) {
    lastSaveTime = time;
    saveWorldState();
  }

  // Use cached settings (updated on settings change)
  if (!cachedSettings) cachedSettings = uiManager.getSettings();
  const settings = cachedSettings;
  if (camera.fov !== settings.fov) {
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
  }

  skyManager.update(dt, player.position.x, player.position.z);

  // Tick Furnace
  inventory.updateFurnace(dt);
  if (inventoryUI.isOpen && inventoryUI.mode === 'furnace') {
    inventoryUI.render(); // Redraw progress bars
  }

  // Make the fog color match the sky background and scale with render distance
  scene.fog.color.copy(scene.background);
  const fogChunkDist = settings.renderDistance * world.chunkSize;
  scene.fog.near = fogChunkDist * 0.6;
  scene.fog.far = fogChunkDist * 0.95;

  if (playerAttackCooldown > 0) playerAttackCooldown -= dt;
  player.update(dt);

  // Per-frame smooth interpolation for all remote players
  for (const [, mesh] of remotePlayerMeshes) {
    const ud = mesh.userData;
    if (ud.isDead || !ud.targetPos) continue;

    // Smooth lerp toward target position (frame-rate independent)
    const lerpFactor = 1 - Math.pow(0.00001, dt); // Very smooth but responsive
    _mpTempVec3.set(ud.targetPos.x, ud.targetPos.y, ud.targetPos.z);
    mesh.position.lerp(_mpTempVec3, lerpFactor);

    // Smooth body rotation (yaw)
    const targetRot = ud.targetRotY || 0;
    let rotDiff = targetRot - mesh.rotation.y;
    while (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
    while (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
    mesh.rotation.y += rotDiff * lerpFactor;

    // Smooth head pitch (looking up/down)
    if (ud.head) {
      const pitchTarget = -(ud.targetPitchX || 0); // Negate for correct direction
      const pitchDiff = pitchTarget - ud.head.rotation.x;
      ud.head.rotation.x += pitchDiff * lerpFactor;
      // Clamp head pitch
      ud.head.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, ud.head.rotation.x));
    }

    // Walking animation based on distance to target
    const dx = ud.targetPos.x - mesh.position.x;
    const dz = ud.targetPos.z - mesh.position.z;
    const distToTarget = Math.sqrt(dx * dx + dz * dz);

    // Punch animation (overrides right arm for a short duration)
    if (ud.punchTimer > 0) {
      ud.punchTimer -= dt;
      // Quick swing down then return
      const punchProgress = 1 - (ud.punchTimer / 0.3);
      const punchAngle = punchProgress < 0.4
        ? -(punchProgress / 0.4) * 1.5     // Swing down
        : -1.5 + ((punchProgress - 0.4) / 0.6) * 1.5; // Return up
      ud.rightArm.rotation.x = punchAngle;
    }

    if (distToTarget > 0.05) {
      // Walking — animate based on time for smooth continuous animation
      ud.walkTime += dt * 10;
      const swing = Math.sin(ud.walkTime) * 0.6;
      ud.leftArm.rotation.x = swing;
      if (ud.punchTimer <= 0) ud.rightArm.rotation.x = -swing;
      ud.leftLeg.rotation.x = -swing;
      ud.rightLeg.rotation.x = swing;
    } else {
      // Idle — smoothly decay limbs back to rest
      const decay = Math.pow(0.001, dt);
      ud.leftArm.rotation.x *= decay;
      if (ud.punchTimer <= 0) ud.rightArm.rotation.x *= decay;
      ud.leftLeg.rotation.x *= decay;
      ud.rightLeg.rotation.x *= decay;
    }

    // Hit flash timer — restore original colors when timer expires
    if (ud.hitFlashTimer > 0) {
      ud.hitFlashTimer -= dt;
      if (ud.hitFlashTimer <= 0 && ud.origColors) {
        mesh.traverse(child => {
          if (child.isMesh && child.material && ud.origColors.has(child)) {
            child.material.color.setHex(ud.origColors.get(child));
          }
        });
      }
    }
  }

  // In multiplayer, only host runs mob AI/spawning. Peers skip entirely.
  if (!peerManager.isConnected || peerManager.isHost) {
    entityManager.update(dt, player, inventory, audioSystem);
  }

  // Per-frame smooth interpolation for remote mobs (peers only)
  if (peerManager.isConnected && !peerManager.isHost) {
    const mobLerpFactor = 1 - Math.pow(0.001, dt);
    for (const [, entry] of remoteMobMeshes) {
      if (entry.targetPos) {
        _mpTempVec3.set(entry.targetPos.x, entry.targetPos.y, entry.targetPos.z);
        entry.mesh.position.lerp(_mpTempVec3, mobLerpFactor);
      }
      // Smooth rotation
      if (entry.targetRotY !== undefined) {
        let rotDiff = entry.targetRotY - entry.mesh.rotation.y;
        while (rotDiff > Math.PI) rotDiff -= 2 * Math.PI;
        while (rotDiff < -Math.PI) rotDiff += 2 * Math.PI;
        entry.mesh.rotation.y += rotDiff * mobLerpFactor;
      }
    }
  }
  if (inventoryDirty) {
    inventoryDirty = false;
    inventoryUI.render();
  }
  particleSystem.update(dt);

  // Lava damage check
  lavaDamageTimer += dt;
  if (lavaDamageTimer >= 0.5) {
    lavaDamageTimer = 0;
    const feetY = Math.floor(player.position.y - 0.5);
    const headY = Math.floor(player.position.y + 0.5);
    const px = Math.floor(player.position.x);
    const pz = Math.floor(player.position.z);
    const feetBlock = world.getVoxel(px, feetY, pz);
    const bodyBlock = world.getVoxel(px, headY, pz);
    if (feetBlock === Blocks.LAVA || bodyBlock === Blocks.LAVA) {
      player.takeDamage(2);
      audioSystem.playHit();
    }
  }

  // Multiplayer position sync (10 times per second)
  if (peerManager.isConnected) {
    mpSyncTimer += dt;
    if (mpSyncTimer >= 0.05) { // 20Hz for smoother movement
      mpSyncTimer = 0;
      peerManager.sendPosition(player.position, { x: camera.rotation.x, y: camera.rotation.y }, {
        punching: playerAttackCooldown > 0,
        mining: isMining,
      });
    }

    // Host: mob sync at 5Hz
    if (peerManager.isHost) {
      mpMobSyncTimer += dt;
      if (mpMobSyncTimer >= 0.2) {
        mpMobSyncTimer = 0;
        peerManager.sendMobSync(entityManager.getMobStates());
      }
    }

    // Host: time sync every 5 seconds
    if (peerManager.isHost) {
      mpTimeSyncTimer += dt;
      if (mpTimeSyncTimer >= 5.0) {
        mpTimeSyncTimer = 0;
        peerManager.setWorldTime(skyManager.time);
        peerManager.sendTimeSync(skyManager.time);
      }
    }

    // Joiner: send inventory sync to host every 10 seconds
    if (!peerManager.isHost) {
      mpInventorySyncTimer += dt;
      if (mpInventorySyncTimer >= 10.0) {
        mpInventorySyncTimer = 0;
        peerManager.sendInventorySync(inventory.slots);
      }
    }
  }

  // Raycasting
  _forwardVec.copy(_zAxis).applyQuaternion(camera.quaternion);
  activeIntersection = raycaster.intersectRay(camera.position, _forwardVec, 5);
  highlight.update(activeIntersection);

  // Mining progress
  if (isMining && isLeftMouseDown && miningTarget) {
    // Check if we're still looking at the same block
    if (activeIntersection &&
      activeIntersection.position.x === miningTarget.x &&
      activeIntersection.position.y === miningTarget.y &&
      activeIntersection.position.z === miningTarget.z) {
      const speed = getMineSpeed(miningTarget.blockId);
      miningProgress += speed * dt;
      miningProgressBar.style.width = `${Math.min(miningProgress * 100, 100)}%`;

      // Update crack overlay
      if (!crackOverlayMesh) crackOverlayMesh = createCrackOverlay();
      const stage = Math.min(9, Math.floor(miningProgress * 10));
      crackOverlayMesh.position.set(miningTarget.x + 0.5, miningTarget.y + 0.5, miningTarget.z + 0.5);
      updateCrackStage(crackOverlayMesh, stage);
      crackOverlayMesh.visible = true;

      if (miningProgress >= 1.0) {
        breakBlock(miningTarget.x, miningTarget.y, miningTarget.z);
        stopMining();
      }
    } else {
      // Player looked away, reset mining
      stopMining();
    }
  } else if (crackOverlayMesh) {
    crackOverlayMesh.visible = false;
  }

  // Infinite terrain logic
  const coords = world.computeChunkCoordinates(camera.position.x, camera.position.y, camera.position.z);
  const currentChunkId = `${coords.chunkX},${coords.chunkY},${coords.chunkZ}`;
  const renderDist = settings.renderDistance;

  if (currentChunkId !== lastChunkId) {
    lastChunkId = currentChunkId;

    // Queue terrain generation for columns we haven't seen (circular)
    const renderDistSq = renderDist * renderDist;
    for (let x = -renderDist; x <= renderDist; x++) {
      for (let z = -renderDist; z <= renderDist; z++) {
        const dist = x * x + z * z;
        if (dist > renderDistSq) continue; // Circular: skip corners
        const cx = coords.chunkX + x;
        const cz = coords.chunkZ + z;
        const colId = `${cx},${cz}`;
        if (!generatedColumns.has(colId) && !terrainQueueSet.has(colId)) {
          terrainQueue.push({ cx, cz, colId, dist });
          terrainQueueSet.add(colId);
        }
      }
    }
    // Sort so closest are at the end (popped first)
    terrainQueue.sort((a, b) => b.dist - a.dist);

    // Queue DB loads — Y clamped to terrain range, circular XZ
    const yMin = Math.max(-1, coords.chunkY - renderDist);
    const yMax = Math.min(5, coords.chunkY + renderDist);
    for (let x = -renderDist; x <= renderDist; x++) {
      for (let z = -renderDist; z <= renderDist; z++) {
        const xzDist = x * x + z * z;
        if (xzDist > renderDistSq) continue; // Circular: skip corners
        for (let cy = yMin; cy <= yMax; cy++) {
          const cx = coords.chunkX + x;
          const cz = coords.chunkZ + z;
          const cellId = `${cx},${cy},${cz}`;

          if (!chunkManager.meshes.has(cellId) && !activeChunkRequests.has(cellId) && !chunkLoadQueueSet.has(cellId)) {
            const y = cy - coords.chunkY;
            const dist = xzDist + y * y;
            chunkLoadQueue.push({ cx, cy, cz, cellId, dist });
            chunkLoadQueueSet.add(cellId);
          }
        }
      }
    }
    // Sort so closest are at the end
    chunkLoadQueue.sort((a, b) => b.dist - a.dist);

    // Only cleanup/manage visibility on chunk boundary change
    chunkManager.updateVisibleChunks(camera.position, renderDist);
  }

  // Process at most 1 terrain column per frame to prevent FPS drops
  if (terrainQueue.length > 0) {
    const item = terrainQueue.pop();
    terrainQueueSet.delete(item.colId);
    if (!generatedColumns.has(item.colId)) {
      generatedColumns.add(item.colId);

      terrainGenerator.generateChunkData(world, item.cx, item.cz);

      // Apply any pending block changes for this column (from host replay)
      const pendingColId = `${item.cx},${item.cz}`;
      if (pendingBlockChanges.has(pendingColId)) {
        const changes = pendingBlockChanges.get(pendingColId);
        for (const change of changes) {
          world.setVoxel(change.x, change.y, change.z, change.blockId, true, true);
        }
        pendingBlockChanges.delete(pendingColId);
      }

      // Queue neighbor mesh rebuilds for this column's chunks
      // Instead of copying all chunk keys, directly check which Y-level chunks
      // were created and rebuild their neighbors
      const cs = world.chunkSize;
      const maxChunkY = Math.ceil(140 / cs); // Max terrain height / chunk size
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (let cy = 0; cy <= maxChunkY; cy++) {
        const chunkId = `${item.cx},${cy},${item.cz}`;
        if (world.chunks.has(chunkId)) {
          for (const [dx, dy, dz] of dirs) {
            const neighborId = `${item.cx + dx},${cy + dy},${item.cz + dz}`;
            if (chunkManager.meshes.has(neighborId)) {
              pendingMeshRebuilds.add(neighborId);
            }
          }
        }
      }
    }
  }

  // Process DB load queue — only START async loads, don't block
  // Limit concurrent async loads to avoid flooding
  const MAX_CONCURRENT_LOADS = 8;
  let activeCount = activeChunkRequests.size;
  while (chunkLoadQueue.length > 0 && activeCount < MAX_CONCURRENT_LOADS) {
    const item = chunkLoadQueue.pop();
    chunkLoadQueueSet.delete(item.cellId);
    if (!chunkManager.meshes.has(item.cellId) && !activeChunkRequests.has(item.cellId)) {
      activeChunkRequests.add(item.cellId);
      activeCount++;

      storage.loadChunk(worldKey, item.cellId).then(savedChunk => {
        if (savedChunk) {
          world.chunks.set(item.cellId, savedChunk);
        }
        // Only queue mesh rebuild if we actually have chunk data
        // (either from DB or from terrain worker that already ran)
        if (world.chunks.has(item.cellId)) {
          pendingMeshRebuilds.add(item.cellId);
        }
        activeChunkRequests.delete(item.cellId);
      }).catch(e => {
        console.error(e);
        activeChunkRequests.delete(item.cellId);
      });
    }
  }

  // Process pending mesh rebuilds — cap per frame to prevent stuttering
  if (pendingMeshRebuilds.size > 0) {
    const toRemove = [];
    let meshDispatchCount = 0;
    const MAX_MESH_DISPATCHES = 4;
    for (const cellId of pendingMeshRebuilds) {
      if (meshDispatchCount >= MAX_MESH_DISPATCHES) break;
      const parts = cellId.split(',').map(Number);
      const dispatched = chunkManager.updateCellGeometryAsync(
        parts[0] * world.chunkSize, parts[1] * world.chunkSize, parts[2] * world.chunkSize
      );
      if (dispatched) {
        toRemove.push(cellId);
        meshDispatchCount++;
      } else break; // Workers full, try again next frame
    }
    for (const id of toRemove) {
      pendingMeshRebuilds.delete(id);
    }
  }

  debugOverlay.update(player, world, camera);

  // Update torch light assignments — throttled to every 5 frames
  lightUpdateCounter++;
  if (lightUpdateCounter >= 5) {
    lightUpdateCounter = 0;
    lightingManager.updateLights(player.position.x, player.position.y, player.position.z);
  }

  // Frustum cull chunks — hides meshes behind the camera to reduce draw calls
  chunkManager.cullChunks(camera, player.position);

  renderer.render(scene, camera);
}

animate();
