import { Blocks } from './BlockRegistry.js';

export const Biomes = {
    PLAINS: 'plains',
    DESERT: 'desert',
    FOREST: 'forest',
    MOUNTAINS: 'mountains',
    TUNDRA: 'tundra',
    SWAMP: 'swamp',
    BEACH: 'beach', // dynamically applied based on height
};

export class BiomeManager {
    static getBiome(temperature, moisture) {
        if (temperature < 0.3) {
            return Biomes.TUNDRA;
        } else if (temperature > 0.7 && moisture < 0.4) {
            return Biomes.DESERT;
        } else if (temperature > 0.4 && moisture > 0.7) {
            return Biomes.SWAMP;
        } else if (temperature > 0.3 && temperature < 0.7 && moisture > 0.5) {
            return Biomes.FOREST;
        } else if (temperature < 0.5 && moisture < 0.5) {
            return Biomes.MOUNTAINS; // Colder, drier high areas can be mountainous conceptually, but height is determined later
        }
        return Biomes.PLAINS;
    }

    static getBiomeData(biome) {
        switch (biome) {
            case Biomes.DESERT:
                return {
                    surfaceBlock: Blocks.SAND,
                    subSurfaceBlock: Blocks.SAND,
                    heightScale: 0.5,
                    baseHeight: 85,
                    treeChance: 0.0,
                };
            case Biomes.SWAMP:
                return {
                    surfaceBlock: Blocks.DIRT,
                    subSurfaceBlock: Blocks.DIRT,
                    heightScale: 0.15, // very flat
                    baseHeight: 81, // Right at sea level for marshiness
                    treeChance: 0.04, // lots of trees
                };
            case Biomes.FOREST:
                return {
                    surfaceBlock: Blocks.GRASS,
                    subSurfaceBlock: Blocks.DIRT,
                    heightScale: 0.8,
                    baseHeight: 90,
                    treeChance: 0.03, // increased tree chance
                };
            case Biomes.MOUNTAINS:
                return {
                    surfaceBlock: Blocks.STONE,
                    subSurfaceBlock: Blocks.STONE,
                    heightScale: 1.8,
                    baseHeight: 95,
                    treeChance: 0.002, // sparse trees
                };
            case Biomes.TUNDRA:
                return {
                    surfaceBlock: Blocks.SNOW,
                    subSurfaceBlock: Blocks.DIRT,
                    heightScale: 0.7,
                    baseHeight: 88,
                    treeChance: 0.001,
                };
            case Biomes.PLAINS:
            default:
                return {
                    surfaceBlock: Blocks.GRASS,
                    subSurfaceBlock: Blocks.DIRT,
                    heightScale: 0.4,
                    baseHeight: 88,
                    treeChance: 0.003, // sparse trees
                };
        }
    }
}
