import { createNoise2D, createNoise3D } from 'simplex-noise';
import { Blocks } from './BlockRegistry.js';
import { BiomeManager, Biomes } from './BiomeManager.js';

export class TerrainGenerator {
    constructor(seed = Math.random()) {
        const numericSeed = this.hashSeed(seed);
        const prng = this.seedPRNG(numericSeed);
        this.random = this.seedPRNG(numericSeed + 12345); // Separate PRNG for decorators

        this.noise2D_elev1 = createNoise2D(prng);
        this.noise2D_elev2 = createNoise2D(prng);
        this.noise2D_temp = createNoise2D(prng);
        this.noise2D_moist = createNoise2D(prng);
        this.noise2D_cont = createNoise2D(prng);    // Continentalness
        this.noise2D_erosion = createNoise2D(prng);  // Erosion
        this.noise2D_ridges = createNoise2D(prng);   // Ridge/valley detail
        this.noise2D_pools = createNoise2D(prng);    // Water pools

        // For caves — 4 noise fields for varied cave types
        this.noise3D_caves1 = createNoise3D(prng); // Spaghetti A
        this.noise3D_caves2 = createNoise3D(prng); // Spaghetti B / cheese
        this.noise3D_caves3 = createNoise3D(prng); // Large caverns
        this.noise3D_caves4 = createNoise3D(prng); // Noodle caves
        this.noise3D_ores = createNoise3D(prng);   // Ores

        this.seaLevel = 80;
    }

    // Convert any seed (string or number) to a numeric value
    hashSeed(seed) {
        if (typeof seed === 'number') return seed;
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            const char = seed.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    // Very simple Mulberry32 PRNG
    seedPRNG(a) {
        return function () {
            var t = a += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
    }

    getNoise(x, z, noiseFn, scale) {
        return noiseFn(x / scale, z / scale);
    }

    // Fractional Brownian Motion (fBm)
    fBm(x, z, noiseFn, octaves, persistence, lacunarity, scale) {
        let total = 0;
        let frequency = 1 / scale;
        let amplitude = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            total += noiseFn(x * frequency, z * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return total / maxValue;
    }

    // Hash function for random placement without per-block noise evaluation
    hash(x, y, z) {
        let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 21285261);
        h = Math.imul(h ^ (h >>> 13), 3266489917);
        return (h ^ (h >>> 16)) >>> 0;
    }

    // Fast inline voxel write - skips all the overhead of world.setVoxel
    _fastSetVoxel(world, x, y, z, v) {
        const cs = world.chunkSize;
        const cx = Math.floor(x / cs);
        const cy = Math.floor(y / cs);
        const cz = Math.floor(z / cs);
        const id = `${cx},${cy},${cz}`;
        let chunk = world.chunks.get(id);
        if (!chunk) {
            chunk = new Uint8Array(cs * cs * cs);
            world.chunks.set(id, chunk);
        }
        const lx = ((x % cs) + cs) % cs;
        const ly = ((y % cs) + cs) % cs;
        const lz = ((z % cs) + cs) % cs;
        chunk[ly * cs * cs + lz * cs + lx] = v;
    }

    // Fast inline voxel read
    _fastGetVoxel(world, x, y, z) {
        const cs = world.chunkSize;
        const cx = Math.floor(x / cs);
        const cy = Math.floor(y / cs);
        const cz = Math.floor(z / cs);
        const chunk = world.chunks.get(`${cx},${cy},${cz}`);
        if (!chunk) return 0;
        const lx = ((x % cs) + cs) % cs;
        const ly = ((y % cs) + cs) % cs;
        const lz = ((z % cs) + cs) % cs;
        return chunk[ly * cs * cs + lz * cs + lx];
    }

    // Get temperature, moisture, and continentalness for a given position
    _getTempMoistCont(x, z) {
        const temp = (this.fBm(x, z, this.noise2D_temp, 3, 0.5, 2, 800) + 1) / 2;
        const moist = (this.fBm(x, z, this.noise2D_moist, 3, 0.5, 2, 800) + 1) / 2;
        const cont = (this.fBm(x, z, this.noise2D_cont, 4, 0.5, 2, 600) + 1) / 2;
        return { temp, moist, cont };
    }

    generateChunkData(world, chunkX, chunkZ, skipCaves = false) {
        const { chunkSize } = world;
        const startX = chunkX * chunkSize;
        const startZ = chunkZ * chunkSize;
        const cs = chunkSize;
        const cs2 = cs * cs;

        // Pre-allocate all chunks this column will touch
        const maxY = this.seaLevel + 80; // Taller mountains possible
        const minChunkY = 0;
        const maxChunkY = Math.floor(maxY / cs);
        const chunkCache = new Map();
        for (let cy = minChunkY; cy <= maxChunkY; cy++) {
            const id = `${chunkX},${cy},${chunkZ}`;
            let chunk = world.chunks.get(id);
            if (!chunk) {
                chunk = new Uint8Array(cs * cs * cs);
                world.chunks.set(id, chunk);
            }
            chunkCache.set(cy, chunk);
        }

        // Inline fast setter using cached chunks
        const setBlock = (x, y, z, v) => {
            const cy = Math.floor(y / cs);
            let chunk = chunkCache.get(cy);
            if (!chunk) {
                // Outside pre-allocated range (trees can go above)
                const cx = Math.floor(x / cs);
                const cz = Math.floor(z / cs);
                const id = `${cx},${cy},${cz}`;
                chunk = world.chunks.get(id);
                if (!chunk) {
                    chunk = new Uint8Array(cs2 * cs);
                    world.chunks.set(id, chunk);
                }
            }
            const lx = ((x % cs) + cs) % cs;
            const ly = ((y % cs) + cs) % cs;
            const lz = ((z % cs) + cs) % cs;
            chunk[ly * cs2 + lz * cs + lx] = v;
        };

        const getBlock = (x, y, z) => {
            const cy = Math.floor(y / cs);
            let chunk = chunkCache.get(cy);
            if (!chunk) {
                const cx = Math.floor(x / cs);
                const cz = Math.floor(z / cs);
                chunk = world.chunks.get(`${cx},${cy},${cz}`);
            }
            if (!chunk) return 0;
            const lx = ((x % cs) + cs) % cs;
            const ly = ((y % cs) + cs) % cs;
            const lz = ((z % cs) + cs) % cs;
            return chunk[ly * cs2 + lz * cs + lx];
        };

        const treePositions = [];
        const decoPositions = [];

        // Cache noise references
        const noise2D_elev1 = this.noise2D_elev1;
        const noise2D_elev2 = this.noise2D_elev2;
        const noise2D_erosion = this.noise2D_erosion;
        const noise2D_ridges = this.noise2D_ridges;
        const noise2D_pools = this.noise2D_pools;
        const noise3D_caves1 = this.noise3D_caves1;
        const noise3D_caves2 = this.noise3D_caves2;
        const noise3D_caves3 = this.noise3D_caves3;
        const noise3D_caves4 = this.noise3D_caves4;
        const noise3D_ores = this.noise3D_ores;
        const seaLevel = this.seaLevel;

        // Bind for biome blending
        const getTempMoistCont = (x, z) => this._getTempMoistCont(x, z);

        for (let ix = 0; ix < chunkSize; ix++) {
            for (let iz = 0; iz < chunkSize; iz++) {
                const x = startX + ix;
                const z = startZ + iz;

                // ---- Biome with blending ----
                const blended = BiomeManager.getBlendedBiomeData(x, z, getTempMoistCont);
                const biome = blended.biome;
                const biomeData = blended;

                // ---- Height generation: continentalness + erosion + ridges ----
                const erosion = (this.fBm(x, z, noise2D_erosion, 3, 0.5, 2, 300) + 1) / 2;
                const ridges = this.fBm(x, z, noise2D_ridges, 3, 0.5, 2, 150);
                const heightNoise = this.fBm(x, z, noise2D_elev1, 4, 0.5, 2.0, 300);
                const detailNoise = this.fBm(x, z, noise2D_elev2, 3, 0.5, 2.0, 50);

                const baseHeightScale = (heightNoise + 1) / 2;

                // Erosion factor: low erosion = terrain can be steep, high = flat
                const erosionFactor = (1 - erosion) * biomeData.heightScale;

                // Ridge detail adds sharp features (toned down for smoother terrain)
                const ridgeDetail = Math.abs(ridges) * 8 * erosionFactor;

                let terrainHeight = Math.floor(
                    biomeData.baseHeight +
                    (baseHeightScale * 30 * biomeData.heightScale) +
                    (erosionFactor * 6) +
                    ridgeDetail +
                    (detailNoise * 3 * biomeData.heightScale)
                );

                // ---- Water pools on land ----
                if (biome !== Biomes.OCEAN && biome !== Biomes.DEEP_OCEAN && biome !== Biomes.BEACH) {
                    const poolNoise = this.fBm(x, z, noise2D_pools, 2, 0.5, 2, 60);
                    if (poolNoise > 0.6 && terrainHeight > seaLevel + 2 && terrainHeight < seaLevel + 20) {
                        // Carve a shallow depression — lower height to just below sea level
                        const poolDepth = Math.floor((poolNoise - 0.6) * 15);
                        terrainHeight = Math.max(seaLevel - poolDepth, seaLevel - 3);
                    }
                }

                if (terrainHeight < 1) terrainHeight = 1;

                let surfaceIsLiquid = false;
                const columnMax = Math.max(terrainHeight, seaLevel);

                // Pre-compute cave thresholds for this column
                const hasCaves = terrainHeight > 6;

                // Generate Column
                for (let y = 0; y <= columnMax; y++) {
                    let blockId = Blocks.AIR;

                    if (y === 0) {
                        blockId = Blocks.BEDROCK;
                    } else if (y <= terrainHeight) {
                        if (y === terrainHeight) {
                            blockId = biomeData.surfaceBlock;
                            if (biome === Biomes.MOUNTAINS && y > 120) {
                                blockId = Blocks.SNOW;
                            }
                            // Underwater surfaces
                            if (terrainHeight < seaLevel - 1) {
                                if (biome === Biomes.OCEAN || biome === Biomes.DEEP_OCEAN) {
                                    blockId = biomeData.surfaceBlock;
                                } else {
                                    blockId = Blocks.SAND; // Pool floors
                                }
                            }
                        } else if (y > terrainHeight - 4) {
                            blockId = biomeData.subSurfaceBlock;
                        } else {
                            blockId = Blocks.STONE;

                            // Clustered Ore Generation
                            if (!skipCaves && (y & 1) === 0) {
                                const oreNoise = noise3D_ores(x / 15, y / 15, z / 15);
                                if (oreNoise > 0.88) {
                                    if (y < 20 && (oreNoise * 10) % 1 > 0.5) blockId = Blocks.DIAMOND_ORE;
                                    else if (y < 40 && (oreNoise * 10) % 1 > 0.3) blockId = Blocks.GOLD_ORE;
                                    else if (y < 70) blockId = Blocks.IRON_ORE;
                                    else blockId = Blocks.COAL_ORE;
                                }
                            }
                        }

                        // ==== CAVE SYSTEM ====
                        if (!skipCaves && hasCaves && y > 2 && y < terrainHeight) {
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
                        // Water filling
                        blockId = Blocks.WATER;
                        surfaceIsLiquid = true;

                        // Water floor modification
                        if (y === terrainHeight + 1) {
                            const floorChance = this.hash(x, y, z) % 100;
                            if (floorChance < 10) setBlock(x, terrainHeight, z, Blocks.CLAY);
                            else if (floorChance < 15) setBlock(x, terrainHeight, z, Blocks.GRAVEL);
                            else if (biome !== Biomes.SWAMP) setBlock(x, terrainHeight, z, Blocks.SAND);
                        }
                    }

                    if (blockId !== Blocks.AIR) {
                        setBlock(x, y, z, blockId);
                    }
                }

                // Surface Decorators
                if (!surfaceIsLiquid && terrainHeight >= seaLevel) {
                    const surfaceBlock = getBlock(x, terrainHeight, z);

                    // Trees
                    if (surfaceBlock !== Blocks.AIR && this.random() < biomeData.treeChance) {
                        treePositions.push({ x, y: terrainHeight + 1, z, biome });
                    }
                    // Grass & Flowers
                    else if (surfaceBlock === Blocks.GRASS) {
                        const decoRand = this.random();
                        if (decoRand < 0.05) setBlock(x, terrainHeight + 1, z, Blocks.TALL_GRASS);
                        else if (decoRand < 0.06) setBlock(x, terrainHeight + 1, z, this.random() < 0.5 ? Blocks.FLOWER_RED : Blocks.FLOWER_YELLOW);
                    }
                    // Boulders & Logs
                    else if ((biome === Biomes.FOREST || biome === Biomes.PLAINS) && this.random() < 0.005) {
                        decoPositions.push({ x, y: terrainHeight + 1, z, type: this.random() < 0.5 ? 'boulder' : 'log' });
                    }
                    // Cactus in desert
                    else if (biome === Biomes.DESERT && surfaceBlock === Blocks.SAND && this.random() < 0.01) {
                        const cactusHeight = 1 + Math.floor(this.random() * 3);
                        for (let c = 0; c < cactusHeight; c++) {
                            setBlock(x, terrainHeight + 1 + c, z, Blocks.CACTUS);
                        }
                    }
                }

                // Water Decorators
                if (surfaceIsLiquid) {
                    const waterDepth = seaLevel - terrainHeight;
                    // Kelp
                    if (waterDepth > 3 && this.random() < 0.05) {
                        const kelpHeight = 2 + Math.floor(this.random() * (waterDepth - 2));
                        for (let k = 0; k < kelpHeight; k++) {
                            setBlock(x, terrainHeight + 1 + k, z, Blocks.KELP);
                        }
                    }
                    // Lily pad
                    if (biome === Biomes.SWAMP && waterDepth > 0 && this.random() < 0.1) {
                        setBlock(x, seaLevel + 1, z, Blocks.LILY_PAD);
                    }
                    // More kelp in oceans
                    if ((biome === Biomes.OCEAN || biome === Biomes.DEEP_OCEAN) && waterDepth > 5 && this.random() < 0.08) {
                        const kelpHeight = 3 + Math.floor(this.random() * Math.min(waterDepth - 3, 12));
                        for (let k = 0; k < kelpHeight; k++) {
                            setBlock(x, terrainHeight + 1 + k, z, Blocks.KELP);
                        }
                    }
                }
            }
        }

        // Decorators
        for (const deco of decoPositions) {
            if (deco.type === 'boulder') {
                this._fastSetVoxel(world, deco.x, deco.y, deco.z, Blocks.MOSSY_COBBLESTONE);
                if (this.random() < 0.5) this._fastSetVoxel(world, deco.x + 1, deco.y, deco.z, Blocks.MOSSY_COBBLESTONE);
                if (this.random() < 0.5) this._fastSetVoxel(world, deco.x, deco.y + 1, deco.z, Blocks.MOSSY_COBBLESTONE);
            } else if (deco.type === 'log') {
                const len = 3 + Math.floor(this.random() * 2);
                const axis = this.random() < 0.5 ? { dx: 1, dz: 0 } : { dx: 0, dz: 1 };
                for (let i = 0; i < len; i++) {
                    if (this._fastGetVoxel(world, deco.x + axis.dx * i, deco.y, deco.z + axis.dz * i) === Blocks.AIR) {
                        this._fastSetVoxel(world, deco.x + axis.dx * i, deco.y, deco.z + axis.dz * i, Blocks.WOOD);
                    }
                }
            }
        }

        // Generate trees after basic terrain
        for (const tree of treePositions) {
            this.generateTree(world, tree.x, tree.y, tree.z, tree.biome);
        }
    }

    generateTree(world, ox, oy, oz, biome) {
        const isSwamp = biome === Biomes.SWAMP;
        const isForest = biome === Biomes.FOREST;

        if (isForest) {
            // Jungle-style trees: mix of tall 2x2 and tall 1x1
            if (this.random() < 0.35) {
                // Big 2x2 jungle tree — very tall
                this._generateBigJungleTree(world, ox, oy, oz);
            } else {
                // Tall 1x1 jungle tree
                this._generateTallJungleTree(world, ox, oy, oz);
            }
        } else if (isSwamp) {
            // Swamp trees — short with flat canopy
            const height = 3 + Math.floor(this.random() * 2);
            for (let y = 0; y < height; y++) {
                this._fastSetVoxel(world, ox, oy + y, oz, Blocks.WOOD);
            }
            const leafRadius = 3;
            for (let x = -leafRadius; x <= leafRadius; x++) {
                for (let y = -leafRadius; y <= 0; y++) {
                    for (let z = -leafRadius; z <= leafRadius; z++) {
                        if (x * x + y * y + z * z <= leafRadius * leafRadius) {
                            const lx = ox + x, ly = oy + height + y, lz = oz + z;
                            if (this._fastGetVoxel(world, lx, ly, lz) === Blocks.AIR) {
                                this._fastSetVoxel(world, lx, ly, lz, Blocks.LEAVES);
                            }
                        }
                    }
                }
            }
        } else {
            // Normal oak tree
            const height = 4 + Math.floor(this.random() * 3);
            for (let y = 0; y < height; y++) {
                this._fastSetVoxel(world, ox, oy + y, oz, Blocks.WOOD);
            }
            const leafRadius = 2;
            for (let x = -leafRadius; x <= leafRadius; x++) {
                for (let y = -leafRadius; y <= leafRadius; y++) {
                    for (let z = -leafRadius; z <= leafRadius; z++) {
                        if (x * x + y * y + z * z <= leafRadius * leafRadius + 1) {
                            const lx = ox + x, ly = oy + height + y, lz = oz + z;
                            if (this._fastGetVoxel(world, lx, ly, lz) === Blocks.AIR) {
                                this._fastSetVoxel(world, lx, ly, lz, Blocks.LEAVES);
                            }
                        }
                    }
                }
            }
        }
    }

    // Big jungle tree: 2x2 trunk, 12-18 blocks tall, large canopy
    _generateBigJungleTree(world, ox, oy, oz) {
        const height = 12 + Math.floor(this.random() * 7);

        // 2x2 trunk
        for (let y = 0; y < height; y++) {
            this._fastSetVoxel(world, ox, oy + y, oz, Blocks.WOOD);
            this._fastSetVoxel(world, ox + 1, oy + y, oz, Blocks.WOOD);
            this._fastSetVoxel(world, ox, oy + y, oz + 1, Blocks.WOOD);
            this._fastSetVoxel(world, ox + 1, oy + y, oz + 1, Blocks.WOOD);
        }

        // Large canopy — mushroom-shaped
        const canopyBase = oy + height - 3;
        const canopyTop = oy + height + 2;
        for (let y = canopyBase; y <= canopyTop; y++) {
            const distFromTop = canopyTop - y;
            const radius = distFromTop <= 1 ? 3 : 5;
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    const d2 = x * x + z * z;
                    if (d2 <= radius * radius) {
                        const lx = ox + x, ly = y, lz = oz + z;
                        if (this._fastGetVoxel(world, lx, ly, lz) === Blocks.AIR) {
                            this._fastSetVoxel(world, lx, ly, lz, Blocks.LEAVES);
                        }
                    }
                }
            }
        }

        // Vines / extra leaves hanging down on edges
        const vineRadius = 4;
        for (let x = -vineRadius; x <= vineRadius; x++) {
            for (let z = -vineRadius; z <= vineRadius; z++) {
                const d2 = x * x + z * z;
                if (d2 >= (vineRadius - 1) * (vineRadius - 1) && d2 <= vineRadius * vineRadius) {
                    if (this.random() < 0.4) {
                        const vineLen = 1 + Math.floor(this.random() * 3);
                        for (let v = 0; v < vineLen; v++) {
                            const lx = ox + x, ly = canopyBase - 1 - v, lz = oz + z;
                            if (this._fastGetVoxel(world, lx, ly, lz) === Blocks.AIR) {
                                this._fastSetVoxel(world, lx, ly, lz, Blocks.LEAVES);
                            }
                        }
                    }
                }
            }
        }
    }

    // Tall 1x1 jungle tree: 8-14 blocks tall, smaller canopy
    _generateTallJungleTree(world, ox, oy, oz) {
        const height = 8 + Math.floor(this.random() * 7);

        // 1x1 trunk
        for (let y = 0; y < height; y++) {
            this._fastSetVoxel(world, ox, oy + y, oz, Blocks.WOOD);
        }

        // Canopy — layered sphere
        const canopyCenter = oy + height;
        for (let y = -2; y <= 2; y++) {
            const radius = y <= 0 ? 3 : 2;
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    if (x * x + y * y + z * z <= radius * radius + 1) {
                        const lx = ox + x, ly = canopyCenter + y, lz = oz + z;
                        if (this._fastGetVoxel(world, lx, ly, lz) === Blocks.AIR) {
                            this._fastSetVoxel(world, lx, ly, lz, Blocks.LEAVES);
                        }
                    }
                }
            }
        }

        // Hanging leaves on edges
        for (let x = -3; x <= 3; x++) {
            for (let z = -3; z <= 3; z++) {
                const d2 = x * x + z * z;
                if (d2 >= 4 && d2 <= 9 && this.random() < 0.3) {
                    const lx = ox + x, ly = canopyCenter - 3, lz = oz + z;
                    if (this._fastGetVoxel(world, lx, ly, lz) === Blocks.AIR) {
                        this._fastSetVoxel(world, lx, ly, lz, Blocks.LEAVES);
                    }
                }
            }
        }
    }
}
