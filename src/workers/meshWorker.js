// Mesh Worker — runs naive meshing off the main thread
// Receives: { cellX, cellY, cellZ, chunkSize, chunkData, neighborData }
// chunkData: the target chunk Uint8Array
// neighborData: { "dx,dy,dz": Uint8Array } for 6 neighbors

// Inlined block data (only what meshing needs: transparency, crossShape, texture coords)
const transparentBlocks = new Set([0, 5, 7, 8, 19, 42, 43, 44, 48, 51, 52, 54, 55]);
const crossShapeBlocks = new Set([42, 43, 44, 51]);

// Texture coords: [blockId] -> { all?, top?, side?, bottom?, front? }
const blockTextures = {
    1: { all: [0, 0] },          // Dirt
    2: { top: [1, 2], side: [1, 0], bottom: [1, 1] }, // Grass
    3: { all: [2, 0] },          // Stone
    4: { top: [3, 1], side: [3, 0], bottom: [3, 1] }, // Wood
    5: { all: [4, 0] },          // Leaves
    6: { all: [5, 0] },          // Sand
    7: { all: [6, 0] },          // Glass
    8: { all: [7, 0] },          // Water
    9: { all: [8, 0] },          // Oak Planks
    10: { all: [9, 0] },          // Cobblestone
    11: { all: [10, 0] },         // Coal Ore
    12: { all: [11, 0] },         // Iron Ore
    13: { all: [12, 0] },         // Gold Ore
    14: { all: [13, 0] },         // Diamond Ore
    16: { top: [8, 0], side: [4, 0], bottom: [8, 0] }, // Crafting Table
    17: { front: [9, 0], side: [9, 0], top: [9, 0], bottom: [9, 0] }, // Furnace
    18: { all: [8, 0] },          // Chest
    19: { all: [2, 1] },          // Torch
    40: { all: [14, 0] },         // Snow
    41: { all: [15, 0] },         // Bedrock
    42: { all: [14, 1] },         // Tall Grass
    43: { all: [14, 2] },         // Red Flower
    44: { all: [15, 1] },         // Yellow Flower
    48: { all: [3, 3] },          // Lava
    49: { all: [4, 3] },          // Gravel
    50: { all: [5, 3] },          // Clay
    51: { all: [6, 3] },          // Kelp
    52: { all: [7, 3] },          // Lily Pad
    53: { all: [8, 3] },          // Mossy Cobblestone
    54: { all: [4, 1] },          // Lantern
    55: { top: [5, 1], side: [6, 1], bottom: [5, 1] }, // Cactus
};

const faceNames = ['side', 'side', 'bottom', 'top', 'side', 'side'];

function getBlockTextureCoords(voxel, faceIndex) {
    const tex = blockTextures[voxel];
    if (!tex) return [0, 0];
    const faceName = faceNames[faceIndex];
    return tex[faceName] || tex.all || [0, 0];
}

function isTransparent(voxel) {
    return transparentBlocks.has(voxel);
}

function isCrossShape(voxel) {
    return crossShapeBlocks.has(voxel);
}

// Face definitions matching VoxelWorld.faces
const faces = [
    { dir: [-1, 0, 0], corners: [{ pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
    { dir: [1, 0, 0], corners: [{ pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
    { dir: [0, -1, 0], corners: [{ pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
    { dir: [0, 1, 0], corners: [{ pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
    { dir: [0, 0, -1], corners: [{ pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
    { dir: [0, 0, 1], corners: [{ pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];

// Cross shape quads
const crossFaces = [
    { corners: [[0, 0, 0], [1, 0, 1], [0, 1, 0], [1, 1, 1]], normal: [-0.707, 0, 0.707] },
    { corners: [[1, 0, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]], normal: [0.707, 0, 0.707] },
];

self.onmessage = function (e) {
    const { cellX, cellY, cellZ, chunkSize, chunkData, neighborData } = e.data;

    const chunkSliceSize = chunkSize * chunkSize;

    // Local voxel lookup — reads from chunkData or neighborData
    function emod(n, m) { return ((n % m) + m) % m; }

    function getVoxel(x, y, z) {
        const cx = Math.floor(x / chunkSize);
        const cy = Math.floor(y / chunkSize);
        const cz = Math.floor(z / chunkSize);

        let data;
        if (cx === cellX && cy === cellY && cz === cellZ) {
            data = chunkData;
        } else {
            const dx = cx - cellX, dy = cy - cellY, dz = cz - cellZ;
            const key = `${dx},${dy},${dz}`;
            data = neighborData[key];
        }
        if (!data) return 0;

        const lx = emod(x, chunkSize);
        const ly = emod(y, chunkSize);
        const lz = emod(z, chunkSize);
        return data[ly * chunkSliceSize + lz * chunkSize + lx];
    }

    const tileSize = 16, tileTextureWidth = 256, tileTextureHeight = 256;
    const halfPixel = 0.5 / tileTextureWidth;
    const faceBrightness = [0.8, 0.8, 0.6, 1.0, 0.7, 0.9];

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const colors = [];
    let hasTransparency = false;

    const startX = cellX * chunkSize;
    const startY = cellY * chunkSize;
    const startZ = cellZ * chunkSize;

    for (let y = 0; y < chunkSize; ++y) {
        const voxelY = startY + y;
        for (let z = 0; z < chunkSize; ++z) {
            const voxelZ = startZ + z;
            for (let x = 0; x < chunkSize; ++x) {
                const voxelX = startX + x;
                const voxel = getVoxel(voxelX, voxelY, voxelZ);
                if (!voxel) continue;

                if (isTransparent(voxel)) hasTransparency = true;

                if (isCrossShape(voxel)) {
                    // Cross shape
                    const [texU, texV] = getBlockTextureCoords(voxel, 0);
                    const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                    const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                    const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                    const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

                    for (const face of crossFaces) {
                        const ndx = positions.length / 3;
                        for (let i = 0; i < 4; i++) {
                            const c = face.corners[i];
                            positions.push(c[0] + x, c[1] + y, c[2] + z);
                            normals.push(face.normal[0], face.normal[1], face.normal[2]);
                            colors.push(0.9, 0.9, 0.9);
                        }
                        uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                        indices.push(ndx + 2, ndx + 1, ndx, ndx + 3, ndx + 1, ndx + 2);
                    }
                    continue;
                }

                if (voxel === 19) { // Torch
                    const [texU, texV] = getBlockTextureCoords(voxel, 0);
                    const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                    const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                    const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                    const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

                    const faceU0 = u0 + (u1 - u0) * (6 / 16);
                    const faceU1 = u0 + (u1 - u0) * (10 / 16);

                    const minX = x + 7 / 16, maxX = x + 9 / 16;
                    const minY = y, maxY = y + 10 / 16;
                    const minZ = z + 7 / 16, maxZ = z + 9 / 16;

                    const torchFaces = [
                        { dir: [-1, 0, 0], corners: [{ pos: [minX, maxY, minZ], uv: [0, 1] }, { pos: [minX, minY, minZ], uv: [0, 0] }, { pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [minX, minY, maxZ], uv: [1, 0] }] },
                        { dir: [1, 0, 0], corners: [{ pos: [maxX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, maxY, minZ], uv: [1, 1] }, { pos: [maxX, minY, minZ], uv: [1, 0] }] },
                        { dir: [0, -1, 0], corners: [{ pos: [maxX, minY, maxZ], uv: [1, 0] }, { pos: [minX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, minY, minZ], uv: [1, 1] }, { pos: [minX, minY, minZ], uv: [0, 1] }] },
                        { dir: [0, 1, 0], corners: [{ pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [maxX, maxY, maxZ], uv: [0, 1] }, { pos: [minX, maxY, minZ], uv: [1, 0] }, { pos: [maxX, maxY, minZ], uv: [0, 0] }] },
                        { dir: [0, 0, -1], corners: [{ pos: [maxX, minY, minZ], uv: [0, 0] }, { pos: [minX, minY, minZ], uv: [1, 0] }, { pos: [maxX, maxY, minZ], uv: [0, 1] }, { pos: [minX, maxY, minZ], uv: [1, 1] }] },
                        { dir: [0, 0, 1], corners: [{ pos: [minX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, minY, maxZ], uv: [1, 0] }, { pos: [minX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, maxY, maxZ], uv: [1, 1] }] },
                    ];

                    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
                        const { dir, corners } = torchFaces[faceIndex];
                        const ndx = positions.length / 3;
                        for (let i = 0; i < 4; i++) {
                            const { pos, uv } = corners[i];
                            positions.push(pos[0], pos[1], pos[2]);
                            normals.push(dir[0], dir[1], dir[2]);
                            colors.push(1, 1, 1);

                            const mappedU = uv[0] === 0 ? faceU0 : faceU1;
                            const mappedV = uv[1] === 0 ? v0 : v1;
                            uvs.push(mappedU, mappedV);
                        }
                        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    }
                    continue;
                }

                if (voxel === 52) { // Lily Pad
                    const [texU, texV] = getBlockTextureCoords(voxel, 3);
                    const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                    const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                    const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                    const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

                    const pY = y + 0.03;

                    // Top Face
                    let ndx = positions.length / 3;
                    positions.push(
                        x, pY, z + 1,
                        x + 1, pY, z + 1,
                        x, pY, z,
                        x + 1, pY, z
                    );
                    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
                    colors.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
                    uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                    indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);

                    // Bottom Face
                    ndx = positions.length / 3;
                    positions.push(
                        x + 1, pY - 0.01, z + 1,
                        x, pY - 0.01, z + 1,
                        x + 1, pY - 0.01, z,
                        x, pY - 0.01, z
                    );
                    normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
                    colors.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6);
                    uvs.push(u1, v0, u0, v0, u1, v1, u0, v1);
                    indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);

                    continue;
                }

                if (voxel === 55) { // Cactus
                    const minX = x + 1 / 16, maxX = x + 15 / 16;
                    const minY = y, maxY = y + 1;
                    const minZ = z + 1 / 16, maxZ = z + 15 / 16;

                    const cactusFaces = [
                        { dir: [-1, 0, 0], corners: [{ pos: [minX, maxY, minZ], uv: [0, 1] }, { pos: [minX, minY, minZ], uv: [0, 0] }, { pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [minX, minY, maxZ], uv: [1, 0] }] },
                        { dir: [1, 0, 0], corners: [{ pos: [maxX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, maxY, minZ], uv: [1, 1] }, { pos: [maxX, minY, minZ], uv: [1, 0] }] },
                        { dir: [0, -1, 0], corners: [{ pos: [maxX, minY, maxZ], uv: [1, 0] }, { pos: [minX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, minY, minZ], uv: [1, 1] }, { pos: [minX, minY, minZ], uv: [0, 1] }] },
                        { dir: [0, 1, 0], corners: [{ pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [maxX, maxY, maxZ], uv: [0, 1] }, { pos: [minX, maxY, minZ], uv: [1, 0] }, { pos: [maxX, maxY, minZ], uv: [0, 0] }] },
                        { dir: [0, 0, -1], corners: [{ pos: [maxX, minY, minZ], uv: [0, 0] }, { pos: [minX, minY, minZ], uv: [1, 0] }, { pos: [maxX, maxY, minZ], uv: [0, 1] }, { pos: [minX, maxY, minZ], uv: [1, 1] }] },
                        { dir: [0, 0, 1], corners: [{ pos: [minX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, minY, maxZ], uv: [1, 0] }, { pos: [minX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, maxY, maxZ], uv: [1, 1] }] },
                    ];

                    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
                        const { dir, corners } = cactusFaces[faceIndex];
                        const [texU, texV] = getBlockTextureCoords(voxel, faceIndex);
                        const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                        const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                        const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                        const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

                        const ndx = positions.length / 3;
                        for (let i = 0; i < 4; i++) {
                            const { pos, uv } = corners[i];
                            positions.push(pos[0], pos[1], pos[2]);
                            normals.push(dir[0], dir[1], dir[2]);

                            const brightness = faceBrightness[faceIndex];
                            colors.push(brightness, brightness, brightness);

                            const mappedU = uv[0] === 0 ? u0 : u1;
                            const mappedV = uv[1] === 0 ? v0 : v1;
                            uvs.push(mappedU, mappedV);
                        }
                        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    }
                    continue;
                }

                if (voxel === 54) { // Lantern
                    const minX = x + 4 / 16, maxX = x + 12 / 16;
                    const minY = y, maxY = y + 12 / 16;
                    const minZ = z + 4 / 16, maxZ = z + 12 / 16;

                    const lanternFaces = [
                        { dir: [-1, 0, 0], corners: [{ pos: [minX, maxY, minZ], uv: [0, 1] }, { pos: [minX, minY, minZ], uv: [0, 0] }, { pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [minX, minY, maxZ], uv: [1, 0] }] },
                        { dir: [1, 0, 0], corners: [{ pos: [maxX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, maxY, minZ], uv: [1, 1] }, { pos: [maxX, minY, minZ], uv: [1, 0] }] },
                        { dir: [0, -1, 0], corners: [{ pos: [maxX, minY, maxZ], uv: [1, 0] }, { pos: [minX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, minY, minZ], uv: [1, 1] }, { pos: [minX, minY, minZ], uv: [0, 1] }] },
                        { dir: [0, 1, 0], corners: [{ pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [maxX, maxY, maxZ], uv: [0, 1] }, { pos: [minX, maxY, minZ], uv: [1, 0] }, { pos: [maxX, maxY, minZ], uv: [0, 0] }] },
                        { dir: [0, 0, -1], corners: [{ pos: [maxX, minY, minZ], uv: [0, 0] }, { pos: [minX, minY, minZ], uv: [1, 0] }, { pos: [maxX, maxY, minZ], uv: [0, 1] }, { pos: [minX, maxY, minZ], uv: [1, 1] }] },
                        { dir: [0, 0, 1], corners: [{ pos: [minX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, minY, maxZ], uv: [1, 0] }, { pos: [minX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, maxY, maxZ], uv: [1, 1] }] },
                    ];

                    const [texU, texV] = getBlockTextureCoords(voxel, 0);
                    const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                    const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                    const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                    const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

                    // Lantern model uses partial bounding box mapping
                    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
                        const { dir, corners } = lanternFaces[faceIndex];
                        const ndx = positions.length / 3;
                        for (let i = 0; i < 4; i++) {
                            const { pos, uv } = corners[i];
                            positions.push(pos[0], pos[1], pos[2]);
                            normals.push(dir[0], dir[1], dir[2]);

                            const brightness = faceBrightness[faceIndex];
                            colors.push(brightness, brightness, brightness);

                            // Map front/side 4-12 to the texture appropriately
                            const mappedU = uv[0] === 0 ? u0 + (u1 - u0) * (4 / 16) : u0 + (u1 - u0) * (12 / 16);
                            const mappedV = uv[1] === 0 ? v0 : v0 + (v1 - v0) * (12 / 16);
                            uvs.push(mappedU, mappedV);
                        }
                        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    }

                    // Lantern Chain (Top part)
                    const chainMinX = x + 7 / 16, chainMaxX = x + 9 / 16;
                    const chainMinY = y + 12 / 16, chainMaxY = y + 1;
                    const chainMinZ = z + 7 / 16, chainMaxZ = z + 9 / 16;

                    const chainFaces = [
                        { dir: [-1, 0, 0], corners: [{ pos: [chainMinX, chainMaxY, chainMinZ], uv: [0, 1] }, { pos: [chainMinX, chainMinY, chainMinZ], uv: [0, 0] }, { pos: [chainMinX, chainMaxY, chainMaxZ], uv: [1, 1] }, { pos: [chainMinX, chainMinY, chainMaxZ], uv: [1, 0] }] },
                        { dir: [1, 0, 0], corners: [{ pos: [chainMaxX, chainMaxY, chainMaxZ], uv: [0, 1] }, { pos: [chainMaxX, chainMinY, chainMaxZ], uv: [0, 0] }, { pos: [chainMaxX, chainMaxY, chainMinZ], uv: [1, 1] }, { pos: [chainMaxX, chainMinY, chainMinZ], uv: [1, 0] }] },
                        { dir: [0, 0, -1], corners: [{ pos: [chainMaxX, chainMinY, chainMinZ], uv: [0, 0] }, { pos: [chainMinX, chainMinY, chainMinZ], uv: [1, 0] }, { pos: [chainMaxX, chainMaxY, chainMinZ], uv: [0, 1] }, { pos: [chainMinX, chainMaxY, chainMinZ], uv: [1, 1] }] },
                        { dir: [0, 0, 1], corners: [{ pos: [chainMinX, chainMinY, chainMaxZ], uv: [0, 0] }, { pos: [chainMaxX, chainMinY, chainMaxZ], uv: [1, 0] }, { pos: [chainMinX, chainMaxY, chainMaxZ], uv: [0, 1] }, { pos: [chainMaxX, chainMaxY, chainMaxZ], uv: [1, 1] }] },
                    ];

                    for (let faceIndex = 0; faceIndex < 4; faceIndex++) {
                        const { dir, corners } = chainFaces[faceIndex];
                        const ndx = positions.length / 3;
                        for (let i = 0; i < 4; i++) {
                            const { pos, uv } = corners[i];
                            positions.push(pos[0], pos[1], pos[2]);
                            normals.push(dir[0], dir[1], dir[2]);
                            colors.push(0.3, 0.3, 0.3);
                            uvs.push(u0, v0); // Doesn't matter, small black dot
                        }
                        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    }

                    continue;
                }

                for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
                    const { dir, corners } = faces[faceIndex];
                    const neighbor = getVoxel(voxelX + dir[0], voxelY + dir[1], voxelZ + dir[2]);
                    const nTrans = isTransparent(neighbor);
                    const shouldRenderFace = nTrans && !(isTransparent(voxel) && voxel === neighbor);

                    if (shouldRenderFace) {
                        const ndx = positions.length / 3;
                        const [texU, texV] = getBlockTextureCoords(voxel, faceIndex);

                        // Water pooling: lower the top face if the block above (or current block) is water, and block directly above is AIR
                        let isWaterTop = false;
                        if (voxel === 8 && faceIndex === 3) {
                            const blockAbove = getVoxel(voxelX, voxelY + 1, voxelZ);
                            if (blockAbove !== 8) {
                                isWaterTop = true;
                            }
                        }

                        // Cave darkness
                        let depthDim = 1.0;
                        const skyLevel = 80;
                        if (voxelY < skyLevel) {
                            let hasSkyAccess = false;
                            for (let checkY = voxelY + 1; checkY <= Math.min(voxelY + 10, skyLevel + 5); checkY++) {
                                if (getVoxel(voxelX, checkY, voxelZ) === 0) {
                                    if (checkY >= skyLevel) { hasSkyAccess = true; break; }
                                } else break;
                            }
                            if (!hasSkyAccess) {
                                const depth = skyLevel - voxelY;
                                depthDim = Math.max(0.25, 1.0 - depth * 0.015);
                            }
                        }

                        for (const { pos, uv } of corners) {
                            let py = pos[1] + y;
                            if (isWaterTop) {
                                // Lower the water surface slightly
                                py -= 0.15;
                            }
                            positions.push(pos[0] + x, py, pos[2] + z);
                            normals.push(dir[0], dir[1], dir[2]);
                            const brightness = faceBrightness[faceIndex] * depthDim;
                            colors.push(brightness, brightness, brightness);
                            uvs.push(
                                ((texU + uv[0]) * tileSize) / tileTextureWidth + (uv[0] === 0 ? halfPixel : -halfPixel),
                                1 - ((texV + 1 - uv[1]) * tileSize) / tileTextureHeight + (uv[1] === 0 ? halfPixel : -halfPixel)
                            );
                        }
                        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    }
                }
            }
        }
    }

    // Convert to typed arrays for transfer
    const posArr = new Float32Array(positions);
    const normArr = new Float32Array(normals);
    const uvArr = new Float32Array(uvs);
    const colorArr = new Float32Array(colors);
    const idxArr = new Uint32Array(indices);

    self.postMessage(
        { cellX, cellY, cellZ, positions: posArr, normals: normArr, uvs: uvArr, colors: colorArr, indices: idxArr, hasTransparency },
        [posArr.buffer, normArr.buffer, uvArr.buffer, colorArr.buffer, idxArr.buffer]
    );
};
