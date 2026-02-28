import { Blocks } from './BlockRegistry.js';

export const Biomes = {
    PLAINS: 'plains',
    DESERT: 'desert',
    FOREST: 'forest',
    MOUNTAINS: 'mountains',
    TUNDRA: 'tundra',
    SWAMP: 'swamp',
    BEACH: 'beach',
    OCEAN: 'ocean',
    DEEP_OCEAN: 'deep_ocean',
};

export class BiomeManager {
    static getBiome(temperature, moisture, continentalness) {
        // Ocean biomes based on continentalness (how far inland)
        if (continentalness < 0.25) {
            return Biomes.DEEP_OCEAN;
        }
        if (continentalness < 0.38) {
            return Biomes.OCEAN;
        }
        // Beach at the coast edge
        if (continentalness < 0.42) {
            return Biomes.BEACH;
        }

        // Land biomes
        if (temperature < 0.3) {
            return Biomes.TUNDRA;
        } else if (temperature > 0.7 && moisture < 0.4) {
            return Biomes.DESERT;
        } else if (temperature > 0.4 && moisture > 0.7) {
            return Biomes.SWAMP;
        } else if (temperature > 0.3 && temperature < 0.7 && moisture > 0.5) {
            return Biomes.FOREST;
        } else if (temperature < 0.5 && moisture < 0.5) {
            return Biomes.MOUNTAINS;
        }
        return Biomes.PLAINS;
    }

    static getBiomeData(biome) {
        switch (biome) {
            case Biomes.DEEP_OCEAN:
                return {
                    surfaceBlock: Blocks.GRAVEL,
                    subSurfaceBlock: Blocks.GRAVEL,
                    heightScale: 0.3,
                    baseHeight: 45,
                    treeChance: 0.0,
                };
            case Biomes.OCEAN:
                return {
                    surfaceBlock: Blocks.SAND,
                    subSurfaceBlock: Blocks.SAND,
                    heightScale: 0.4,
                    baseHeight: 58,
                    treeChance: 0.0,
                };
            case Biomes.BEACH:
                return {
                    surfaceBlock: Blocks.SAND,
                    subSurfaceBlock: Blocks.SAND,
                    heightScale: 0.2,
                    baseHeight: 80,
                    treeChance: 0.0,
                };
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
                    heightScale: 0.15,
                    baseHeight: 79,
                    treeChance: 0.04,
                };
            case Biomes.FOREST:
                return {
                    surfaceBlock: Blocks.GRASS,
                    subSurfaceBlock: Blocks.DIRT,
                    heightScale: 0.8,
                    baseHeight: 88,
                    treeChance: 0.03,
                };
            case Biomes.MOUNTAINS:
                return {
                    surfaceBlock: Blocks.STONE,
                    subSurfaceBlock: Blocks.STONE,
                    heightScale: 1.8,
                    baseHeight: 95,
                    treeChance: 0.002,
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
                    baseHeight: 86,
                    treeChance: 0.003,
                };
        }
    }

    /**
     * Blend biome numeric data across nearby sample points for smooth transitions.
     * Returns blended { baseHeight, heightScale, treeChance } plus the center biome
     * for surface block selection.
     */
    static getBlendedBiomeData(centerX, centerZ, getTempMoistCont) {
        const BLEND_RADIUS = 4; // sample grid radius
        const STEP = 8;         // spacing between samples

        let totalWeight = 0;
        let blendedBaseHeight = 0;
        let blendedHeightScale = 0;
        let blendedTreeChance = 0;

        // Track the center biome separately
        const { temp: cTemp, moist: cMoist, cont: cCont } = getTempMoistCont(centerX, centerZ);
        const centerBiome = BiomeManager.getBiome(cTemp, cMoist, cCont);
        const centerData = BiomeManager.getBiomeData(centerBiome);

        for (let dx = -BLEND_RADIUS; dx <= BLEND_RADIUS; dx++) {
            for (let dz = -BLEND_RADIUS; dz <= BLEND_RADIUS; dz++) {
                const sx = centerX + dx * STEP;
                const sz = centerZ + dz * STEP;
                const dist2 = dx * dx + dz * dz;
                if (dist2 > BLEND_RADIUS * BLEND_RADIUS) continue;

                const weight = 1 / (1 + dist2);
                const { temp, moist, cont } = getTempMoistCont(sx, sz);
                const biome = BiomeManager.getBiome(temp, moist, cont);
                const bd = BiomeManager.getBiomeData(biome);

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
}
