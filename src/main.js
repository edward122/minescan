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
import { AudioSystem } from './audio/AudioSystem.js';
import { UIManager } from './ui/UIManager.js';
import { DebugOverlay } from './ui/DebugOverlay.js';
import { StorageManager } from './persistence/StorageManager.js';
import { ParticleSystem } from './fx/ParticleSystem.js';
import { NetworkManager } from './network/NetworkManager.js';

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

const audioSystem = new AudioSystem();
player.audioSystem = audioSystem;

const uiManager = new UIManager(inputManager);
inventoryUI.uiManager = uiManager;
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

  // Pre-generate terrain around spawn/player
  const spawnCoords = world.computeChunkCoordinates(player.position.x, player.position.y, player.position.z);
  const initRenderDist = 3;
  for (let x = -initRenderDist; x <= initRenderDist; x++) {
    for (let z = -initRenderDist; z <= initRenderDist; z++) {
      const cx = spawnCoords.chunkX + x;
      const cz = spawnCoords.chunkZ + z;
      const colId = `${cx},${cz}`;
      generatedColumns.add(colId);
      terrainGenerator.generateChunkData(world, cx, cz);
    }
  }

  // Load saved chunks from DB — overwrites generated terrain with player modifications
  const chunkLoadPromises = [];
  for (let x = -initRenderDist; x <= initRenderDist; x++) {
    for (let y = -1; y <= 4; y++) {
      for (let z = -initRenderDist; z <= initRenderDist; z++) {
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
  for (let x = -initRenderDist; x <= initRenderDist; x++) {
    for (let y = -1; y <= 4; y++) {
      for (let z = -initRenderDist; z <= initRenderDist; z++) {
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
});

uiManager.onRespawn = () => {
  player.respawn();
  inventory.slots[0] = { id: Blocks.DIRT, count: 64 };
  inventory.slots[1] = { id: Blocks.STONE, count: 64 };
  inventory.slots[2] = { id: Blocks.WOOD, count: 64 };
  inventoryUI.render();
};

inputManager.onPointerLockLost = () => {
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

function breakBlock(px, py, pz) {
  const blockId = world.getVoxel(px, py, pz);
  if (!blockId) return;

  if (blockId === Blocks.TORCH) {
    lightingManager.removeTorch(px, py, pz);
    particleSystem.removeTorchEmitter(px, py, pz);
  }

  world.setVoxel(px, py, pz, 0, true, true);
  audioSystem.playBlockBreak();
  particleSystem.emitBlockBreak(px, py, pz, blockId);
  updateVoxelGeometry(px, py, pz);
  if (networkManager.isConnected) networkManager.sendBlockChange(px, py, pz, 0);

  if (blockId !== Blocks.BEDROCK && blockId !== Blocks.LAVA) {
    // Eject item towards player to prevent clipping into ceiling blocks
    const blockCenter = new THREE.Vector3(px + 0.5, py + 0.5, pz + 0.5);
    const playerHead = player.position.clone();
    playerHead.y += 1.6; // aim for head

    const ejectDir = new THREE.Vector3().subVectors(playerHead, blockCenter).normalize();
    const ejectVel = new THREE.Vector3(ejectDir.x * 4, Math.max(2, ejectDir.y * 5), ejectDir.z * 4);

    entityManager.addDroppedItem(blockId, 1, blockCenter, ejectVel);
  }
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
            world.setVoxel(placePos.x, placePos.y, placePos.z, activeItem.id, true, true);

            if (activeItem.id === Blocks.TORCH) {
              lightingManager.addTorch(placePos.x, placePos.y, placePos.z);
              particleSystem.addTorchEmitter(placePos.x, placePos.y, placePos.z);
            }

            audioSystem.playBlockPlace();
            inventory.consumeActiveItem();
            inventoryUI.render();
            updateVoxelGeometry(placePos.x, placePos.y, placePos.z);
            if (networkManager.isConnected) networkManager.sendBlockChange(placePos.x, placePos.y, placePos.z, activeItem.id);
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

// ---- Multiplayer ----
const networkManager = new NetworkManager();
const remotePlayerMeshes = new Map(); // id -> THREE.Group

const mpServerInput = document.getElementById('mp-server');
const mpNameInput = document.getElementById('mp-name');
const btnMpConnect = document.getElementById('btn-mp-connect');
const btnMpDisconnect = document.getElementById('btn-mp-disconnect');
const mpStatus = document.getElementById('mp-status');

btnMpConnect.addEventListener('click', () => {
  const url = mpServerInput.value.trim() || 'ws://localhost:8080';
  const name = mpNameInput.value.trim() || 'Player';
  mpStatus.textContent = 'Connecting...';
  mpStatus.style.color = '#ff8';
  networkManager.connect(url, name);
});

btnMpDisconnect.addEventListener('click', () => {
  networkManager.disconnect();
});

function createRemotePlayerMesh(name) {
  const group = new THREE.Group();

  // Body
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3366cc });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.0;
  group.add(body);

  // Head
  const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.6;
  group.add(head);

  // Arms
  const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
  const armMat = new THREE.MeshLambertMaterial({ color: 0x3366cc });
  const la = new THREE.Mesh(armGeo, armMat); la.position.set(-0.4, 1.0, 0);
  const ra = new THREE.Mesh(armGeo, armMat); ra.position.set(0.4, 1.0, 0);
  group.add(la, ra);

  // Legs
  const legGeo = new THREE.BoxGeometry(0.2, 0.7, 0.2);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x333366 });
  const ll = new THREE.Mesh(legGeo, legMat); ll.position.set(-0.1, 0.35, 0);
  const rl = new THREE.Mesh(legGeo, legMat); rl.position.set(0.1, 0.35, 0);
  group.add(ll, rl);

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

  return group;
}

networkManager.onConnected = (id) => {
  mpStatus.textContent = `Connected as ${id}`;
  mpStatus.style.color = '#8f8';
  btnMpConnect.classList.add('hidden');
  btnMpDisconnect.classList.remove('hidden');
};

networkManager.onDisconnected = () => {
  mpStatus.textContent = 'Disconnected';
  mpStatus.style.color = '#f88';
  btnMpConnect.classList.remove('hidden');
  btnMpDisconnect.classList.add('hidden');
  // Clean up remote player meshes
  for (const [id, mesh] of remotePlayerMeshes) {
    scene.remove(mesh);
  }
  remotePlayerMeshes.clear();
};

networkManager.onPlayerJoin = (id, data) => {
  const mesh = createRemotePlayerMesh(data.name);
  mesh.position.set(data.x || 32, data.y || 100, data.z || 32);
  scene.add(mesh);
  remotePlayerMeshes.set(id, mesh);
};

networkManager.onPlayerLeave = (id) => {
  const mesh = remotePlayerMeshes.get(id);
  if (mesh) {
    scene.remove(mesh);
    remotePlayerMeshes.delete(id);
  }
};

networkManager.onPlayerMove = (id, data) => {
  const mesh = remotePlayerMeshes.get(id);
  if (mesh) {
    // Smooth interpolation
    mesh.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.3);
    mesh.rotation.y = data.ry || 0;
  }
};

networkManager.onBlockChange = (x, y, z, blockId) => {
  world.setVoxel(x, y, z, blockId, true, true);
  updateVoxelGeometry(x, y, z);
};

// Position sync throttle
let mpSyncTimer = 0;

let lastChunkId = '';
let lastTime = performance.now();
let lastSaveTime = performance.now();

async function saveWorldState() {
  const pState = {
    position: player.position.toArray(),
    quaternion: camera.quaternion.toArray(),
    inventory: inventory.slots
  };
  await storage.savePlayerState(worldKey, pState);

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
}

function animate() {
  requestAnimationFrame(animate);

  if (uiManager.state !== 'PLAYING' || !worldKey) return; // Pause when not playing or no world loaded

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
  entityManager.update(dt, player, inventory, audioSystem);
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
  if (networkManager.isConnected) {
    mpSyncTimer += dt;
    if (mpSyncTimer >= 0.1) {
      mpSyncTimer = 0;
      networkManager.sendPosition(player.position, { x: camera.rotation.x, y: camera.rotation.y });
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

    // Queue terrain generation for columns we haven't seen
    for (let x = -renderDist; x <= renderDist; x++) {
      for (let z = -renderDist; z <= renderDist; z++) {
        const cx = coords.chunkX + x;
        const cz = coords.chunkZ + z;
        const colId = `${cx},${cz}`;
        if (!generatedColumns.has(colId) && !terrainQueueSet.has(colId)) {
          const dist = x * x + z * z;
          terrainQueue.push({ cx, cz, colId, dist });
          terrainQueueSet.add(colId);
        }
      }
    }
    // Sort so closest are at the end (popped first)
    terrainQueue.sort((a, b) => b.dist - a.dist);

    // Queue DB loads
    for (let x = -renderDist; x <= renderDist; x++) {
      for (let y = -renderDist; y <= renderDist; y++) {
        for (let z = -renderDist; z <= renderDist; z++) {
          const cx = coords.chunkX + x;
          const cy = coords.chunkY + y;
          const cz = coords.chunkZ + z;

          const cellId = `${cx},${cy},${cz}`;

          if (!chunkManager.meshes.has(cellId) && !activeChunkRequests.has(cellId) && !chunkLoadQueueSet.has(cellId)) {
            const dist = x * x + y * y + z * z;
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

  // Time-budgeted processing — spend at most 4ms per frame on terrain + meshing
  const budgetStart = performance.now();
  const FRAME_BUDGET_MS = 4;

  // Process terrain queue — synchronous terrain generation with neighbor rebuild
  while (terrainQueue.length > 0 && (performance.now() - budgetStart) < FRAME_BUDGET_MS) {
    const item = terrainQueue.pop();
    terrainQueueSet.delete(item.colId);
    if (!generatedColumns.has(item.colId)) {
      generatedColumns.add(item.colId);

      // Track which chunks exist before generation
      const chunksBefore = new Set(world.chunks.keys());

      terrainGenerator.generateChunkData(world, item.cx, item.cz);

      // Find newly created chunks and queue their neighbors for mesh rebuild
      // This fixes boundary faces on adjacent chunks that were already meshed
      for (const chunkId of world.chunks.keys()) {
        if (!chunksBefore.has(chunkId)) {
          const parts = chunkId.split(',').map(Number);
          const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
          for (const [dx, dy, dz] of dirs) {
            const neighborId = `${parts[0] + dx},${parts[1] + dy},${parts[2] + dz}`;
            // Only rebuild neighbors that already have meshes (stale boundary)
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
  const MAX_CONCURRENT_LOADS = 4;
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

  // Process pending mesh rebuilds — dispatch to workers (non-blocking)
  if (pendingMeshRebuilds.size > 0) {
    const toRemove = [];
    for (const cellId of pendingMeshRebuilds) {
      const parts = cellId.split(',').map(Number);
      const dispatched = chunkManager.updateCellGeometryAsync(
        parts[0] * world.chunkSize, parts[1] * world.chunkSize, parts[2] * world.chunkSize
      );
      if (dispatched) toRemove.push(cellId);
      else break; // Workers full, try again next frame
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
