import * as THREE from 'three';
import { getBlockTextureCoords, isBlockTransparent, isBlockCustomMesh, BlockRegistry } from './BlockRegistry.js';

export class VoxelWorld {
    constructor(options = {}) {
        this.chunkSize = options.chunkSize || 32;
        this.chunkSliceSize = this.chunkSize * this.chunkSize;
        this.chunks = new Map();
        this.dirtyChunks = new Set();
        this.useGreedyMeshing = false; // Toggle: greedy needs RepeatWrapping on atlas to tile textures
    }

    computeVoxelOffset(x, y, z) {
        const { chunkSize, chunkSliceSize } = this;
        const voxelX = THREE.MathUtils.euclideanModulo(x, chunkSize) | 0;
        const voxelY = THREE.MathUtils.euclideanModulo(y, chunkSize) | 0;
        const voxelZ = THREE.MathUtils.euclideanModulo(z, chunkSize) | 0;
        return voxelY * chunkSliceSize + voxelZ * chunkSize + voxelX;
    }

    computeChunkCoordinates(x, y, z) {
        const { chunkSize } = this;
        const chunkX = Math.floor(x / chunkSize);
        const chunkY = Math.floor(y / chunkSize);
        const chunkZ = Math.floor(z / chunkSize);
        return { chunkX, chunkY, chunkZ };
    }

    computeChunkId(x, y, z) {
        const coords = this.computeChunkCoordinates(x, y, z);
        return `${coords.chunkX},${coords.chunkY},${coords.chunkZ}`;
    }

    addChunkForVoxel(x, y, z) {
        const chunkId = this.computeChunkId(x, y, z);
        let chunk = this.chunks.get(chunkId);
        if (!chunk) {
            const { chunkSize } = this;
            chunk = new Uint8Array(chunkSize * chunkSize * chunkSize);
            this.chunks.set(chunkId, chunk);
        }
        return chunk;
    }

    getChunkForVoxel(x, y, z) {
        return this.chunks.get(this.computeChunkId(x, y, z));
    }

    setVoxel(x, y, z, v, addChunk = true, markDirty = false) {
        let chunk = this.getChunkForVoxel(x, y, z);
        if (!chunk) {
            if (!addChunk) return;
            chunk = this.addChunkForVoxel(x, y, z);
        }
        const voxelOffset = this.computeVoxelOffset(x, y, z);
        chunk[voxelOffset] = v;
        if (markDirty) {
            const chunkId = this.computeChunkId(x, y, z);
            this.dirtyChunks.add(chunkId);
        }
    }

    getVoxel(x, y, z) {
        const chunk = this.getChunkForVoxel(x, y, z);
        if (!chunk) return 0;
        const voxelOffset = this.computeVoxelOffset(x, y, z);
        return chunk[voxelOffset];
    }

    generateGeometryDataForCell(cellX, cellY, cellZ) {
        if (this.useGreedyMeshing) {
            return this._generateGreedy(cellX, cellY, cellZ);
        }
        return this._generateNaive(cellX, cellY, cellZ);
    }

    // ---- Greedy Meshing ----
    _generateGreedy(cellX, cellY, cellZ) {
        const { chunkSize } = this;
        const tileSize = 16;
        const tileTextureWidth = 256;
        const tileTextureHeight = 256;
        const halfPixel = 0.5 / tileTextureWidth;

        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        const colors = [];

        const faceBrightness = [0.8, 0.8, 0.6, 1.0, 0.7, 0.9];

        const startX = cellX * chunkSize;
        const startY = cellY * chunkSize;
        const startZ = cellZ * chunkSize;

        // First pass: cross-shaped blocks (can't be greedy-merged)
        for (let y = 0; y < chunkSize; ++y) {
            for (let z = 0; z < chunkSize; ++z) {
                for (let x = 0; x < chunkSize; ++x) {
                    const voxel = this.getVoxel(startX + x, startY + y, startZ + z);
                    if (!voxel) continue;
                    const blockDef = BlockRegistry[voxel];
                    if (blockDef && blockDef.crossShape) {
                        this._addCrossShape(voxel, x, y, z, positions, normals, uvs, indices, colors,
                            tileSize, tileTextureWidth, tileTextureHeight, halfPixel);
                    }
                }
            }
        }

        // Second pass: greedy meshing for each of the 6 face directions
        // We iterate per face. For each face we sweep along the face normal axis (d),
        // and for each slice we build a 2D mask on the (u, v) plane, then merge rectangles.
        //
        // Face definitions map to axes:
        //   face 0 (left,  -X): d=X, u=Z, v=Y, face at x=voxelX   (normal [-1,0,0])
        //   face 1 (right, +X): d=X, u=Z, v=Y, face at x=voxelX+1 (normal [+1,0,0])
        //   face 2 (bottom,-Y): d=Y, u=X, v=Z, face at y=voxelY   (normal [0,-1,0])
        //   face 3 (top,   +Y): d=Y, u=X, v=Z, face at y=voxelY+1 (normal [0,+1,0])
        //   face 4 (back,  -Z): d=Z, u=X, v=Y, face at z=voxelZ   (normal [0,0,-1])
        //   face 5 (front, +Z): d=Z, u=X, v=Y, face at z=voxelZ+1 (normal [0,0,+1])

        for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
            const { dir } = VoxelWorld.faces[faceIndex];
            const brightness = faceBrightness[faceIndex];

            // Map face to axes
            let dAxis, uAxis, vAxis;
            if (faceIndex <= 1) { dAxis = 0; uAxis = 2; vAxis = 1; } // X faces: sweep Z, Y
            else if (faceIndex <= 3) { dAxis = 1; uAxis = 0; vAxis = 2; } // Y faces: sweep X, Z
            else { dAxis = 2; uAxis = 0; vAxis = 1; } // Z faces: sweep X, Y

            const isPositive = (faceIndex % 2 === 1); // right, top, front

            const mask = new Int32Array(chunkSize * chunkSize);

            for (let dPos = 0; dPos < chunkSize; dPos++) {
                // Build the mask
                let maskI = 0;
                for (let vPos = 0; vPos < chunkSize; vPos++) {
                    for (let uPos = 0; uPos < chunkSize; uPos++) {
                        const xyz = [0, 0, 0];
                        xyz[dAxis] = dPos;
                        xyz[uAxis] = uPos;
                        xyz[vAxis] = vPos;

                        const vx = startX + xyz[0];
                        const vy = startY + xyz[1];
                        const vz = startZ + xyz[2];
                        const voxel = this.getVoxel(vx, vy, vz);

                        if (voxel) {
                            const blockDef = BlockRegistry[voxel];
                            if (blockDef && blockDef.crossShape) {
                                mask[maskI] = 0;
                            } else if (isBlockCustomMesh(voxel)) {
                                mask[maskI] = 0;
                            } else {
                                const neighbor = this.getVoxel(
                                    vx + dir[0], vy + dir[1], vz + dir[2]);
                                const nTrans = isBlockTransparent(neighbor);
                                const shouldRender = nTrans &&
                                    !(isBlockTransparent(voxel) && voxel === neighbor);
                                mask[maskI] = shouldRender ? voxel : 0;
                            }
                        } else {
                            mask[maskI] = 0;
                        }
                        maskI++;
                    }
                }

                // Greedy step: merge mask into rectangles
                for (let vPos = 0; vPos < chunkSize; vPos++) {
                    for (let uPos = 0; uPos < chunkSize;) {
                        const mi = vPos * chunkSize + uPos;
                        const blockId = mask[mi];
                        if (blockId === 0) { uPos++; continue; }

                        // Extend width along u
                        let w = 1;
                        while (uPos + w < chunkSize &&
                            mask[vPos * chunkSize + uPos + w] === blockId) w++;

                        // Extend height along v
                        let h = 1;
                        let done = false;
                        while (vPos + h < chunkSize && !done) {
                            for (let k = 0; k < w; k++) {
                                if (mask[(vPos + h) * chunkSize + uPos + k] !== blockId) {
                                    done = true; break;
                                }
                            }
                            if (!done) h++;
                        }

                        // Clear mask
                        for (let dv = 0; dv < h; dv++)
                            for (let du = 0; du < w; du++)
                                mask[(vPos + dv) * chunkSize + uPos + du] = 0;

                        // Emit the quad. Build 4 corners in local chunk space.
                        // The face sits at dPos (for negative faces) or dPos+1 (for positive faces).
                        const dOff = isPositive ? dPos + 1 : dPos;

                        // The quad spans [uPos, uPos+w] x [vPos, vPos+h] on the u/v plane
                        // 4 corners: (u0,v0), (u1,v0), (u0,v1), (u1,v1)
                        // We need to order them to match the winding of the original face corners.

                        const u0 = uPos, u1 = uPos + w;
                        const v0 = vPos, v1 = vPos + h;

                        // Build the 4 corner positions in local (x,y,z) space
                        // The order must produce correct winding for the face normal.
                        // For the original faces, the corners are ordered so that the
                        // first triangle (0,1,2) and second (2,1,3) face outward.
                        const corners = [];

                        // We define corners based on the face direction to get correct winding
                        if (faceIndex === 0) { // left (-X): normal facing -X
                            corners.push(
                                [dOff, v1, u0], // top-left
                                [dOff, v0, u0], // bottom-left
                                [dOff, v1, u1], // top-right
                                [dOff, v0, u1], // bottom-right
                            );
                        } else if (faceIndex === 1) { // right (+X): normal facing +X
                            corners.push(
                                [dOff, v1, u1], // top-right
                                [dOff, v0, u1], // bottom-right
                                [dOff, v1, u0], // top-left
                                [dOff, v0, u0], // bottom-left
                            );
                        } else if (faceIndex === 2) { // bottom (-Y): normal facing -Y
                            corners.push(
                                [u1, dOff, v1], // (maxX, y, maxZ)
                                [u0, dOff, v1], // (minX, y, maxZ)
                                [u1, dOff, v0], // (maxX, y, minZ)
                                [u0, dOff, v0], // (minX, y, minZ)
                            );
                        } else if (faceIndex === 3) { // top (+Y): normal facing +Y
                            corners.push(
                                [u0, dOff, v1], // (minX, y, maxZ)
                                [u1, dOff, v1], // (maxX, y, maxZ)
                                [u0, dOff, v0], // (minX, y, minZ)
                                [u1, dOff, v0], // (maxX, y, minZ)
                            );
                        } else if (faceIndex === 4) { // back (-Z): normal facing -Z
                            corners.push(
                                [u1, v0, dOff], // (maxX, minY, z)
                                [u0, v0, dOff], // (minX, minY, z)
                                [u1, v1, dOff], // (maxX, maxY, z)
                                [u0, v1, dOff], // (minX, maxY, z)
                            );
                        } else { // front (+Z): normal facing +Z
                            corners.push(
                                [u0, v0, dOff], // (minX, minY, z)
                                [u1, v0, dOff], // (maxX, minY, z)
                                [u0, v1, dOff], // (minX, maxY, z)
                                [u1, v1, dOff], // (maxX, maxY, z)
                            );
                        }

                        const ndx = positions.length / 3;
                        const [texU, texV] = getBlockTextureCoords(blockId, faceIndex);

                        // UV coordinates for a single tile (no repeat wrapping needed)
                        const tU0 = (texU * tileSize) / tileTextureWidth + halfPixel;
                        const tU1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
                        const tV0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
                        const tV1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

                        // Match UV corners to the original face corner UV order
                        const faceCorners = VoxelWorld.faces[faceIndex].corners;
                        for (let ci = 0; ci < 4; ci++) {
                            positions.push(corners[ci][0], corners[ci][1], corners[ci][2]);
                            normals.push(dir[0], dir[1], dir[2]);
                            colors.push(brightness, brightness, brightness);

                            const fuv = faceCorners[ci].uv;
                            uvs.push(
                                fuv[0] === 0 ? tU0 : tU1,
                                fuv[1] === 0 ? tV0 : tV1
                            );
                        }

                        indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);

                        uPos += w;
                    }
                }
            }
        }

        return { positions, normals, uvs, indices, colors };
    }

    _addCrossShape(voxel, x, y, z, positions, normals, uvs, indices, colors,
        tileSize, tileTextureWidth, tileTextureHeight, halfPixel) {
        const [texU, texV] = getBlockTextureCoords(voxel, 0);
        const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
        const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
        const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
        const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

        const crossFaces = [
            {
                corners: [[0, 0, 0], [1, 0, 1], [0, 1, 0], [1, 1, 1]],
                normal: [-0.707, 0, 0.707]
            },
            {
                corners: [[1, 0, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]],
                normal: [0.707, 0, 0.707]
            },
        ];

        for (const face of crossFaces) {
            const ndx = positions.length / 3;
            for (let i = 0; i < 4; i++) {
                const c = face.corners[i];
                positions.push(c[0] + x, c[1] + y, c[2] + z);
                normals.push(face.normal[0], face.normal[1], face.normal[2]);
                colors.push(0.9, 0.9, 0.9);
            }
            uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
            // Front face
            indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
            // Back face (reversed winding for double-sided)
            indices.push(ndx + 2, ndx + 1, ndx, ndx + 3, ndx + 1, ndx + 2);
        }
    }

    // ---- Naive Meshing (original) ----
    _generateNaive(cellX, cellY, cellZ) {
        const { chunkSize } = this;
        const tileSize = 16;
        const tileTextureWidth = 256;
        const tileTextureHeight = 256;
        const halfPixel = 0.5 / tileTextureWidth;

        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        const colors = [];

        const faceBrightness = [0.8, 0.8, 0.6, 1.0, 0.7, 0.9];

        const startX = cellX * chunkSize;
        const startY = cellY * chunkSize;
        const startZ = cellZ * chunkSize;

        // Precompute heightmap for fast cave darkness
        const skyLevel = 80;
        const chunkId = `${cellX},${cellY},${cellZ}`;
        const chunkData = this.chunks.get(chunkId);
        const heightMap = new Uint8Array(chunkSize * chunkSize);
        for (let z = 0; z < chunkSize; z++) {
            for (let x = 0; x < chunkSize; x++) {
                let topY = 0;
                for (let y = chunkSize - 1; y >= 0; y--) {
                    const voxelY = startY + y;
                    if (voxelY > skyLevel) continue;
                    if (chunkData) {
                        const idx = y * this.chunkSliceSize + z * chunkSize + x;
                        const v = chunkData[idx];
                        if (v !== 0 && v !== 8) { topY = voxelY; break; }
                    }
                }
                heightMap[z * chunkSize + x] = topY;
            }
        }

        for (let y = 0; y < chunkSize; ++y) {
            const voxelY = startY + y;
            for (let z = 0; z < chunkSize; ++z) {
                const voxelZ = startZ + z;
                for (let x = 0; x < chunkSize; ++x) {
                    const voxelX = startX + x;
                    const voxel = this.getVoxel(voxelX, voxelY, voxelZ);

                    if (voxel) {
                        const blockDef = BlockRegistry[voxel];

                        if (blockDef && blockDef.crossShape) {
                            this._addCrossShape(voxel, x, y, z, positions, normals, uvs, indices, colors,
                                tileSize, tileTextureWidth, tileTextureHeight, halfPixel);
                            continue;
                        }

                        if (isBlockCustomMesh(voxel)) {
                            this._addCustomMesh(voxel, x, y, z, voxelX, voxelY, voxelZ, positions, normals, uvs, indices, colors,
                                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                            continue;
                        }

                        for (let faceIndex = 0; faceIndex < VoxelWorld.faces.length; faceIndex++) {
                            const { dir, corners } = VoxelWorld.faces[faceIndex];
                            const neighbor = this.getVoxel(
                                voxelX + dir[0], voxelY + dir[1], voxelZ + dir[2]
                            );
                            const isTransp = isBlockTransparent(neighbor);
                            const shouldRenderFace = isTransp && !(isBlockTransparent(voxel) && voxel === neighbor);

                            if (shouldRenderFace) {
                                const ndx = positions.length / 3;
                                const [texU, texV] = getBlockTextureCoords(voxel, faceIndex);

                                // Fast cave darkness using heightmap
                                let depthDim = 1.0;
                                if (voxelY < skyLevel) {
                                    const colTopY = heightMap[z * chunkSize + x];
                                    if (colTopY >= skyLevel || voxelY < colTopY - 3) {
                                        const depth = skyLevel - voxelY;
                                        depthDim = Math.max(0.25, 1.0 - depth * 0.015);
                                    }
                                }

                                for (const { pos, uv } of corners) {
                                    positions.push(pos[0] + x, pos[1] + y, pos[2] + z);
                                    normals.push(...dir);
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
        }

        return { positions, normals, uvs, indices, colors };
    }

    _addBoxMesh(x, y, z, minX, minY, minZ, maxX, maxY, maxZ, voxel,
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
            // Note: v0 is the top visual edge of the texture (meaning v=1), v1 is the bottom (v=0).
            const vMined0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel; // Top
            const vMined1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel; // Bottom
            const _v0 = vMined0;
            const _v1 = vMined1;

            const ndx = positions.length / 3;
            const brightness = faceBrightness[face.fi];
            for (const { pos, uv } of face.corners) {
                positions.push(pos[0], pos[1], pos[2]);
                normals.push(face.dir[0], face.dir[1], face.dir[2]);
                colors.push(brightness, brightness, brightness);
                uvs.push(uv[0] === 0 ? u0 : u1, uv[1] === 0 ? _v0 : _v1);
            }
            indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
        }
    }

    _addChestPartMesh(x, y, z, minX, minY, minZ, maxX, maxY, maxZ,
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
            // Native texture mapping: vMined0 is the BOTTOM coordinate (e.g. 0.25), vMined1 is the TOP coordinate (e.g. 0.3125)
            // But wait, texV*tileSize represents top. So 1 - (texV*tileSize)/... is LARGER than 1 - ((texV+1)*...
            // Let's call them vBottom and vTop to be clear.
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

    _addCustomMesh(voxel, x, y, z, voxelX, voxelY, voxelZ, positions, normals, uvs, indices, colors,
        tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness) {

        if (voxel === 18 || voxel === 82) { // Chest or Chest Open
            let minX = x + 1 / 16, maxX = x + 15 / 16;
            let minZ = z + 1 / 16, maxZ = z + 15 / 16;

            const nxp = this.getVoxel(voxelX + 1, voxelY, voxelZ);
            const nxn = this.getVoxel(voxelX - 1, voxelY, voxelZ);
            const nzp = this.getVoxel(voxelX, voxelY, voxelZ + 1);
            const nzn = this.getVoxel(voxelX, voxelY, voxelZ - 1);

            if (nxp === 18 || nxp === 82) maxX = x + 1;
            if (nxn === 18 || nxn === 82) minX = x;
            if (nzp === 18 || nzp === 82) maxZ = z + 1;
            // Texture mapping coordinates for Chest
            // Normal blocks pass block ID to _addBoxMesh. For custom geometries, mapping might be off.
            // Let's ensure _addBoxMesh properly resolves textures for chest faces.

            if (voxel === 18) { // Closed
                this._addChestPartMesh(x, y, z, minX, y, minZ, maxX, y + 10 / 16, maxZ,
                    positions, normals, uvs, indices, colors,
                    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, false);
                this._addChestPartMesh(x, y, z, minX, y + 10 / 16, minZ, maxX, y + 14 / 16, maxZ,
                    positions, normals, uvs, indices, colors,
                    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, true);
            } else { // Open
                this._addChestPartMesh(x, y, z, minX, y, minZ, maxX, y + 10 / 16, maxZ,
                    positions, normals, uvs, indices, colors,
                    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, false);
                this._addChestPartMesh(x, y, z, minX, y + 10 / 16, z + 11 / 16, maxX, y + 24 / 16, z + 15 / 16,
                    positions, normals, uvs, indices, colors,
                    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness, true);
            }
            return;
        }

        if (voxel === 19) { // Torch
            const [texU, texV] = getBlockTextureCoords(voxel, 0);
            const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
            const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
            const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
            const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

            const faceU0 = u0 + (u1 - u0) * (6 / 16);
            const faceU1 = u0 + (u1 - u0) * (10 / 16);
            const faceV0 = v0 + (v1 - v0) * (6 / 16);
            const faceV1 = v0 + (v1 - v0) * (10 / 16);

            const dx = 7 / 16, dy = 0, dz = 7 / 16;
            const w = 2 / 16, h = 10 / 16;

            const boxFaces = [
                { dir: [-1, 0, 0], fi: 0, corners: [{ pos: [x + dx, y + dy + h, z + dz], uv: [faceU0, v1] }, { pos: [x + dx, y + dy, z + dz], uv: [faceU0, v0] }, { pos: [x + dx, y + dy + h, z + dz + w], uv: [faceU1, v1] }, { pos: [x + dx, y + dy, z + dz + w], uv: [faceU1, v0] }] },
                { dir: [1, 0, 0], fi: 1, corners: [{ pos: [x + dx + w, y + dy + h, z + dz + w], uv: [faceU0, v1] }, { pos: [x + dx + w, y + dy, z + dz + w], uv: [faceU0, v0] }, { pos: [x + dx + w, y + dy + h, z + dz], uv: [faceU1, v1] }, { pos: [x + dx + w, y + dy, z + dz], uv: [faceU1, v0] }] },
                { dir: [0, -1, 0], fi: 2, corners: [{ pos: [x + dx + w, y + dy, z + dz + w], uv: [faceU0, faceV0] }, { pos: [x + dx, y + dy, z + dz + w], uv: [faceU0, faceV1] }, { pos: [x + dx + w, y + dy, z + dz], uv: [faceU1, faceV0] }, { pos: [x + dx, y + dy, z + dz], uv: [faceU1, faceV1] }] },
                { dir: [0, 1, 0], fi: 3, corners: [{ pos: [x + dx, y + dy + h, z + dz + w], uv: [faceU0, faceV0] }, { pos: [x + dx + w, y + dy + h, z + dz + w], uv: [faceU0, faceV1] }, { pos: [x + dx, y + dy + h, z + dz], uv: [faceU1, faceV0] }, { pos: [x + dx + w, y + dy + h, z + dz], uv: [faceU1, faceV1] }] },
                { dir: [0, 0, -1], fi: 4, corners: [{ pos: [x + dx + w, y + dy, z + dz], uv: [faceU0, v0] }, { pos: [x + dx, y + dy, z + dz], uv: [faceU1, v0] }, { pos: [x + dx + w, y + dy + h, z + dz], uv: [faceU0, v1] }, { pos: [x + dx, y + dy + h, z + dz], uv: [faceU1, v1] }] },
                { dir: [0, 0, 1], fi: 5, corners: [{ pos: [x + dx, y + dy, z + dz + w], uv: [faceU0, v0] }, { pos: [x + dx + w, y + dy, z + dz + w], uv: [faceU1, v0] }, { pos: [x + dx, y + dy + h, z + dz + w], uv: [faceU0, v1] }, { pos: [x + dx + w, y + dy + h, z + dz + w], uv: [faceU1, v1] }] },
            ];

            for (const face of boxFaces) {
                const ndx = positions.length / 3;
                const brightness = faceBrightness[face.fi];
                for (const { pos, uv } of face.corners) {
                    positions.push(pos[0], pos[1], pos[2]);
                    normals.push(face.dir[0], face.dir[1], face.dir[2]);
                    colors.push(brightness, brightness, brightness);
                    uvs.push(uv[0], uv[1]);
                }
                indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
            }
            return;
        }

        if (voxel === 52) { // Lily Pad
            this._addBoxMesh(x, y, z, x, y + 14 / 16, z, x + 1, y + 15 / 16, z + 1, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 54 || voxel === 55) { // Lantern / Cactus
            let w = (voxel === 54) ? 6 : 14;
            let offset = (16 - w) / 2 / 16;
            this._addBoxMesh(x, y, z, x + offset, y, z + offset, x + 1 - offset, y + 1, z + 1 - offset, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            if (voxel === 54) {
                this._addBoxMesh(x, y, z, x + 7 / 16, y + 1, z + 7 / 16, x + 9 / 16, y + 18 / 16, z + 9 / 16, voxel,
                    positions, normals, uvs, indices, colors,
                    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                this._addBoxMesh(x, y, z, x + 5 / 16, y + 18 / 16, z + 5 / 16, x + 11 / 16, y + 19 / 16, z + 11 / 16, voxel,
                    positions, normals, uvs, indices, colors,
                    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
                this._addBoxMesh(x, y, z, x + 7 / 16, y + 12 / 16, z + 7 / 16, x + 9 / 16, y + 1, z + 9 / 16, voxel,
                    positions, normals, uvs, indices, colors,
                    tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            }
            return;
        }

        if (voxel === 70 || voxel === 78) { // Door closed (bottom or top)
            this._addBoxMesh(x, y, z, x, y, z, x + 3 / 16, y + 1, z + 1, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 79 || voxel === 80) { // Door open (bottom or top)
            this._addBoxMesh(x, y, z, x, y, z, x + 1, y + 1, z + 3 / 16, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 71) { // Fence
            this._addBoxMesh(x, y, z, x + 6 / 16, y, z + 6 / 16, x + 10 / 16, y + 1, z + 10 / 16, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            this._addBoxMesh(x, y, z, x, y + 12 / 16, z + 7 / 16, x + 1, y + 15 / 16, z + 9 / 16, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            this._addBoxMesh(x, y, z, x, y + 6 / 16, z + 7 / 16, x + 1, y + 9 / 16, z + 9 / 16, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 72) { // Ladder
            const [texU, texV] = getBlockTextureCoords(voxel, 0);
            const u0 = (texU * tileSize) / tileTextureWidth + halfPixel;
            const u1 = ((texU + 1) * tileSize) / tileTextureWidth - halfPixel;
            const v0 = 1 - ((texV + 1) * tileSize) / tileTextureHeight + halfPixel;
            const v1 = 1 - (texV * tileSize) / tileTextureHeight - halfPixel;

            const lz = z + 1 / 16;
            let ndx = positions.length / 3;
            positions.push(x, y, lz, x + 1, y, lz, x, y + 1, lz, x + 1, y + 1, lz);
            normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
            colors.push(0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9);
            uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
            indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);

            ndx = positions.length / 3;
            positions.push(x + 1, y, lz - 0.01, x, y, lz - 0.01, x + 1, y + 1, lz - 0.01, x, y + 1, lz - 0.01);
            normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
            colors.push(0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7);
            uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
            indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
            return;
        }

        if (voxel === 73) { // Slab
            this._addBoxMesh(x, y, z, x, y, z, x + 1, y + 0.5, z + 1, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 74) { // Stairs
            this._addBoxMesh(x, y, z, x, y, z, x + 1, y + 0.5, z + 1, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            this._addBoxMesh(x, y, z, x, y + 0.5, z + 0.5, x + 1, y + 1, z + 1, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 75) { // Sign
            this._addBoxMesh(x, y, z, x, y + 0.5, z + 7 / 16, x + 1, y + 1, z + 9 / 16, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            this._addBoxMesh(x, y, z, x + 7 / 16, y, z + 7 / 16, x + 9 / 16, y + 0.5, z + 9 / 16, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 76) { // Trapdoor
            this._addBoxMesh(x, y, z, x, y, z, x + 1, y + 3 / 16, z + 1, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 81) { // Trapdoor Open
            this._addBoxMesh(x, y, z, x, y, z, x + 1, y + 1, z + 3 / 16, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }

        if (voxel === 77) { // Bed
            this._addBoxMesh(x, y, z, x, y, z, x + 1, y + 9 / 16, z + 1, voxel,
                positions, normals, uvs, indices, colors,
                tileSize, tileTextureWidth, tileTextureHeight, halfPixel, faceBrightness);
            return;
        }
    }
}


VoxelWorld.faces = [
    { // left
        uvRow: 0,
        dir: [-1, 0, 0],
        corners: [
            { pos: [0, 1, 0], uv: [0, 1] },
            { pos: [0, 0, 0], uv: [0, 0] },
            { pos: [0, 1, 1], uv: [1, 1] },
            { pos: [0, 0, 1], uv: [1, 0] },
        ],
    },
    { // right
        uvRow: 0,
        dir: [1, 0, 0],
        corners: [
            { pos: [1, 1, 1], uv: [0, 1] },
            { pos: [1, 0, 1], uv: [0, 0] },
            { pos: [1, 1, 0], uv: [1, 1] },
            { pos: [1, 0, 0], uv: [1, 0] },
        ],
    },
    { // bottom
        uvRow: 1,
        dir: [0, -1, 0],
        corners: [
            { pos: [1, 0, 1], uv: [1, 0] },
            { pos: [0, 0, 1], uv: [0, 0] },
            { pos: [1, 0, 0], uv: [1, 1] },
            { pos: [0, 0, 0], uv: [0, 1] },
        ],
    },
    { // top
        uvRow: 2,
        dir: [0, 1, 0],
        corners: [
            { pos: [0, 1, 1], uv: [1, 1] },
            { pos: [1, 1, 1], uv: [0, 1] },
            { pos: [0, 1, 0], uv: [1, 0] },
            { pos: [1, 1, 0], uv: [0, 0] },
        ],
    },
    { // back
        uvRow: 0,
        dir: [0, 0, -1],
        corners: [
            { pos: [1, 0, 0], uv: [0, 0] },
            { pos: [0, 0, 0], uv: [1, 0] },
            { pos: [1, 1, 0], uv: [0, 1] },
            { pos: [0, 1, 0], uv: [1, 1] },
        ],
    },
    { // front
        uvRow: 0,
        dir: [0, 0, 1],
        corners: [
            { pos: [0, 0, 1], uv: [0, 0] },
            { pos: [1, 0, 1], uv: [1, 0] },
            { pos: [0, 1, 1], uv: [0, 1] },
            { pos: [1, 1, 1], uv: [1, 1] },
        ],
    },
];
