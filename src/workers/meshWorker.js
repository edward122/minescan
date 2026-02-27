// Mesh Worker — runs naive meshing off the main thread
// Receives: { cellX, cellY, cellZ, chunkSize, chunkData, neighborData }
// chunkData: the target chunk Uint8Array
// neighborData: { "dx,dy,dz": Uint8Array } for 6 neighbors

// Inlined block data (only what meshing needs: transparency, crossShape, texture coords)
const transparentBlocks = new Set([0, 5, 7, 8, 18, 19, 42, 43, 44, 48, 51, 52, 54, 55, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82]);
const crossShapeBlocks = new Set([42, 43, 44, 51]);
// Blocks with custom meshes (not standard cubes, not cross shapes)
const customMeshBlocks = new Set([18, 19, 52, 54, 55, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82]);

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
    // Phase 1 new blocks
    62: { top: [8, 0], side: [6, 4], bottom: [8, 0] }, // Bookshelf
    63: { top: [8, 4], side: [7, 4], bottom: [8, 4] }, // TNT
    64: { all: [9, 4] },          // White Wool
    65: { all: [10, 4] },         // Red Wool
    66: { all: [11, 4] },         // Blue Wool
    67: { all: [12, 4] },         // Green Wool
    68: { all: [13, 4] },         // Yellow Wool
    69: { all: [14, 4] },         // Black Wool
    // Phase 2 custom shape blocks
    70: { all: [0, 11] },         // Oak Door
    71: { all: [1, 11] },         // Oak Fence
    72: { all: [2, 11] },         // Ladder
    73: { all: [8, 0] },          // Oak Slab (uses plank texture)
    74: { all: [8, 0] },          // Oak Stairs (uses plank texture)
    75: { all: [3, 11] },         // Sign
    76: { all: [4, 11] },         // Trapdoor
    77: { top: [5, 11], side: [6, 11], bottom: [8, 0] }, // Bed
    78: { all: [0, 12] },         // Oak Door Top
    79: { all: [0, 11] },         // Oak Door Bottom Open
    80: { all: [0, 12] },         // Oak Door Top Open
    81: { all: [4, 11] },         // Trapdoor Open
};

const faceNames = ['left', 'right', 'bottom', 'top', 'back', 'front'];

function getBlockTextureCoords(voxel, faceIndex) {
    const tex = blockTextures[voxel];
    if (!tex) return [0, 0];
    const faceName = faceNames[faceIndex];
    if (tex[faceName]) return tex[faceName];
    if (tex.side && (faceName === 'left' || faceName === 'right' || faceName === 'front' || faceName === 'back')) return tex.side;
    return tex.all || [0, 0];
}

function isTransparent(voxel) {
    return transparentBlocks.has(voxel);
}

function isCrossShape(voxel) {
    return crossShapeBlocks.has(voxel);
}

function isCustomMesh(voxel) {
    return customMeshBlocks.has(voxel);
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

// Helper to add a box mesh (arbitrary bounds) with per-face textures
function addBoxMesh(x, y, z, minX, minY, minZ, maxX, maxY, maxZ, voxel,
    positions, normals, uvs, indices, colors,
    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness) {

    const boxFaces = [
        {
            dir: [-1, 0, 0], fi: 0, corners: [
                { pos: [minX, maxY, minZ], uv: [0, 1] }, { pos: [minX, minY, minZ], uv: [0, 0] },
                { pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [minX, minY, maxZ], uv: [1, 0] }]
        },
        {
            dir: [1, 0, 0], fi: 1, corners: [
                { pos: [maxX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, minY, maxZ], uv: [0, 0] },
                { pos: [maxX, maxY, minZ], uv: [1, 1] }, { pos: [maxX, minY, minZ], uv: [1, 0] }]
        },
        {
            dir: [0, -1, 0], fi: 2, corners: [
                { pos: [maxX, minY, maxZ], uv: [1, 0] }, { pos: [minX, minY, maxZ], uv: [0, 0] },
                { pos: [maxX, minY, minZ], uv: [1, 1] }, { pos: [minX, minY, minZ], uv: [0, 1] }]
        },
        {
            dir: [0, 1, 0], fi: 3, corners: [
                { pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [maxX, maxY, maxZ], uv: [0, 1] },
                { pos: [minX, maxY, minZ], uv: [1, 0] }, { pos: [maxX, maxY, minZ], uv: [0, 0] }]
        },
        {
            dir: [0, 0, -1], fi: 4, corners: [
                { pos: [maxX, minY, minZ], uv: [0, 0] }, { pos: [minX, minY, minZ], uv: [1, 0] },
                { pos: [maxX, maxY, minZ], uv: [0, 1] }, { pos: [minX, maxY, minZ], uv: [1, 1] }]
        },
        {
            dir: [0, 0, 1], fi: 5, corners: [
                { pos: [minX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, minY, maxZ], uv: [1, 0] },
                { pos: [minX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, maxY, maxZ], uv: [1, 1] }]
        },
    ];

    for (const face of boxFaces) {
        const [texU, texV] = getBlockTextureCoords(voxel, face.fi);
        const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
        const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
        const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
        const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

        const ndx = positions.length / 3;
        const brightness = faceBrightness[face.fi];
        for (const { pos, uv } of face.corners) {
            positions.push(pos[0], pos[1], pos[2]);
            normals.push(face.dir[0], face.dir[1], face.dir[2]);
            colors.push(brightness, brightness, brightness);
            uvs.push(uv[0] === 0 ? u0 : u1, uv[1] === 0 ? v0 : v1);
        }
        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
    }
}

function _addChestPartMesh(x, y, z, minX, minY, minZ, maxX, maxY, maxZ,
    positions, normals, uvs, indices, colors,
    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, isLid) {

    // Texture atlas coordinates for chest faces
    // 18 is Chest. getBlockTextureCoords returns [u, v] array.
    const texCoords = [
        getBlockTextureCoords(18, 0), // Left [-X] (Side)
        getBlockTextureCoords(18, 1), // Right [+X] (Side)
        getBlockTextureCoords(18, 2), // Bottom [-Y]
        getBlockTextureCoords(18, 3), // Top [+Y]
        getBlockTextureCoords(18, 4), // Back [-Z] (Side)
        getBlockTextureCoords(18, 5)  // Front [+Z]
    ];

    const boxFaces = [
        {
            dir: [-1, 0, 0], fi: 0, corners: [
                { pos: [minX, maxY, minZ], uv: [0, 1] }, { pos: [minX, minY, minZ], uv: [0, 0] },
                { pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [minX, minY, maxZ], uv: [1, 0] }]
        },
        {
            dir: [1, 0, 0], fi: 1, corners: [
                { pos: [maxX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, minY, maxZ], uv: [0, 0] },
                { pos: [maxX, maxY, minZ], uv: [1, 1] }, { pos: [maxX, minY, minZ], uv: [1, 0] }]
        },
        {
            dir: [0, -1, 0], fi: 2, corners: [
                { pos: [maxX, minY, maxZ], uv: [1, 0] }, { pos: [minX, minY, maxZ], uv: [0, 0] },
                { pos: [maxX, minY, minZ], uv: [1, 1] }, { pos: [minX, minY, minZ], uv: [0, 1] }]
        },
        {
            dir: [0, 1, 0], fi: 3, corners: [
                { pos: [minX, maxY, maxZ], uv: [1, 1] }, { pos: [maxX, maxY, maxZ], uv: [0, 1] },
                { pos: [minX, maxY, minZ], uv: [1, 0] }, { pos: [maxX, maxY, minZ], uv: [0, 0] }]
        },
        {
            dir: [0, 0, -1], fi: 4, corners: [
                { pos: [maxX, minY, minZ], uv: [0, 0] }, { pos: [minX, minY, minZ], uv: [1, 0] },
                { pos: [maxX, maxY, minZ], uv: [0, 1] }, { pos: [minX, maxY, minZ], uv: [1, 1] }]
        },
        {
            dir: [0, 0, 1], fi: 5, corners: [
                { pos: [minX, minY, maxZ], uv: [0, 0] }, { pos: [maxX, minY, maxZ], uv: [1, 0] },
                { pos: [minX, maxY, maxZ], uv: [0, 1] }, { pos: [maxX, maxY, maxZ], uv: [1, 1] }]
        }
    ];

    for (const face of boxFaces) {
        const [texU, texV] = texCoords[face.fi];
        const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
        const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
        // Native texture mapping: vBottom is the BOTTOM coordinate (e.g. 0.25), vTop is the TOP coordinate (e.g. 0.3125)
        let vBottom = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
        let vTop = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

        // Adjust vertical texture coordinates based on piece
        if (face.fi === 0 || face.fi === 1 || face.fi === 4 || face.fi === 5) { // Sides
            const totalH = vTop - vBottom;
            const splitV = vBottom + totalH * (10 / 14);
            if (isLid) {
                vBottom = splitV; // Lid uses top part of texture
            } else {
                vTop = splitV; // Base uses bottom part of texture
            }
        }

        const ndx = positions.length / 3;
        const brightness = faceBrightness[face.fi];
        for (const { pos, uv } of face.corners) {
            positions.push(pos[0], pos[1], pos[2]);
            normals.push(face.dir[0], face.dir[1], face.dir[2]);
            colors.push(brightness, brightness, brightness);
            // uv[1] == 0 is bottom corner of the face, uv[1] == 1 is top corner of the face
            uvs.push(uv[0] === 0 ? u0 : u1, uv[1] === 0 ? vBottom : vTop);
        }
        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
    }
}

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
                    addBoxMesh(x, y, z, x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 1, z + 15 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 54) { // Lantern
                    // Main body
                    addBoxMesh(x, y, z, x + 4 / 16, y, z + 4 / 16, x + 12 / 16, y + 12 / 16, z + 12 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    // Chain
                    addBoxMesh(x, y, z, x + 7 / 16, y + 12 / 16, z + 7 / 16, x + 9 / 16, y + 1, z + 9 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                // ===== Phase 2 Custom Meshes =====

                if (voxel === 18 || voxel === 82) { // Chest or Chest Open
                    let minX = x + 1 / 16, maxX = x + 15 / 16;
                    let minZ = z + 1 / 16, maxZ = z + 15 / 16;

                    // Check neighbors to seamlessly join double chests
                    const nxp = getVoxel(x + 1, y, z);
                    const nxn = getVoxel(x - 1, y, z);
                    const nzp = getVoxel(x, y, z + 1);
                    const nzn = getVoxel(x, y, z - 1);

                    if (nxp === 18 || nxp === 82) maxX = x + 1;
                    if (nxn === 18 || nxn === 82) minX = x;
                    if (nzp === 18 || nzp === 82) maxZ = z + 1;
                    if (nzn === 18 || nzn === 82) minZ = z;

                    if (voxel === 18) { // Closed
                        _addChestPartMesh(x, y, z, minX, y, minZ, maxX, y + 10 / 16, maxZ,
                            positions, normals, uvs, indices, colors,
                            tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, false);
                        _addChestPartMesh(x, y, z, minX, y + 10 / 16, minZ, maxX, y + 14 / 16, maxZ,
                            positions, normals, uvs, indices, colors,
                            tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, true);
                    } else { // Open
                        _addChestPartMesh(x, y, z, minX, y, minZ, maxX, y + 10 / 16, maxZ,
                            positions, normals, uvs, indices, colors,
                            tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, false);
                        _addChestPartMesh(x, y, z, minX, y + 10 / 16, z + 11 / 16, maxX, y + 24 / 16, z + 15 / 16,
                            positions, normals, uvs, indices, colors,
                            tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, true);
                    }
                    continue;
                }

                if (voxel === 70 || voxel === 78) { // Door closed (bottom or top)
                    // Hinge on z=0, door extends along z, flat against x
                    addBoxMesh(x, y, z, x, y, z, x + 3 / 16, y + 1, z + 1, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 79 || voxel === 80) { // Door open (bottom or top)
                    // Swing open 90 degrees (flat against z)
                    addBoxMesh(x, y, z, x, y, z, x + 1, y + 1, z + 3 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 71) { // Fence — center post + rails
                    // Center post (4/16 × 16/16 × 4/16)
                    addBoxMesh(x, y, z, x + 6 / 16, y, z + 6 / 16, x + 10 / 16, y + 1, z + 10 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    // Top rail
                    addBoxMesh(x, y, z, x, y + 12 / 16, z + 7 / 16, x + 1, y + 15 / 16, z + 9 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    // Bottom rail
                    addBoxMesh(x, y, z, x, y + 6 / 16, z + 7 / 16, x + 1, y + 9 / 16, z + 9 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 72) { // Ladder — flat plane on back face
                    const [texU, texV] = getBlockTextureCoords(voxel, 0);
                    const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                    const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                    const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                    const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

                    const lz = z + 1 / 16; // Against back wall
                    // Front face
                    let ndx = positions.length / 3;
                    positions.push(x, y, lz, x + 1, y, lz, x, y + 1, lz, x + 1, y + 1, lz);
                    normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
                    colors.push(0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9);
                    uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                    indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    // Back face
                    ndx = positions.length / 3;
                    positions.push(x + 1, y, lz - 0.01, x, y, lz - 0.01, x + 1, y + 1, lz - 0.01, x, y + 1, lz - 0.01);
                    normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
                    colors.push(0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7);
                    uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                    indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    continue;
                }

                if (voxel === 73) { // Slab — half-height block (bottom half)
                    addBoxMesh(x, y, z, x, y, z, x + 1, y + 0.5, z + 1, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 74) { // Stairs — L-shape (bottom slab + top half)
                    // Bottom full slab
                    addBoxMesh(x, y, z, x, y, z, x + 1, y + 0.5, z + 1, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    // Top back half
                    addBoxMesh(x, y, z, x, y + 0.5, z + 0.5, x + 1, y + 1, z + 1, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 75) { // Sign — board + post
                    // Board (thin, centered, upper half)
                    addBoxMesh(x, y, z, x, y + 0.5, z + 7 / 16, x + 1, y + 1, z + 9 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    // Post (small stick below)
                    addBoxMesh(x, y, z, x + 7 / 16, y, z + 7 / 16, x + 9 / 16, y + 0.5, z + 9 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 76) { // Trapdoor — flat plane on bottom
                    addBoxMesh(x, y, z, x, y, z, x + 1, y + 3 / 16, z + 1, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 81) { // Trapdoor Open — flat against wall
                    addBoxMesh(x, y, z, x, y, z, x + 1, y + 1, z + 3 / 16, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 77) { // Bed — low raised platform
                    addBoxMesh(x, y, z, x, y, z, x + 1, y + 9 / 16, z + 1, voxel,
                        positions, normals, uvs, indices, colors,
                        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                // ===== Standard block face rendering =====
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
