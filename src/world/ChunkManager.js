import * as THREE from 'three';
import MeshWorker from '../workers/meshWorker.js?worker';

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _cullSphere = new THREE.Sphere();
const _cullCenter = new THREE.Vector3();

const WORKER_POOL_SIZE = Math.min(navigator.hardwareConcurrency || 4, 8);

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

        let entry = this.meshes.get(cellId);
        if (!entry) {
            entry = { opaque: null, transparent: null };
            this.meshes.set(cellId, entry);
        }

        if (positions.length === 0) {
            if (entry.opaque) { this.scene.remove(entry.opaque); entry.opaque.geometry.dispose(); entry.opaque = null; }
            if (entry.transparent) { this.scene.remove(entry.transparent); entry.transparent.geometry.dispose(); entry.transparent = null; }
            this.meshes.delete(cellId);
            return;
        }

        // Remove the opaque mesh — sync path merges everything into transparent
        // Without this, the old opaque mesh stays with stale geometry (ghost blocks)
        if (entry.opaque) {
            this.scene.remove(entry.opaque);
            entry.opaque.geometry.dispose();
            entry.opaque = null;
        }

        const geoData = { positions, normals, uvs, indices, colors };
        this._applyGeometryForKey(entry, coords, cellId, 'transparent', geoData, this.transparentMaterial);
    }

    // Queue a chunk for off-thread meshing
    updateCellGeometryAsync(x, y, z) {
        const coords = this.world.computeChunkCoordinates(x, y, z);
        const cellId = `${coords.chunkX},${coords.chunkY},${coords.chunkZ}`;

        if (this.pendingWorker.has(cellId)) return false; // Already in flight

        const workerIdx = this._getFreeWorker();
        if (workerIdx === -1) {
            // All workers busy — don't block, retry next frame
            return false;
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

        const { cellX, cellY, cellZ, opaque, transparent } = data;
        const cellId = `${cellX},${cellY},${cellZ}`;
        this.pendingWorker.delete(cellId);

        const coords = { chunkX: cellX, chunkY: cellY, chunkZ: cellZ };

        let entry = this.meshes.get(cellId);
        if (!entry) {
            entry = { opaque: null, transparent: null };
            this.meshes.set(cellId, entry);
        }

        const isEmpty = opaque.positions.length === 0 && transparent.positions.length === 0;
        if (isEmpty) {
            if (entry.opaque) { this.scene.remove(entry.opaque); entry.opaque.geometry.dispose(); entry.opaque = null; }
            if (entry.transparent) { this.scene.remove(entry.transparent); entry.transparent.geometry.dispose(); entry.transparent = null; }
            this.meshes.delete(cellId);
            return;
        }

        // Apply opaque geometry
        this._applyGeometryForKey(entry, coords, cellId, 'opaque', opaque, this.opaqueMaterial);
        // Apply transparent geometry
        this._applyGeometryForKey(entry, coords, cellId, 'transparent', transparent, this.transparentMaterial);
    }

    _applyGeometryForKey(entry, coords, cellId, key, geoData, material) {
        const { positions, normals, uvs, indices, colors } = geoData;

        if (positions.length === 0) {
            // Remove this sub-mesh if it exists
            if (entry[key]) {
                this.scene.remove(entry[key]);
                entry[key].geometry.dispose();
                entry[key] = null;
            }
            return;
        }

        const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions);
        const normArr = normals instanceof Float32Array ? normals : new Float32Array(normals);
        const uvArr = uvs instanceof Float32Array ? uvs : new Float32Array(uvs);
        const idxArr = indices instanceof Uint32Array ? indices : new Uint32Array(indices);

        let mesh = entry[key];

        if (mesh) {
            const geo = mesh.geometry;
            // Re-use existing buffers if possible
            const posAttr = geo.getAttribute('position');
            if (posAttr && posAttr.array.length >= posArr.length) {
                posAttr.array.set(posArr); posAttr.count = posArr.length / 3; posAttr.needsUpdate = true;
            } else {
                geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
            }

            const normAttr = geo.getAttribute('normal');
            if (normAttr && normAttr.array.length >= normArr.length) {
                normAttr.array.set(normArr); normAttr.count = normArr.length / 3; normAttr.needsUpdate = true;
            } else {
                geo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
            }

            const uvAttr = geo.getAttribute('uv');
            if (uvAttr && uvAttr.array.length >= uvArr.length) {
                uvAttr.array.set(uvArr); uvAttr.count = uvArr.length / 2; uvAttr.needsUpdate = true;
            } else {
                geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
            }

            if (colors && colors.length > 0) {
                const colorArr = colors instanceof Float32Array ? colors : new Float32Array(colors);
                const colAttr = geo.getAttribute('color');
                if (colAttr && colAttr.array.length >= colorArr.length) {
                    colAttr.array.set(colorArr); colAttr.count = colorArr.length / 3; colAttr.needsUpdate = true;
                } else {
                    geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
                }
            }

            geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
            geo.setDrawRange(0, idxArr.length);
            geo.computeBoundingSphere();
        } else {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));

            if (colors && colors.length > 0) {
                const colorArr = colors instanceof Float32Array ? colors : new Float32Array(colors);
                geometry.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
            }

            geometry.setIndex(new THREE.BufferAttribute(idxArr, 1));
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

            entry[key] = mesh;
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
            // Process opaque and transparent without allocating arrays
            for (let i = 0; i < 2; i++) {
                const mesh = i === 0 ? entry.opaque : entry.transparent;
                if (!mesh) continue;

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

    updateVisibleChunks(playerPos, renderDistance = 2, maxNewPerFrame = 4) {
        const coords = this.world.computeChunkCoordinates(playerPos.x, playerPos.y, playerPos.z);

        const keepChunks = new Set();
        const needMesh = [];
        const renderDistSq = renderDistance * renderDistance;

        // Clamp Y to terrain range
        const yMin = Math.max(-1, coords.chunkY - renderDistance);
        const yMax = Math.min(5, coords.chunkY + renderDistance);

        for (let x = -renderDistance; x <= renderDistance; x++) {
            for (let z = -renderDistance; z <= renderDistance; z++) {
                const xzDist = x * x + z * z;
                if (xzDist > renderDistSq) continue; // Circular: skip corners

                for (let cy = yMin; cy <= yMax; cy++) {
                    const cx = coords.chunkX + x;
                    const cz = coords.chunkZ + z;
                    const cellId = `${cx},${cy},${cz}`;

                    keepChunks.add(cellId);

                    if (!this.meshes.has(cellId) && !this.pendingWorker.has(cellId)) {
                        const y = cy - coords.chunkY;
                        const dist = xzDist + y * y;
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
