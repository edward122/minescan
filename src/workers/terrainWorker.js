// Optimized Terrain Worker — runs terrain generation off the main thread
// Phase 1: Heightmap + biomemap (exact noise, no interpolation)
// Phase 2: Column fill with direct array writes
// Phase 3: Cave carving (3D noise, only in valid Y range)
// Phase 4: Ore placement (3D noise, only in stone)
// Phase 5: Decorators (trees, flowers, boulders, kelp, etc.)
// Output: skip all-air chunks to reduce transfer overhead

import { createNoise2D, createNoise3D } from 'simplex-noise';

// Inlined block IDs
const Blocks = {
    AIR: 0, DIRT: 1, GRASS: 2, STONE: 3, WOOD: 4, LEAVES: 5,
    SAND: 6, GLASS: 7, WATER: 8, OAK_PLANKS: 9, COBBLESTONE: 10,
    COAL_ORE: 11, IRON_ORE: 12, GOLD_ORE: 13, DIAMOND_ORE: 14,
    STICK: 15, CRAFTING_TABLE: 16, FURNACE: 17, CHEST: 18, TORCH: 19,
    SNOW: 40, BEDROCK: 41, TALL_GRASS: 42, FLOWER_RED: 43, FLOWER_YELLOW: 44,
    LAVA: 48, GRAVEL: 49, CLAY: 50, KELP: 51, LILY_PAD: 52, MOSSY_COBBLESTONE: 53,
    LANTERN: 54, CACTUS: 55
};

// Biome IDs (numeric for worker)
const Biomes = { PLAINS: 0, DESERT: 1, FOREST: 2, MOUNTAINS: 3, SNOW: 4, SWAMP: 5, BEACH: 6 };

function getBiome(temp, moist) {
    if (temp < 0.3) return Biomes.SNOW;
    if (temp > 0.7 && moist < 0.4) return Biomes.DESERT;
    if (temp > 0.4 && moist > 0.7) return Biomes.SWAMP;
    if (temp > 0.3 && temp < 0.7 && moist > 0.5) return Biomes.FOREST;
    if (temp < 0.5 && moist < 0.5) return Biomes.MOUNTAINS;
    return Biomes.PLAINS;
}

const biomeDataLookup = {
    [Biomes.PLAINS]: { baseHeight: 88, heightScale: 0.4, surfaceBlock: Blocks.GRASS, subSurfaceBlock: Blocks.DIRT, treeChance: 0.003 },
    [Biomes.DESERT]: { baseHeight: 85, heightScale: 0.5, surfaceBlock: Blocks.SAND, subSurfaceBlock: Blocks.SAND, treeChance: 0.0 },
    [Biomes.FOREST]: { baseHeight: 90, heightScale: 0.8, surfaceBlock: Blocks.GRASS, subSurfaceBlock: Blocks.DIRT, treeChance: 0.03 },
    [Biomes.MOUNTAINS]: { baseHeight: 95, heightScale: 1.8, surfaceBlock: Blocks.STONE, subSurfaceBlock: Blocks.STONE, treeChance: 0.002 },
    [Biomes.SNOW]: { baseHeight: 88, heightScale: 0.7, surfaceBlock: Blocks.SNOW, subSurfaceBlock: Blocks.DIRT, treeChance: 0.001 },
    [Biomes.SWAMP]: { baseHeight: 81, heightScale: 0.15, surfaceBlock: Blocks.DIRT, subSurfaceBlock: Blocks.DIRT, treeChance: 0.04 },
    [Biomes.BEACH]: { baseHeight: 80, heightScale: 0.5, surfaceBlock: Blocks.SAND, subSurfaceBlock: Blocks.SAND, treeChance: 0.0 },
};

// --- Utility ---

function hashSeed(seed) {
    if (typeof seed === 'number') return seed;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}

function seedPRNG(a) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function fBm(x, z, noiseFn, octaves, persistence, lacunarity, scale) {
    let total = 0, frequency = 1 / scale, amplitude = 1, maxValue = 0;
    for (let i = 0; i < octaves; i++) {
        total += noiseFn(x * frequency, z * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    return total / maxValue;
}

function hash(x, y, z) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 21285261);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return (h ^ (h >>> 16)) >>> 0;
}

// --- Noise state (initialized once per seed) ---

let noise2D_elev1, noise2D_elev2, noise2D_temp, noise2D_moist;
let noise3D_caves1, noise3D_caves2, noise3D_ores;
let decoRandom;
let currentSeed = null;
const seaLevel = 80;

self.onmessage = function (e) {
    const { chunkX, chunkZ, chunkSize, seed } = e.data;

    // Initialize noise lazily (once per seed)
    if (currentSeed !== seed) {
        currentSeed = seed;
        const numericSeed = hashSeed(seed);
        const prng = seedPRNG(numericSeed);
        noise2D_elev1 = createNoise2D(prng);
        noise2D_elev2 = createNoise2D(prng);
        noise2D_temp = createNoise2D(prng);
        noise2D_moist = createNoise2D(prng);
        noise3D_caves1 = createNoise3D(prng);
        noise3D_caves2 = createNoise3D(prng);
        noise3D_ores = createNoise3D(prng);
        decoRandom = seedPRNG(numericSeed + 12345);
    }

    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;
    const chunkSlice = chunkSize * chunkSize;

    // ------ Chunk storage (direct array writes) ------

    const chunks = new Map();

    function getChunkId(x, y, z) {
        return `${Math.floor(x / chunkSize)},${Math.floor(y / chunkSize)},${Math.floor(z / chunkSize)}`;
    }

    function ensureChunk(cid) {
        let chunk = chunks.get(cid);
        if (!chunk) {
            chunk = new Uint8Array(chunkSize * chunkSize * chunkSize);
            chunks.set(cid, chunk);
        }
        return chunk;
    }

    function setVoxel(x, y, z, v) {
        if (y < 0) return;
        const cid = getChunkId(x, y, z);
        const chunk = ensureChunk(cid);
        const lx = ((x % chunkSize) + chunkSize) % chunkSize;
        const ly = ((y % chunkSize) + chunkSize) % chunkSize;
        const lz = ((z % chunkSize) + chunkSize) % chunkSize;
        chunk[ly * chunkSlice + lz * chunkSize + lx] = v;
    }

    function getVoxel(x, y, z) {
        if (y < 0) return 0;
        const cid = getChunkId(x, y, z);
        const chunk = chunks.get(cid);
        if (!chunk) return 0;
        const lx = ((x % chunkSize) + chunkSize) % chunkSize;
        const ly = ((y % chunkSize) + chunkSize) % chunkSize;
        const lz = ((z % chunkSize) + chunkSize) % chunkSize;
        return chunk[ly * chunkSlice + lz * chunkSize + lx];
    }

    // ------ PHASE 1: Build heightmap + biomemap (exact noise, matching TerrainGenerator) ------

    const heightmap = new Int32Array(chunkSize * chunkSize);
    const biomemap = new Uint8Array(chunkSize * chunkSize);
    const biomeDataMap = new Array(chunkSize * chunkSize);
    let maxHeight = 0;

    for (let iz = 0; iz < chunkSize; iz++) {
        for (let ix = 0; ix < chunkSize; ix++) {
            const idx = iz * chunkSize + ix;
            const x = startX + ix;
            const z = startZ + iz;

            // Exact noise evaluation (matches TerrainGenerator exactly)
            const temp = (fBm(x, z, noise2D_temp, 3, 0.5, 2, 800) + 1) / 2;
            const moist = (fBm(x, z, noise2D_moist, 3, 0.5, 2, 800) + 1) / 2;
            const heightNoise = fBm(x, z, noise2D_elev1, 4, 0.5, 2.0, 300);
            const detailNoise = fBm(x, z, noise2D_elev2, 4, 0.5, 2.0, 50);
            const baseHeightScale = (heightNoise + 1) / 2;

            let biome = getBiome(temp, moist);
            let bd = biomeDataLookup[biome];

            let terrainHeight = Math.floor(
                bd.baseHeight + (baseHeightScale * 40 * bd.heightScale) + (detailNoise * 5 * bd.heightScale)
            );

            // Beach transitions
            if (biome === Biomes.PLAINS || biome === Biomes.FOREST || biome === Biomes.SWAMP) {
                if (terrainHeight >= seaLevel - 1 && terrainHeight <= seaLevel + 1) {
                    biome = Biomes.BEACH;
                    bd = { ...biomeDataLookup[Biomes.DESERT], baseHeight: terrainHeight, treeChance: 0 };
                }
            }

            if (terrainHeight < 1) terrainHeight = 1;
            if (terrainHeight > maxHeight) maxHeight = terrainHeight;

            heightmap[idx] = terrainHeight;
            biomemap[idx] = biome;
            biomeDataMap[idx] = bd;
        }
    }

    // ------ PHASE 2: Fill columns + ores + caves (matching original order exactly) ------

    const treePositions = [];
    const decoPositions = [];

    for (let iz = 0; iz < chunkSize; iz++) {
        for (let ix = 0; ix < chunkSize; ix++) {
            const idx = iz * chunkSize + ix;
            const x = startX + ix;
            const z = startZ + iz;
            const terrainHeight = heightmap[idx];
            const biome = biomemap[idx];
            const bd = biomeDataMap[idx];
            let surfaceIsLiquid = false;

            const colTop = Math.max(terrainHeight, seaLevel);

            for (let y = 0; y <= colTop; y++) {
                let blockId = Blocks.AIR;

                if (y === 0) {
                    blockId = Blocks.BEDROCK;
                } else if (y <= terrainHeight) {
                    if (y === terrainHeight) {
                        blockId = bd.surfaceBlock;
                        if (biome === Biomes.MOUNTAINS && y > 120) blockId = Blocks.SNOW;
                    } else if (y > terrainHeight - 4) {
                        blockId = bd.subSurfaceBlock;
                    } else {
                        blockId = Blocks.STONE;

                        // Clustered Ore Generation (inline, matching original)
                        const oreNoise = noise3D_ores(x / 15, y / 15, z / 15);
                        if (oreNoise > 0.88) {
                            if (y < 20 && (oreNoise * 10) % 1 > 0.5) blockId = Blocks.DIAMOND_ORE;
                            else if (y < 40 && (oreNoise * 10) % 1 > 0.3) blockId = Blocks.GOLD_ORE;
                            else if (y < 70) blockId = Blocks.IRON_ORE;
                            else blockId = Blocks.COAL_ORE;
                        }
                    }

                    // Caves (inline, matching original order — runs after ore placement)
                    if (y > 3 && y < terrainHeight - 3) {
                        const n1 = noise3D_caves1(x / 40, y / 40, z / 40);
                        const n2 = noise3D_caves2(x / 25, y / 25, z / 25);

                        if (Math.abs(n1) < 0.05 || n2 > 0.55) {
                            if (y < 15) {
                                blockId = Blocks.LAVA;
                            } else if (y < 22 && hash(x, y, z) % 100 < 30) {
                                blockId = Blocks.LAVA;
                            } else {
                                blockId = Blocks.AIR;
                                // Cave floor gravel
                                if (getVoxel(x, y - 1, z) === Blocks.STONE && hash(x, y, z) % 100 < 15) {
                                    blockId = Blocks.GRAVEL;
                                }
                            }
                        }
                    }
                } else if (y <= seaLevel) {
                    blockId = Blocks.WATER;
                    surfaceIsLiquid = true;

                    // Water floor modifications
                    if (y === terrainHeight + 1) {
                        const floorChance = hash(x, y, z) % 100;
                        if (floorChance < 10) setVoxel(x, terrainHeight, z, Blocks.CLAY);
                        else if (floorChance < 15) setVoxel(x, terrainHeight, z, Blocks.GRAVEL);
                        else if (biome !== Biomes.SWAMP) setVoxel(x, terrainHeight, z, Blocks.SAND);
                    }
                }

                if (blockId !== Blocks.AIR) {
                    setVoxel(x, y, z, blockId);
                }
            }

            // ------ PHASE 3: Decorator collection ------

            if (!surfaceIsLiquid && terrainHeight >= seaLevel) {
                const surfaceBlock = getVoxel(x, terrainHeight, z);

                if (surfaceBlock !== Blocks.AIR && decoRandom() < bd.treeChance) {
                    treePositions.push({ x, y: terrainHeight + 1, z, biome });
                } else if (surfaceBlock === Blocks.GRASS) {
                    const decoRand = decoRandom();
                    if (decoRand < 0.05) setVoxel(x, terrainHeight + 1, z, Blocks.TALL_GRASS);
                    else if (decoRand < 0.06) setVoxel(x, terrainHeight + 1, z, decoRandom() < 0.5 ? Blocks.FLOWER_RED : Blocks.FLOWER_YELLOW);
                } else if ((biome === Biomes.FOREST || biome === Biomes.PLAINS) && decoRandom() < 0.005) {
                    decoPositions.push({ x, y: terrainHeight + 1, z, type: decoRandom() < 0.5 ? 'boulder' : 'log' });
                } else if (biome === Biomes.DESERT && surfaceBlock === Blocks.SAND && decoRandom() < 0.01) {
                    // Cactus (height 1 to 3)
                    const cactusHeight = 1 + Math.floor(decoRandom() * 3);
                    for (let c = 0; c < cactusHeight; c++) {
                        setVoxel(x, terrainHeight + 1 + c, z, Blocks.CACTUS);
                    }
                }
            }

            // Water decorators
            if (surfaceIsLiquid) {
                const waterDepth = seaLevel - terrainHeight;
                if (waterDepth > 3 && decoRandom() < 0.05) {
                    const kelpHeight = 2 + Math.floor(decoRandom() * (waterDepth - 2));
                    for (let k = 0; k < kelpHeight; k++) {
                        setVoxel(x, terrainHeight + 1 + k, z, Blocks.KELP);
                    }
                }
                if (biome === Biomes.SWAMP && waterDepth > 0 && decoRandom() < 0.1) {
                    setVoxel(x, seaLevel + 1, z, Blocks.LILY_PAD);
                }
            }
        }
    }

    // ------ PHASE 4: Place decorations ------

    for (const deco of decoPositions) {
        if (deco.type === 'boulder') {
            setVoxel(deco.x, deco.y, deco.z, Blocks.MOSSY_COBBLESTONE);
            if (decoRandom() < 0.5) setVoxel(deco.x + 1, deco.y, deco.z, Blocks.MOSSY_COBBLESTONE);
            if (decoRandom() < 0.5) setVoxel(deco.x, deco.y + 1, deco.z, Blocks.MOSSY_COBBLESTONE);
        } else if (deco.type === 'log') {
            const len = 3 + Math.floor(decoRandom() * 2);
            const axis = decoRandom() < 0.5 ? { dx: 1, dz: 0 } : { dx: 0, dz: 1 };
            for (let i = 0; i < len; i++) {
                if (getVoxel(deco.x + axis.dx * i, deco.y, deco.z + axis.dz * i) === Blocks.AIR) {
                    setVoxel(deco.x + axis.dx * i, deco.y, deco.z + axis.dz * i, Blocks.WOOD);
                }
            }
        }
    }

    // Trees
    for (const tree of treePositions) {
        const isSwamp = tree.biome === Biomes.SWAMP;
        const height = isSwamp ? 3 + Math.floor(decoRandom() * 2) : 4 + Math.floor(decoRandom() * 3);

        for (let y = 0; y < height; y++) {
            setVoxel(tree.x, tree.y + y, tree.z, Blocks.WOOD);
        }

        const leafRadius = isSwamp ? 3 : 2;
        for (let lx = -leafRadius; lx <= leafRadius; lx++) {
            for (let ly = -leafRadius; ly <= (isSwamp ? 0 : leafRadius); ly++) {
                for (let lz = -leafRadius; lz <= leafRadius; lz++) {
                    const limit = isSwamp ? leafRadius * leafRadius : leafRadius * leafRadius + 1;
                    if (lx * lx + ly * ly + lz * lz <= limit) {
                        const px = tree.x + lx, py = tree.y + height + ly, pz = tree.z + lz;
                        if (getVoxel(px, py, pz) === Blocks.AIR) {
                            setVoxel(px, py, pz, Blocks.LEAVES);
                        }
                    }
                }
            }
        }
    }

    // ------ Output: skip empty chunks ------

    const result = [];
    const transferList = [];
    for (const [chunkId, data] of chunks) {
        // Skip all-air chunks
        let hasContent = false;
        for (let i = 0; i < data.length; i++) {
            if (data[i] !== 0) { hasContent = true; break; }
        }
        if (!hasContent) continue;

        result.push({ chunkId, data });
        transferList.push(data.buffer);
    }

    self.postMessage({ chunkX, chunkZ, chunks: result }, transferList);
};
