import * as THREE from 'three';
import MeshWorker from '../workers/meshWorker.js?worker';

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _cullSphere = new THREE.Sphere();
const _cullCenter = new THREE.Vector3();

const WORKER_POOL_SIZE = 4;

export class ChunkManager {
    constructor(world, scene, opaqueMaterial, transparentMaterial) {
        this.world = world;
        this.scene = scene;
        this.opaqueMaterial = opaqueMaterial;
        this.transparentMaterial = transparentMaterial;
        this.meshes = new Map(); // chunkId -> { opaque: THREE.Mesh|null, transparent: THREE.Mesh|null }
        this.pendingWorker = new Set(); // cellIds currently being meshed

        // Worker pool
        this.workers = [];
        this.workerBusy = [];
        for (let i = 0; i < WORKER_POOL_SIZE; i++) {
            const w = new MeshWorker();
            w.onmessage = (e) => this._onWorkerResult(e.data, i);
            this.workers.push(w);
            this.workerBusy.push(false);
        }
    }

    // Get a free worker index, or -1 if all busy
    _getFreeWorker() {
        for (let i = 0; i < this.workerBusy.length; i++) {
            if (!this.workerBusy[i]) return i;
        }
        return -1;
    }

    // Synchronous fallback — used when workers are busy or for immediate block edits
    updateCellGeometry(x, y, z) {
        const coords = this.world.computeChunkCoordinates(x, y, z);
        const cellId = this.world.computeChunkId(x, y, z);

        const { positions, normals, uvs, indices, colors } = this.world.generateGeometryDataForCell(
            coords.chunkX, coords.chunkY, coords.chunkZ
        );

        // Sync path doesn't have hasTransparency — use transparent material to be safe
        this._applyGeometry(cellId, coords, positions, normals, uvs, indices, colors, true);
    }

    // Queue a chunk for off-thread meshing
    updateCellGeometryAsync(x, y, z) {
        const coords = this.world.computeChunkCoordinates(x, y, z);
        const cellId = `${coords.chunkX},${coords.chunkY},${coords.chunkZ}`;

        if (this.pendingWorker.has(cellId)) return false; // Already in flight

        const workerIdx = this._getFreeWorker();
        if (workerIdx === -1) {
            // All workers busy — fall back to sync
            this.updateCellGeometry(x, y, z);
            return true;
        }

        // Gather chunk data + neighbor data
        const { chunkSize } = this.world;
        const chunkData = this.world.chunks.get(cellId);
        if (!chunkData) {
            // No data yet — do sync (will generate empty mesh)
            this.updateCellGeometry(x, y, z);
            return true;
        }

        const neighborData = {};
        const dirs = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1]
        ];
        for (const [dx, dy, dz] of dirs) {
            const nId = `${coords.chunkX + dx},${coords.chunkY + dy},${coords.chunkZ + dz}`;
            const nData = this.world.chunks.get(nId);
            if (nData) {
                neighborData[`${dx},${dy},${dz}`] = nData;
            }
        }

        this.pendingWorker.add(cellId);
        this.workerBusy[workerIdx] = true;

        this.workers[workerIdx].postMessage({
            cellX: coords.chunkX,
            cellY: coords.chunkY,
            cellZ: coords.chunkZ,
            chunkSize,
            chunkData,
            neighborData
        });

        return true;
    }

    _onWorkerResult(data, workerIdx) {
        this.workerBusy[workerIdx] = false;

        const { cellX, cellY, cellZ, positions, normals, uvs, colors, indices, hasTransparency } = data;
        const cellId = `${cellX},${cellY},${cellZ}`;
        this.pendingWorker.delete(cellId);

        const coords = { chunkX: cellX, chunkY: cellY, chunkZ: cellZ };
        this._applyGeometry(cellId, coords, positions, normals, uvs, indices, colors, hasTransparency);
    }

    _applyGeometry(cellId, coords, positions, normals, uvs, indices, colors, hasTransparency) {
        let entry = this.meshes.get(cellId);

        if (positions.length === 0) {
            // Empty chunk — remove any existing meshes
            if (entry) {
                if (entry.opaque) { this.scene.remove(entry.opaque); entry.opaque.geometry.dispose(); }
                if (entry.transparent) { this.scene.remove(entry.transparent); entry.transparent.geometry.dispose(); }
                this.meshes.delete(cellId);
            }
            return;
        }

        // Pick material based on whether chunk has transparency
        const material = hasTransparency ? this.transparentMaterial : this.opaqueMaterial;
        const meshKey = hasTransparency ? 'transparent' : 'opaque';
        const otherKey = hasTransparency ? 'opaque' : 'transparent';

        if (!entry) {
            entry = { opaque: null, transparent: null };
            this.meshes.set(cellId, entry);
        }

        // Remove the other mesh type if it exists (chunk changed from opaque to transparent or vice versa)
        if (entry[otherKey]) {
            this.scene.remove(entry[otherKey]);
            entry[otherKey].geometry.dispose();
            entry[otherKey] = null;
        }

        let mesh = entry[meshKey];

        if (mesh) {
            // Re-use existing geometry — update buffer attributes in place
            const geo = mesh.geometry;
            const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions);
            const normArr = normals instanceof Float32Array ? normals : new Float32Array(normals);
            const uvArr = uvs instanceof Float32Array ? uvs : new Float32Array(uvs);
            const idxArr = indices instanceof Uint32Array ? indices : new Uint32Array(indices);

            // Check if we can re-use existing buffers (same size or smaller)
            const posAttr = geo.getAttribute('position');
            if (posAttr && posAttr.array.length >= posArr.length) {
                posAttr.array.set(posArr);
                posAttr.count = posArr.length / 3;
                posAttr.needsUpdate = true;
            } else {
                geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
            }

            const normAttr = geo.getAttribute('normal');
            if (normAttr && normAttr.array.length >= normArr.length) {
                normAttr.array.set(normArr);
                normAttr.count = normArr.length / 3;
                normAttr.needsUpdate = true;
            } else {
                geo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
            }

            const uvAttr = geo.getAttribute('uv');
            if (uvAttr && uvAttr.array.length >= uvArr.length) {
                uvAttr.array.set(uvArr);
                uvAttr.count = uvArr.length / 2;
                uvAttr.needsUpdate = true;
            } else {
                geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
            }

            if (colors && colors.length > 0) {
                const colorArr = colors instanceof Float32Array ? colors : new Float32Array(colors);
                const colAttr = geo.getAttribute('color');
                if (colAttr && colAttr.array.length >= colorArr.length) {
                    colAttr.array.set(colorArr);
                    colAttr.count = colorArr.length / 3;
                    colAttr.needsUpdate = true;
                } else {
                    geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
                }
            }

            geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
            // Update draw range to match actual vertex count
            geo.setDrawRange(0, idxArr.length);
            geo.computeBoundingSphere();
        } else {
            // Create new mesh
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(
                positions instanceof Float32Array ? positions : new Float32Array(positions), 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(
                normals instanceof Float32Array ? normals : new Float32Array(normals), 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(
                uvs instanceof Float32Array ? uvs : new Float32Array(uvs), 2));

            if (colors && colors.length > 0) {
                geometry.setAttribute('color', new THREE.BufferAttribute(
                    colors instanceof Float32Array ? colors : new Float32Array(colors), 3));
            }

            geometry.setIndex(new THREE.BufferAttribute(
                indices instanceof Uint32Array ? indices : new Uint32Array(indices), 1));
            geometry.computeBoundingSphere();

            mesh = new THREE.Mesh(geometry, material);
            mesh.name = cellId;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = true;

            const { chunkSize } = this.world;
            mesh.position.set(
                coords.chunkX * chunkSize,
                coords.chunkY * chunkSize,
                coords.chunkZ * chunkSize
            );

            entry[meshKey] = mesh;
            this.scene.add(mesh);
        }
    }

    /**
     * Perform explicit frustum culling and distance-based LOD.
     * Distant chunks have shadows disabled to reduce shadow map cost.
     */
    cullChunks(camera, playerPos) {
        _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        _frustum.setFromProjectionMatrix(_projScreenMatrix);

        const shadowDistSq = (this.world.chunkSize * 3) ** 2; // Only shadow nearby chunks

        for (const [, entry] of this.meshes) {
            // Cull both opaque and transparent meshes for this chunk
            const meshes = [];
            if (entry.opaque) meshes.push(entry.opaque);
            if (entry.transparent) meshes.push(entry.transparent);

            for (const mesh of meshes) {
                if (!mesh.geometry.boundingSphere) {
                    mesh.visible = true;
                    continue;
                }
                _cullCenter.copy(mesh.geometry.boundingSphere.center).add(mesh.position);
                const radius = mesh.geometry.boundingSphere.radius;
                _cullSphere.set(_cullCenter, radius);
                mesh.visible = _frustum.intersectsSphere(_cullSphere);

                // LOD: disable shadows on distant chunks
                if (mesh.visible && playerPos) {
                    const dx = _cullCenter.x - playerPos.x;
                    const dy = _cullCenter.y - playerPos.y;
                    const dz = _cullCenter.z - playerPos.z;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    mesh.castShadow = distSq < shadowDistSq;
                }
            }
        }
    }

    updateVisibleChunks(playerPos, renderDistance = 2, maxNewPerFrame = 1) {
        const coords = this.world.computeChunkCoordinates(playerPos.x, playerPos.y, playerPos.z);

        const keepChunks = new Set();
        const needMesh = [];

        for (let x = -renderDistance; x <= renderDistance; x++) {
            for (let y = -renderDistance; y <= renderDistance; y++) {
                for (let z = -renderDistance; z <= renderDistance; z++) {
                    const cx = coords.chunkX + x;
                    const cy = coords.chunkY + y;
                    const cz = coords.chunkZ + z;
                    const cellId = `${cx},${cy},${cz}`;

                    keepChunks.add(cellId);

                    if (!this.meshes.has(cellId) && !this.pendingWorker.has(cellId)) {
                        const dist = x * x + y * y + z * z;
                        needMesh.push({ cx, cy, cz, dist });
                    }
                }
            }
        }

        needMesh.sort((a, b) => a.dist - b.dist);
        const budget = Math.min(needMesh.length, maxNewPerFrame);
        for (let i = 0; i < budget; i++) {
            const { cx, cy, cz } = needMesh[i];
            const worldX = cx * this.world.chunkSize;
            const worldY = cy * this.world.chunkSize;
            const worldZ = cz * this.world.chunkSize;
            this.updateCellGeometryAsync(worldX, worldY, worldZ);
        }

        // Cleanup outside render distance
        for (const [cellId, entry] of this.meshes.entries()) {
            if (!keepChunks.has(cellId)) {
                if (entry.opaque) { this.scene.remove(entry.opaque); entry.opaque.geometry.dispose(); }
                if (entry.transparent) { this.scene.remove(entry.transparent); entry.transparent.geometry.dispose(); }
                this.meshes.delete(cellId);
            }
        }
    }
}
