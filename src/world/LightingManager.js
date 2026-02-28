import * as THREE from 'three';

const MAX_ACTIVE_LIGHTS = 8;

export class LightingManager {
    constructor(scene) {
        this.scene = scene;
        this.torchPositions = new Map(); // Key: "x,y,z", Value: {x, y, z}
        this._lightsEnabled = true;

        // Pre-allocate a pool of lights — only these ever get added to the scene
        this.lightPool = [];
        for (let i = 0; i < MAX_ACTIVE_LIGHTS; i++) {
            const light = new THREE.PointLight(0xffaa00, 1.0, 15);
            light.visible = false;
            this.scene.add(light);
            this.lightPool.push({ light, assignedKey: null });
        }
    }

    addTorch(x, y, z) {
        const key = `${x},${y},${z}`;
        if (this.torchPositions.has(key)) return;
        this.torchPositions.set(key, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    }

    removeTorch(x, y, z) {
        const key = `${x},${y},${z}`;
        this.torchPositions.delete(key);
    }

    /**
     * Call every frame (or every few frames) with the player position.
     * Assigns the limited light pool to the closest torches.
     */
    updateLights(playerX, playerY, playerZ) {
        // If lights disabled via settings, hide everything and skip
        if (!this._lightsEnabled) {
            for (const slot of this.lightPool) {
                slot.light.visible = false;
                slot.assignedKey = null;
            }
            return;
        }

        if (this.torchPositions.size === 0) {
            // No torches — hide all lights
            for (const slot of this.lightPool) {
                slot.light.visible = false;
                slot.assignedKey = null;
            }
            return;
        }

        // Find the N closest torches to the player
        const sorted = [];
        for (const [key, pos] of this.torchPositions) {
            const dx = pos.x - playerX;
            const dy = pos.y - playerY;
            const dz = pos.z - playerZ;
            sorted.push({ key, pos, dist: dx * dx + dy * dy + dz * dz });
        }
        sorted.sort((a, b) => a.dist - b.dist);

        // Assign lights to the closest torches
        for (let i = 0; i < this.lightPool.length; i++) {
            const slot = this.lightPool[i];
            if (i < sorted.length) {
                const { key, pos } = sorted[i];
                slot.light.position.set(pos.x, pos.y, pos.z);
                slot.light.visible = true;
                slot.assignedKey = key;
            } else {
                slot.light.visible = false;
                slot.assignedKey = null;
            }
        }
    }
}
