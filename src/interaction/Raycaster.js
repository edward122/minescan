import * as THREE from 'three';
import { BlockRegistry } from '../world/BlockRegistry.js';

export class VoxelRaycaster {
    constructor(world) {
        this.world = world;
    }

    // Fast Voxel Traversal Algorithm for Ray Tracing
    // Amanatides & Woo (1987)
    intersectRay(start, direction, maxDistance = 5) {
        let dx = direction.x;
        let dy = direction.y;
        let dz = direction.z;

        const lenSq = dx * dx + dy * dy + dz * dz;
        if (lenSq === 0) return null;
        const len = Math.sqrt(lenSq);
        dx /= len;
        dy /= len;
        dz /= len;

        let t = 0.0;
        let ix = Math.floor(start.x);
        let iy = Math.floor(start.y);
        let iz = Math.floor(start.z);

        const stepX = (dx > 0) ? 1 : -1;
        const stepY = (dy > 0) ? 1 : -1;
        const stepZ = (dz > 0) ? 1 : -1;

        const txDelta = Math.abs(1 / dx);
        const tyDelta = Math.abs(1 / dy);
        const tzDelta = Math.abs(1 / dz);

        const xDist = (stepX > 0) ? (ix + 1 - start.x) : (start.x - ix);
        const yDist = (stepY > 0) ? (iy + 1 - start.y) : (start.y - iy);
        const zDist = (stepZ > 0) ? (iz + 1 - start.z) : (start.z - iz);

        let txMax = (txDelta < Infinity) ? txDelta * xDist : Infinity;
        let tyMax = (tyDelta < Infinity) ? tyDelta * yDist : Infinity;
        let tzMax = (tzDelta < Infinity) ? tzDelta * zDist : Infinity;

        let steppedIndex = -1;

        while (t <= maxDistance) {
            const voxel = this.world.getVoxel(ix, iy, iz);
            if (voxel) {
                // Skip fluid blocks (water, lava) — can't target them
                const blockDef = BlockRegistry[voxel];
                if (blockDef && blockDef.isFluid) {
                    // Treat as air, continue traversal
                } else {
                    const normal = new THREE.Vector3();
                    if (steppedIndex === 0) normal.x = -stepX;
                    if (steppedIndex === 1) normal.y = -stepY;
                    if (steppedIndex === 2) normal.z = -stepZ;

                    return {
                        position: new THREE.Vector3(ix, iy, iz),
                        normal,
                        voxel
                    };
                }
            }

            if (txMax < tyMax) {
                if (txMax < tzMax) {
                    ix += stepX;
                    t = txMax;
                    txMax += txDelta;
                    steppedIndex = 0;
                } else {
                    iz += stepZ;
                    t = tzMax;
                    tzMax += tzDelta;
                    steppedIndex = 2;
                }
            } else {
                if (tyMax < tzMax) {
                    iy += stepY;
                    t = tyMax;
                    tyMax += tyDelta;
                    steppedIndex = 1;
                } else {
                    iz += stepZ;
                    t = tzMax;
                    tzMax += tzDelta;
                    steppedIndex = 2;
                }
            }
        }

        return null;
    }
}
