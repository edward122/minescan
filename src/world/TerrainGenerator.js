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

        // For caves
        this.noise3D_caves1 = createNoise3D(prng); // Spaghetti
        this.noise3D_caves2 = createNoise3D(prng); // Swiss cheese
        this.noise3D_ores = createNoise3D(prng); // Ores

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

    generateChunkData(world, chunkX, chunkZ) {
        const { chunkSize } = world;
        const startX = chunkX * chunkSize;
        const startZ = chunkZ * chunkSize;

        const treePositions = [];
        const decoPositions = [];

        for (let ix = 0; ix < chunkSize; ix++) {
            for (let iz = 0; iz < chunkSize; iz++) {
                const x = startX + ix;
                const z = startZ + iz;

                // 1. Biome Generation
                const temp = (this.fBm(x, z, this.noise2D_temp, 3, 0.5, 2, 800) + 1) / 2;
                const moist = (this.fBm(x, z, this.noise2D_moist, 3, 0.5, 2, 800) + 1) / 2;
                let biome = BiomeManager.getBiome(temp, moist);

                const heightNoise = this.fBm(x, z, this.noise2D_elev1, 4, 0.5, 2.0, 300);
                const detailNoise = this.fBm(x, z, this.noise2D_elev2, 4, 0.5, 2.0, 50);
                const baseHeightScale = (heightNoise + 1) / 2;

                let biomeData = BiomeManager.getBiomeData(biome);

                let terrainHeight = Math.floor(
                    biomeData.baseHeight +
                    (baseHeightScale * 40 * biomeData.heightScale) +
                    (detailNoise * 5 * biomeData.heightScale)
                );

                // Beach Transition — only at the very edge of water
                if (biome === Biomes.PLAINS || biome === Biomes.FOREST || biome === Biomes.SWAMP) {
                    if (terrainHeight >= this.seaLevel - 1 && terrainHeight <= this.seaLevel + 1) {
                        biome = Biomes.BEACH;
                        const beachData = BiomeManager.getBiomeData(Biomes.DESERT); // Use sand
                        biomeData = { ...beachData, baseHeight: terrainHeight, treeChance: 0 };
                    }
                }

                if (terrainHeight < 1) terrainHeight = 1;

                // Track if we hit surface air yet for tall plants/decorators
                let surfaceIsLiquid = false;

                // Generate Column
                for (let y = 0; y <= Math.max(terrainHeight, this.seaLevel); y++) {
                    let blockId = Blocks.AIR;

                    if (y === 0) {
                        blockId = Blocks.BEDROCK;
                    } else if (y <= terrainHeight) {
                        if (y === terrainHeight) {
                            blockId = biomeData.surfaceBlock;
                            if (biome === Biomes.MOUNTAINS && y > 120) {
                                blockId = Blocks.SNOW;
                            }
                        } else if (y > terrainHeight - 4) {
                            blockId = biomeData.subSurfaceBlock;
                        } else {
                            blockId = Blocks.STONE;

                            // Clustered Ore Generation
                            const oreNoise = this.noise3D_ores(x / 15, y / 15, z / 15);
                            if (oreNoise > 0.88) { // Ore vein threshold
                                // Distribute ore types by depth within veins
                                if (y < 20 && (oreNoise * 10) % 1 > 0.5) blockId = Blocks.DIAMOND_ORE;
                                else if (y < 40 && (oreNoise * 10) % 1 > 0.3) blockId = Blocks.GOLD_ORE;
                                else if (y < 70) blockId = Blocks.IRON_ORE;
                                else blockId = Blocks.COAL_ORE;
                            }
                        }

                        // Caves
                        if (y > 3 && y < terrainHeight - 3) {
                            const n1 = this.noise3D_caves1(x / 40, y / 40, z / 40); // spaghetti
                            const n2 = this.noise3D_caves2(x / 25, y / 25, z / 25); // swiss cheese

                            // Carve conditions
                            if (Math.abs(n1) < 0.05 || n2 > 0.55) {
                                // Lava pools in deep caves
                                if (y < 15) {
                                    blockId = Blocks.LAVA;
                                } else if (y < 22 && this.hash(x, y, z) % 100 < 30) {
                                    blockId = Blocks.LAVA;
                                } else {
                                    blockId = Blocks.AIR;

                                    // Cave floor gravel
                                    if (world.getVoxel(x, y - 1, z) === Blocks.STONE && this.hash(x, y, z) % 100 < 15) {
                                        blockId = Blocks.GRAVEL;
                                    }
                                }
                            }
                        }

                    } else if (y <= this.seaLevel) {
                        // Water filling
                        blockId = Blocks.WATER;
                        surfaceIsLiquid = true;

                        // Water floor modification
                        if (y === terrainHeight + 1) {
                            const floorChance = this.hash(x, y, z) % 100;
                            if (floorChance < 10) world.setVoxel(x, terrainHeight, z, Blocks.CLAY, true);
                            else if (floorChance < 15) world.setVoxel(x, terrainHeight, z, Blocks.GRAVEL, true);
                            else if (biome !== Biomes.SWAMP) world.setVoxel(x, terrainHeight, z, Blocks.SAND, true);
                        }
                    }

                    if (blockId !== Blocks.AIR) {
                        world.setVoxel(x, y, z, blockId, true);
                    }
                }

                // Surface Decorators
                if (!surfaceIsLiquid && terrainHeight >= this.seaLevel) {
                    const surfaceBlock = world.getVoxel(x, terrainHeight, z);

                    // Trees
                    if (surfaceBlock !== Blocks.AIR && this.random() < biomeData.treeChance) {
                        treePositions.push({ x, y: terrainHeight + 1, z, biome });
                    }
                    // Grass & Flowers
                    else if (surfaceBlock === Blocks.GRASS) {
                        const decoRand = this.random();
                        if (decoRand < 0.05) world.setVoxel(x, terrainHeight + 1, z, Blocks.TALL_GRASS, true);
                        else if (decoRand < 0.06) world.setVoxel(x, terrainHeight + 1, z, this.random() < 0.5 ? Blocks.FLOWER_RED : Blocks.FLOWER_YELLOW, true);
                    }
                    // Boulders & Logs
                    else if ((biome === Biomes.FOREST || biome === Biomes.PLAINS) && this.random() < 0.005) {
                        decoPositions.push({ x, y: terrainHeight + 1, z, type: this.random() < 0.5 ? 'boulder' : 'log' });
                    }
                }

                // Water Decorators
                if (surfaceIsLiquid) {
                    const waterDepth = this.seaLevel - terrainHeight;
                    // Kelp
                    if (waterDepth > 3 && this.random() < 0.05) {
                        const kelpHeight = 2 + Math.floor(this.random() * (waterDepth - 2));
                        for (let k = 0; k < kelpHeight; k++) {
                            world.setVoxel(x, terrainHeight + 1 + k, z, Blocks.KELP, true);
                        }
                    }
                    // Lily pad
                    if (biome === Biomes.SWAMP && waterDepth > 0 && this.random() < 0.1) {
                        world.setVoxel(x, this.seaLevel + 1, z, Blocks.LILY_PAD, true);
                    }
                }
            }
        }

        // Decorators
        for (const deco of decoPositions) {
            if (deco.type === 'boulder') {
                world.setVoxel(deco.x, deco.y, deco.z, Blocks.MOSSY_COBBLESTONE, true);
                if (this.random() < 0.5) world.setVoxel(deco.x + 1, deco.y, deco.z, Blocks.MOSSY_COBBLESTONE, true);
                if (this.random() < 0.5) world.setVoxel(deco.x, deco.y + 1, deco.z, Blocks.MOSSY_COBBLESTONE, true);
            } else if (deco.type === 'log') {
                const len = 3 + Math.floor(this.random() * 2);
                const axis = this.random() < 0.5 ? { dx: 1, dz: 0 } : { dx: 0, dz: 1 };
                for (let i = 0; i < len; i++) {
                    // Check if air
                    if (world.getVoxel(deco.x + axis.dx * i, deco.y, deco.z + axis.dz * i) === Blocks.AIR) {
                        world.setVoxel(deco.x + axis.dx * i, deco.y, deco.z + axis.dz * i, Blocks.WOOD, true);
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
        // Swamp trees are shorter and have flatter canopy
        const isSwamp = biome === Biomes.SWAMP;
        const height = isSwamp ? 3 + Math.floor(this.random() * 2) : 4 + Math.floor(this.random() * 3);

        // Trunk
        for (let y = 0; y < height; y++) {
            world.setVoxel(ox, oy + y, oz, Blocks.WOOD, true);
        }

        // Leaves (simple sphere-ish)
        const leafRadius = isSwamp ? 3 : 2;
        for (let x = -leafRadius; x <= leafRadius; x++) {
            for (let y = -leafRadius; y <= (isSwamp ? 0 : leafRadius); y++) {
                for (let z = -leafRadius; z <= leafRadius; z++) {
                    // Distance check for rough sphere
                    const limit = isSwamp ? leafRadius * leafRadius : leafRadius * leafRadius + 1;
                    if (x * x + y * y + z * z <= limit) {
                        const lx = ox + x;
                        const ly = oy + height + y;
                        const lz = oz + z;

                        // Don't overwrite trunk
                        if (world.getVoxel(lx, ly, lz) === Blocks.AIR) {
                            world.setVoxel(lx, ly, lz, Blocks.LEAVES, true);
                        }
                    }
                }
            }
        }
    }
}
