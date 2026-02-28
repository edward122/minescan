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

    // Early exit: skip completely empty chunks
    if (chunkData) {
        let isEmpty = true;
        for (let i = 0, len = chunkData.length; i < len; i++) {
            if (chunkData[i] !== 0) { isEmpty = false; break; }
        }
        if (isEmpty) {
            const empty = new Float32Array(0);
            const emptyIdx = new Uint32Array(0);
            const emptyGeo = { positions: empty, normals: empty, uvs: empty, colors: empty, indices: emptyIdx };
            self.postMessage({ cellX, cellY, cellZ, opaque: emptyGeo, transparent: { ...emptyGeo } }, []);
            return;
        }
    }

    function emod(n, m) { return ((n % m) + m) % m; }

    function getVoxel(x, y, z) {
        const cx = Math.floor(x / chunkSize);
        const cy = Math.floor(y / chunkSize);
        const cz = Math.floor(z / chunkSize);
        let data;
        if (cx === cellX && cy === cellY && cz === cellZ) {
            data = chunkData;
        } else {
            data = neighborData[`${cx - cellX},${cy - cellY},${cz - cellZ}`];
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

    // Dual geometry buffers: opaque + transparent
    const op = { positions: [], normals: [], uvs: [], indices: [], colors: [] };
    const tr = { positions: [], normals: [], uvs: [], indices: [], colors: [] };

    const startX = cellX * chunkSize;
    const startY = cellY * chunkSize;
    const startZ = cellZ * chunkSize;

    // Precompute heightmap for fast cave darkness
    const skyLevel = 80;
    const heightMap = new Uint8Array(chunkSize * chunkSize);
    for (let hz = 0; hz < chunkSize; hz++) {
        for (let hx = 0; hx < chunkSize; hx++) {
            let topY = 0;
            for (let hy = chunkSize - 1; hy >= 0; hy--) {
                const vy = startY + hy;
                if (vy > skyLevel) continue;
                const idx = hy * chunkSliceSize + hz * chunkSize + hx;
                const v = chunkData ? chunkData[idx] : 0;
                if (v !== 0 && v !== 8) { topY = vy; break; }
            }
            heightMap[hz * chunkSize + hx] = topY;
        }
    }

    // Helper: pick the right buffer for a voxel type
    function getBuf(voxel) { return isTransparent(voxel) ? tr : op; }

    for (let y = 0; y < chunkSize; ++y) {
        const voxelY = startY + y;
        for (let z = 0; z < chunkSize; ++z) {
            const voxelZ = startZ + z;
            for (let x = 0; x < chunkSize; ++x) {
                const voxelX = startX + x;
                const voxel = getVoxel(voxelX, voxelY, voxelZ);
                if (!voxel) continue;

                const buf = getBuf(voxel);

                if (isCrossShape(voxel)) {
                    const [texU, texV] = getBlockTextureCoords(voxel, 0);
                    const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                    const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                    const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                    const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;
                    for (const face of crossFaces) {
                        const ndx = buf.positions.length / 3;
                        for (let i = 0; i < 4; i++) {
                            const c = face.corners[i];
                            buf.positions.push(c[0] + x, c[1] + y, c[2] + z);
                            buf.normals.push(face.normal[0], face.normal[1], face.normal[2]);
                            buf.colors.push(0.9, 0.9, 0.9);
                        }
                        buf.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                        buf.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                        buf.indices.push(ndx + 2, ndx + 1, ndx, ndx + 3, ndx + 1, ndx + 2);
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
                    for (let fi = 0; fi < 6; fi++) {
                        const { dir, corners } = torchFaces[fi];
                        const ndx = buf.positions.length / 3;
                        for (let i = 0; i < 4; i++) {
                            const { pos, uv } = corners[i];
                            buf.positions.push(pos[0], pos[1], pos[2]);
                            buf.normals.push(dir[0], dir[1], dir[2]);
                            buf.colors.push(1, 1, 1);
                            buf.uvs.push(uv[0] === 0 ? faceU0 : faceU1, uv[1] === 0 ? v0 : v1);
                        }
                        buf.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
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
                    let ndx = buf.positions.length / 3;
                    buf.positions.push(x, pY, z + 1, x + 1, pY, z + 1, x, pY, z, x + 1, pY, z);
                    buf.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
                    buf.colors.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
                    buf.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                    buf.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    ndx = buf.positions.length / 3;
                    buf.positions.push(x + 1, pY - 0.01, z + 1, x, pY - 0.01, z + 1, x + 1, pY - 0.01, z, x, pY - 0.01, z);
                    buf.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
                    buf.colors.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6);
                    buf.uvs.push(u1, v0, u0, v0, u1, v1, u0, v1);
                    buf.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    continue;
                }

                if (voxel === 55) { // Cactus
                    addBoxMesh(x, y, z, x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 1, z + 15 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }
                if (voxel === 54) { // Lantern
                    addBoxMesh(x, y, z, x + 4 / 16, y, z + 4 / 16, x + 12 / 16, y + 12 / 16, z + 12 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    addBoxMesh(x, y, z, x + 7 / 16, y + 12 / 16, z + 7 / 16, x + 9 / 16, y + 1, z + 9 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }

                if (voxel === 18 || voxel === 82) { // Chest
                    let cMinX = x + 1 / 16, cMaxX = x + 15 / 16, cMinZ = z + 1 / 16, cMaxZ = z + 15 / 16;
                    const nxp = getVoxel(x + 1, y, z), nxn = getVoxel(x - 1, y, z), nzp = getVoxel(x, y, z + 1), nzn = getVoxel(x, y, z - 1);
                    if (nxp === 18 || nxp === 82) cMaxX = x + 1;
                    if (nxn === 18 || nxn === 82) cMinX = x;
                    if (nzp === 18 || nzp === 82) cMaxZ = z + 1;
                    if (nzn === 18 || nzn === 82) cMinZ = z;
                    if (voxel === 18) {
                        _addChestPartMesh(x, y, z, cMinX, y, cMinZ, cMaxX, y + 10 / 16, cMaxZ, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, false);
                        _addChestPartMesh(x, y, z, cMinX, y + 10 / 16, cMinZ, cMaxX, y + 14 / 16, cMaxZ, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, true);
                    } else {
                        _addChestPartMesh(x, y, z, cMinX, y, cMinZ, cMaxX, y + 10 / 16, cMaxZ, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, false);
                        _addChestPartMesh(x, y, z, cMinX, y + 10 / 16, z + 11 / 16, cMaxX, y + 24 / 16, z + 15 / 16, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, true);
                    }
                    continue;
                }

                if (voxel === 70 || voxel === 78) { addBoxMesh(x, y, z, x, y, z, x + 3 / 16, y + 1, z + 1, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness); continue; }
                if (voxel === 79 || voxel === 80) { addBoxMesh(x, y, z, x, y, z, x + 1, y + 1, z + 3 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness); continue; }
                if (voxel === 71) {
                    addBoxMesh(x, y, z, x + 6 / 16, y, z + 6 / 16, x + 10 / 16, y + 1, z + 10 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    addBoxMesh(x, y, z, x, y + 12 / 16, z + 7 / 16, x + 1, y + 15 / 16, z + 9 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    addBoxMesh(x, y, z, x, y + 6 / 16, z + 7 / 16, x + 1, y + 9 / 16, z + 9 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }
                if (voxel === 72) { // Ladder
                    const [texU, texV] = getBlockTextureCoords(voxel, 0);
                    const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                    const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                    const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                    const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;
                    const lz = z + 1 / 16;
                    let ndx = buf.positions.length / 3;
                    buf.positions.push(x, y, lz, x + 1, y, lz, x, y + 1, lz, x + 1, y + 1, lz);
                    buf.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
                    buf.colors.push(0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9);
                    buf.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                    buf.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    ndx = buf.positions.length / 3;
                    buf.positions.push(x + 1, y, lz - 0.01, x, y, lz - 0.01, x + 1, y + 1, lz - 0.01, x, y + 1, lz - 0.01);
                    buf.normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
                    buf.colors.push(0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7);
                    buf.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
                    buf.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    continue;
                }
                if (voxel === 73) { addBoxMesh(x, y, z, x, y, z, x + 1, y + 0.5, z + 1, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness); continue; }
                if (voxel === 74) {
                    addBoxMesh(x, y, z, x, y, z, x + 1, y + 0.5, z + 1, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    addBoxMesh(x, y, z, x, y + 0.5, z + 0.5, x + 1, y + 1, z + 1, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }
                if (voxel === 75) {
                    addBoxMesh(x, y, z, x, y + 0.5, z + 7 / 16, x + 1, y + 1, z + 9 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    addBoxMesh(x, y, z, x + 7 / 16, y, z + 7 / 16, x + 9 / 16, y + 0.5, z + 9 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                    continue;
                }
                if (voxel === 76) { addBoxMesh(x, y, z, x, y, z, x + 1, y + 3 / 16, z + 1, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness); continue; }
                if (voxel === 81) { addBoxMesh(x, y, z, x, y, z, x + 1, y + 1, z + 3 / 16, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness); continue; }
                if (voxel === 77) { addBoxMesh(x, y, z, x, y, z, x + 1, y + 9 / 16, z + 1, voxel, buf.positions, buf.normals, buf.uvs, buf.indices, buf.colors, tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness); continue; }

                // ===== Standard block face rendering =====
                for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
                    const { dir, corners } = faces[faceIndex];
                    const neighbor = getVoxel(voxelX + dir[0], voxelY + dir[1], voxelZ + dir[2]);
                    const nTrans = isTransparent(neighbor);
                    const shouldRenderFace = nTrans && !(isTransparent(voxel) && voxel === neighbor);
                    if (shouldRenderFace) {
                        const ndx = buf.positions.length / 3;
                        const [texU, texV] = getBlockTextureCoords(voxel, faceIndex);
                        let isWaterTop = false;
                        if (voxel === 8 && faceIndex === 3) {
                            if (getVoxel(voxelX, voxelY + 1, voxelZ) !== 8) isWaterTop = true;
                        }
                        // Fast cave darkness using heightmap
                        let depthDim = 1.0;
                        if (voxelY < skyLevel) {
                            const colTopY = heightMap[z * chunkSize + x];
                            if (colTopY >= skyLevel || voxelY < colTopY - 3) {
                                depthDim = Math.max(0.25, 1.0 - (skyLevel - voxelY) * 0.015);
                            }
                        }
                        for (const { pos, uv } of corners) {
                            let py = pos[1] + y;
                            if (isWaterTop) py -= 0.15;
                            buf.positions.push(pos[0] + x, py, pos[2] + z);
                            buf.normals.push(dir[0], dir[1], dir[2]);
                            const brightness = faceBrightness[faceIndex] * depthDim;
                            buf.colors.push(brightness, brightness, brightness);
                            buf.uvs.push(
                                ((texU + uv[0]) * tileSize) / tileTextureWidth + (uv[0] === 0 ? halfPixel : -halfPixel),
                                1 - ((texV + 1 - uv[1]) * tileSize) / tileTextureHeight + (uv[1] === 0 ? halfPixel : -halfPixel)
                            );
                        }
                        buf.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
                    }
                }
            }
        }
    }

    // Convert to typed arrays and transfer
    function toTyped(b) {
        return {
            positions: new Float32Array(b.positions),
            normals: new Float32Array(b.normals),
            uvs: new Float32Array(b.uvs),
            colors: new Float32Array(b.colors),
            indices: new Uint32Array(b.indices)
        };
    }
    const opaqueData = toTyped(op);
    const transparentData = toTyped(tr);
    const transferList = [];
    for (const d of [opaqueData, transparentData]) {
        if (d.positions.length) transferList.push(d.positions.buffer);
        if (d.normals.length) transferList.push(d.normals.buffer);
        if (d.uvs.length) transferList.push(d.uvs.buffer);
        if (d.colors.length) transferList.push(d.colors.buffer);
        if (d.indices.length) transferList.push(d.indices.buffer);
    }
    self.postMessage({ cellX, cellY, cellZ, opaque: opaqueData, transparent: transparentData }, transferList);
};

