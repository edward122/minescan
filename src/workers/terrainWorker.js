// Optimized Terrain Worker — runs terrain generation off the main thread
// Matches TerrainGenerator.js exactly.
// Includes: continentalness, erosion, ridges, biome blending, improved caves, water pools, oceans

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
const Biomes = {
    PLAINS: 0, DESERT: 1, FOREST: 2, MOUNTAINS: 3, SNOW: 4, SWAMP: 5,
    BEACH: 6, OCEAN: 7, DEEP_OCEAN: 8
};

function getBiome(temp, moist, cont) {
    // Ocean biomes based on continentalness
    if (cont < 0.25) return Biomes.DEEP_OCEAN;
    if (cont < 0.38) return Biomes.OCEAN;
    if (cont < 0.42) return Biomes.BEACH;

    // Land biomes
    if (temp < 0.3) return Biomes.SNOW;
    if (temp > 0.7 && moist < 0.4) return Biomes.DESERT;
    if (temp > 0.4 && moist > 0.7) return Biomes.SWAMP;
    if (temp > 0.3 && temp < 0.7 && moist > 0.5) return Biomes.FOREST;
    if (temp < 0.5 && moist < 0.5) return Biomes.MOUNTAINS;
    return Biomes.PLAINS;
}

const biomeDataLookup = {
    [Biomes.PLAINS]: { baseHeight: 86, heightScale: 0.4, surfaceBlock: Blocks.GRASS, subSurfaceBlock: Blocks.DIRT, treeChance: 0.003 },
    [Biomes.DESERT]: { baseHeight: 85, heightScale: 0.5, surfaceBlock: Blocks.SAND, subSurfaceBlock: Blocks.SAND, treeChance: 0.0 },
    [Biomes.FOREST]: { baseHeight: 88, heightScale: 0.8, surfaceBlock: Blocks.GRASS, subSurfaceBlock: Blocks.DIRT, treeChance: 0.03 },
    [Biomes.MOUNTAINS]: { baseHeight: 95, heightScale: 1.8, surfaceBlock: Blocks.STONE, subSurfaceBlock: Blocks.STONE, treeChance: 0.002 },
    [Biomes.SNOW]: { baseHeight: 88, heightScale: 0.7, surfaceBlock: Blocks.SNOW, subSurfaceBlock: Blocks.DIRT, treeChance: 0.001 },
    [Biomes.SWAMP]: { baseHeight: 79, heightScale: 0.15, surfaceBlock: Blocks.DIRT, subSurfaceBlock: Blocks.DIRT, treeChance: 0.04 },
    [Biomes.BEACH]: { baseHeight: 80, heightScale: 0.2, surfaceBlock: Blocks.SAND, subSurfaceBlock: Blocks.SAND, treeChance: 0.0 },
    [Biomes.OCEAN]: { baseHeight: 58, heightScale: 0.4, surfaceBlock: Blocks.SAND, subSurfaceBlock: Blocks.SAND, treeChance: 0.0 },
    [Biomes.DEEP_OCEAN]: { baseHeight: 45, heightScale: 0.3, surfaceBlock: Blocks.GRAVEL, subSurfaceBlock: Blocks.GRAVEL, treeChance: 0.0 },
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

// --- Biome blending ---

function getTempMoistCont(x, z) {
    const temp = (fBm(x, z, noise2D_temp, 3, 0.5, 2, 800) + 1) / 2;
    const moist = (fBm(x, z, noise2D_moist, 3, 0.5, 2, 800) + 1) / 2;
    const cont = (fBm(x, z, noise2D_cont, 4, 0.5, 2, 600) + 1) / 2;
    return { temp, moist, cont };
}

function getBlendedBiomeData(centerX, centerZ) {
    const BLEND_RADIUS = 4;
    const STEP = 8;

    let totalWeight = 0;
    let blendedBaseHeight = 0;
    let blendedHeightScale = 0;
    let blendedTreeChance = 0;

    const c = getTempMoistCont(centerX, centerZ);
    const centerBiome = getBiome(c.temp, c.moist, c.cont);
    const centerData = biomeDataLookup[centerBiome];

    for (let dx = -BLEND_RADIUS; dx <= BLEND_RADIUS; dx++) {
        for (let dz = -BLEND_RADIUS; dz <= BLEND_RADIUS; dz++) {
            const dist2 = dx * dx + dz * dz;
            if (dist2 > BLEND_RADIUS * BLEND_RADIUS) continue;

            const sx = centerX + dx * STEP;
            const sz = centerZ + dz * STEP;
            const weight = 1 / (1 + dist2);

            const s = getTempMoistCont(sx, sz);
            const biome = getBiome(s.temp, s.moist, s.cont);
            const bd = biomeDataLookup[biome];

            blendedBaseHeight += bd.baseHeight * weight;
            blendedHeightScale += bd.heightScale * weight;
            blendedTreeChance += bd.treeChance * weight;
            totalWeight += weight;
        }
    }

    return {
        biome: centerBiome,
        surfaceBlock: centerData.surfaceBlock,
        subSurfaceBlock: centerData.subSurfaceBlock,
        baseHeight: blendedBaseHeight / totalWeight,
        heightScale: blendedHeightScale / totalWeight,
        treeChance: blendedTreeChance / totalWeight,
    };
}

// --- Noise state (initialized once per seed) ---

let noise2D_elev1, noise2D_elev2, noise2D_temp, noise2D_moist, noise2D_cont, noise2D_erosion, noise2D_ridges, noise2D_pools;
let noise3D_caves1, noise3D_caves2, noise3D_caves3, noise3D_caves4, noise3D_ores;
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
        noise2D_cont = createNoise2D(prng);
        noise2D_erosion = createNoise2D(prng);
        noise2D_ridges = createNoise2D(prng);
        noise2D_pools = createNoise2D(prng);
        noise3D_caves1 = createNoise3D(prng);
        noise3D_caves2 = createNoise3D(prng);
        noise3D_caves3 = createNoise3D(prng);
        noise3D_caves4 = createNoise3D(prng);
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

    // ------ PHASE 1: Heightmap + biomemap with blending ------

    const heightmap = new Int32Array(chunkSize * chunkSize);
    const biomemap = new Uint8Array(chunkSize * chunkSize);
    const biomeDataMap = new Array(chunkSize * chunkSize);
    let maxHeight = 0;

    for (let iz = 0; iz < chunkSize; iz++) {
        for (let ix = 0; ix < chunkSize; ix++) {
            const idx = iz * chunkSize + ix;
            const x = startX + ix;
            const z = startZ + iz;

            // Biome with smooth blending
            const blended = getBlendedBiomeData(x, z);
            const biome = blended.biome;
            const bd = blended;

            // Height generation: erosion + ridges + detail
            const erosion = (fBm(x, z, noise2D_erosion, 3, 0.5, 2, 300) + 1) / 2;
            const ridges = fBm(x, z, noise2D_ridges, 3, 0.5, 2, 150);
            const heightNoise = fBm(x, z, noise2D_elev1, 4, 0.5, 2.0, 300);
            const detailNoise = fBm(x, z, noise2D_elev2, 3, 0.5, 2.0, 50);
            const baseHeightScale = (heightNoise + 1) / 2;

            const erosionFactor = (1 - erosion) * bd.heightScale;
            const ridgeDetail = Math.abs(ridges) * 8 * erosionFactor;

            let terrainHeight = Math.floor(
                bd.baseHeight +
                (baseHeightScale * 30 * bd.heightScale) +
                (erosionFactor * 6) +
                ridgeDetail +
                (detailNoise * 3 * bd.heightScale)
            );

            // Water pools on land
            if (biome !== Biomes.OCEAN && biome !== Biomes.DEEP_OCEAN && biome !== Biomes.BEACH) {
                const poolNoise = fBm(x, z, noise2D_pools, 2, 0.5, 2, 60);
                if (poolNoise > 0.6 && terrainHeight > seaLevel + 2 && terrainHeight < seaLevel + 20) {
                    const poolDepth = Math.floor((poolNoise - 0.6) * 15);
                    terrainHeight = Math.max(seaLevel - poolDepth, seaLevel - 3);
                }
            }

            if (terrainHeight < 1) terrainHeight = 1;
            if (terrainHeight > maxHeight) maxHeight = terrainHeight;

            heightmap[idx] = terrainHeight;
            biomemap[idx] = biome;
            biomeDataMap[idx] = bd;
        }
    }

    // ------ PHASE 2: Fill columns + ores + caves ------

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
                        // Underwater surfaces
                        if (terrainHeight < seaLevel - 1) {
                            if (biome === Biomes.OCEAN || biome === Biomes.DEEP_OCEAN) {
                                blockId = bd.surfaceBlock;
                            } else {
                                blockId = Blocks.SAND;
                            }
                        }
                    } else if (y > terrainHeight - 4) {
                        blockId = bd.subSurfaceBlock;
                    } else {
                        blockId = Blocks.STONE;

                        // Clustered Ore Generation
                        const oreNoise = noise3D_ores(x / 15, y / 15, z / 15);
                        if (oreNoise > 0.88) {
                            if (y < 20 && (oreNoise * 10) % 1 > 0.5) blockId = Blocks.DIAMOND_ORE;
                            else if (y < 40 && (oreNoise * 10) % 1 > 0.3) blockId = Blocks.GOLD_ORE;
                            else if (y < 70) blockId = Blocks.IRON_ORE;
                            else blockId = Blocks.COAL_ORE;
                        }
                    }

                    // ==== CAVE SYSTEM ====
                    if (y > 2 && y < terrainHeight) {
                        let isCave = false;

                        // 1. Spaghetti caves — narrow winding tunnels (can reach surface)
                        const sp1 = noise3D_caves1(x / 55, y / 45, z / 55);
                        const sp2 = noise3D_caves2(x / 55, y / 45, z / 55);
                        const spaghetti = (Math.abs(sp1) + Math.abs(sp2)) < 0.045;

                        // 2. Cheese caves — caverns, only deep underground (Y 10-50)
                        let isCheese = false;
                        if (y < terrainHeight - 8 && y < 55) {
                            const cheeseRaw = noise3D_caves3(x / 65, y / 60, z / 65);
                            const depthBias = 1 - Math.abs(y - 28) / 30;
                            const cheese = cheeseRaw + depthBias * 0.12;
                            isCheese = cheese > 0.65;
                        }

                        // 3. Noodle caves — thin connecting passages, underground only
                        let isNoodle = false;
                        if (y < terrainHeight - 5) {
                            const noodleA = noise3D_caves4(x / 40, y / 30, z / 40);
                            const noodleB = noise3D_caves1(x / 28 + 100, y / 25 + 100, z / 28 + 100);
                            isNoodle = (Math.abs(noodleA) < 0.02 && Math.abs(noodleB) < 0.025);
                        }

                        isCave = spaghetti || isCheese || isNoodle;

                        // Only spaghetti caves can break through near surface
                        if (isCave && y > terrainHeight - 4 && !spaghetti) {
                            isCave = false;
                        }

                        if (isCave) {
                            // Lava pools only below Y=10 (solid fill, no scattered blocks)
                            if (y < 10) {
                                blockId = Blocks.LAVA;
                            } else {
                                blockId = Blocks.AIR;
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
                // More kelp in oceans
                if ((biome === Biomes.OCEAN || biome === Biomes.DEEP_OCEAN) && waterDepth > 5 && decoRandom() < 0.08) {
                    const kelpHeight = 3 + Math.floor(decoRandom() * Math.min(waterDepth - 3, 12));
                    for (let k = 0; k < kelpHeight; k++) {
                        setVoxel(x, terrainHeight + 1 + k, z, Blocks.KELP);
                    }
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

    // Trees — with jungle support for forest biome
    for (const tree of treePositions) {
        const isSwamp = tree.biome === Biomes.SWAMP;
        const isForest = tree.biome === Biomes.FOREST;

        if (isForest) {
            if (decoRandom() < 0.35) {
                // Big 2x2 jungle tree
                const height = 12 + Math.floor(decoRandom() * 7);
                for (let y = 0; y < height; y++) {
                    setVoxel(tree.x, tree.y + y, tree.z, Blocks.WOOD);
                    setVoxel(tree.x + 1, tree.y + y, tree.z, Blocks.WOOD);
                    setVoxel(tree.x, tree.y + y, tree.z + 1, Blocks.WOOD);
                    setVoxel(tree.x + 1, tree.y + y, tree.z + 1, Blocks.WOOD);
                }
                const canopyBase = tree.y + height - 3;
                const canopyTop = tree.y + height + 2;
                for (let cy = canopyBase; cy <= canopyTop; cy++) {
                    const distFromTop = canopyTop - cy;
                    const radius = distFromTop <= 1 ? 3 : 5;
                    for (let lx = -radius; lx <= radius; lx++) {
                        for (let lz = -radius; lz <= radius; lz++) {
                            if (lx * lx + lz * lz <= radius * radius) {
                                const px = tree.x + lx, py = cy, pz = tree.z + lz;
                                if (getVoxel(px, py, pz) === Blocks.AIR) {
                                    setVoxel(px, py, pz, Blocks.LEAVES);
                                }
                            }
                        }
                    }
                }
                // Hanging vines
                const vineR = 4;
                for (let lx = -vineR; lx <= vineR; lx++) {
                    for (let lz = -vineR; lz <= vineR; lz++) {
                        const d2 = lx * lx + lz * lz;
                        if (d2 >= (vineR - 1) * (vineR - 1) && d2 <= vineR * vineR && decoRandom() < 0.4) {
                            const vineLen = 1 + Math.floor(decoRandom() * 3);
                            for (let v = 0; v < vineLen; v++) {
                                const px = tree.x + lx, py = canopyBase - 1 - v, pz = tree.z + lz;
                                if (getVoxel(px, py, pz) === Blocks.AIR) {
                                    setVoxel(px, py, pz, Blocks.LEAVES);
                                }
                            }
                        }
                    }
                }
            } else {
                // Tall 1x1 jungle tree
                const height = 8 + Math.floor(decoRandom() * 7);
                for (let y = 0; y < height; y++) {
                    setVoxel(tree.x, tree.y + y, tree.z, Blocks.WOOD);
                }
                const canopyCenter = tree.y + height;
                for (let ly = -2; ly <= 2; ly++) {
                    const radius = ly <= 0 ? 3 : 2;
                    for (let lx = -radius; lx <= radius; lx++) {
                        for (let lz = -radius; lz <= radius; lz++) {
                            if (lx * lx + ly * ly + lz * lz <= radius * radius + 1) {
                                const px = tree.x + lx, py = canopyCenter + ly, pz = tree.z + lz;
                                if (getVoxel(px, py, pz) === Blocks.AIR) {
                                    setVoxel(px, py, pz, Blocks.LEAVES);
                                }
                            }
                        }
                    }
                }
                // Hanging leaves
                for (let lx = -3; lx <= 3; lx++) {
                    for (let lz = -3; lz <= 3; lz++) {
                        const d2 = lx * lx + lz * lz;
                        if (d2 >= 4 && d2 <= 9 && decoRandom() < 0.3) {
                            const px = tree.x + lx, py = canopyCenter - 3, pz = tree.z + lz;
                            if (getVoxel(px, py, pz) === Blocks.AIR) {
                                setVoxel(px, py, pz, Blocks.LEAVES);
                            }
                        }
                    }
                }
            }
        } else if (isSwamp) {
            const height = 3 + Math.floor(decoRandom() * 2);
            for (let y = 0; y < height; y++) {
                setVoxel(tree.x, tree.y + y, tree.z, Blocks.WOOD);
            }
            const leafRadius = 3;
            for (let lx = -leafRadius; lx <= leafRadius; lx++) {
                for (let ly = -leafRadius; ly <= 0; ly++) {
                    for (let lz = -leafRadius; lz <= leafRadius; lz++) {
                        if (lx * lx + ly * ly + lz * lz <= leafRadius * leafRadius) {
                            const px = tree.x + lx, py = tree.y + height + ly, pz = tree.z + lz;
                            if (getVoxel(px, py, pz) === Blocks.AIR) {
                                setVoxel(px, py, pz, Blocks.LEAVES);
                            }
                        }
                    }
                }
            }
        } else {
            // Normal oak tree
            const height = 4 + Math.floor(decoRandom() * 3);
            for (let y = 0; y < height; y++) {
                setVoxel(tree.x, tree.y + y, tree.z, Blocks.WOOD);
            }
            const leafRadius = 2;
            for (let lx = -leafRadius; lx <= leafRadius; lx++) {
                for (let ly = -leafRadius; ly <= leafRadius; ly++) {
                    for (let lz = -leafRadius; lz <= leafRadius; lz++) {
                        if (lx * lx + ly * ly + lz * lz <= leafRadius * leafRadius + 1) {
                            const px = tree.x + lx, py = tree.y + height + ly, pz = tree.z + lz;
                            if (getVoxel(px, py, pz) === Blocks.AIR) {
                                setVoxel(px, py, pz, Blocks.LEAVES);
                            }
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
