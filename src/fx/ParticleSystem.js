import * as THREE from 'three';
import { BlockRegistry } from '../world/BlockRegistry.js';

const MAX_BURST = 500;
const MAX_FLAME = 300;

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export class ParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.enabled = true;
        this.reduced = false;

        // Torch emitters
        this.torchEmitters = new Map();
        this.torchTimer = 0;

        // --- Burst particles (block break) via InstancedMesh ---
        this.burstData = [];
        const burstGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const burstMat = new THREE.MeshBasicMaterial({
            transparent: true,
            vertexColors: false,
        });
        this.burstMesh = new THREE.InstancedMesh(burstGeo, burstMat, MAX_BURST);
        this.burstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Per-instance color
        this.burstMesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(MAX_BURST * 3), 3
        );
        this.burstMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.burstMesh.geometry.setAttribute('instanceColor', this.burstMesh.instanceColor);
        this.burstMesh.count = 0;
        this.burstMesh.frustumCulled = false;
        this.scene.add(this.burstMesh);

        // --- Flame particles (torch) via InstancedMesh ---
        this.flameData = [];
        const flameGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
        const flameMat = new THREE.MeshBasicMaterial({
            color: 0xffaa33,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        this.flameMesh = new THREE.InstancedMesh(flameGeo, flameMat, MAX_FLAME);
        this.flameMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.flameMesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(MAX_FLAME * 3), 3
        );
        this.flameMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.flameMesh.geometry.setAttribute('instanceColor', this.flameMesh.instanceColor);
        this.flameMesh.count = 0;
        this.flameMesh.frustumCulled = false;
        this.scene.add(this.flameMesh);
    }

    // --- Block Break Particles ---
    emitBlockBreak(x, y, z, blockId) {
        if (!this.enabled) return;
        const baseColor = this._getBlockColor(blockId);
        const maxCount = this.reduced ? 4 : 8;
        const count = maxCount + Math.floor(Math.random() * (this.reduced ? 2 : 5));
        const cap = this.reduced ? 200 : MAX_BURST;

        for (let i = 0; i < count; i++) {
            if (this.burstData.length >= cap) break;

            const size = 0.08 + Math.random() * 0.12;

            this.burstData.push({
                x: x + 0.5 + (Math.random() - 0.5) * 0.6,
                y: y + 0.5 + (Math.random() - 0.5) * 0.6,
                z: z + 0.5 + (Math.random() - 0.5) * 0.6,
                vx: (Math.random() - 0.5) * 6,
                vy: Math.random() * 5 + 2,
                vz: (Math.random() - 0.5) * 6,
                size,
                lifetime: 0.4 + Math.random() * 0.4,
                age: 0,
                r: baseColor.r + (Math.random() - 0.5) * 0.2,
                g: baseColor.g + (Math.random() - 0.5) * 0.2,
                b: baseColor.b + (Math.random() - 0.5) * 0.2,
            });
        }
    }

    // --- Torch Flame Particles ---
    addTorchEmitter(x, y, z) {
        this.torchEmitters.set(`${x},${y},${z}`, { x, y, z });
    }

    removeTorchEmitter(x, y, z) {
        this.torchEmitters.delete(`${x},${y},${z}`);
    }

    _emitTorchParticle(ex, ey, ez) {
        if (!this.enabled) return;
        const cap = this.reduced ? 100 : MAX_FLAME;
        if (this.flameData.length >= cap) return;

        const isOrange = Math.random() > 0.3;
        _color.setHSL(
            isOrange ? 0.07 + Math.random() * 0.05 : 0.13,
            1.0,
            isOrange ? 0.5 + Math.random() * 0.2 : 0.7 + Math.random() * 0.2
        );

        this.flameData.push({
            x: ex + 0.5 + (Math.random() - 0.5) * 0.15,
            y: ey + 0.6,
            z: ez + 0.5 + (Math.random() - 0.5) * 0.15,
            vx: (Math.random() - 0.5) * 0.3,
            vy: 1.0 + Math.random() * 1.5,
            vz: (Math.random() - 0.5) * 0.3,
            size: 0.04 + Math.random() * 0.04,
            lifetime: 0.3 + Math.random() * 0.5,
            age: 0,
            r: _color.r,
            g: _color.g,
            b: _color.b,
        });
    }

    // --- Update Loop ---
    update(dt) {
        // Emit torch particles periodically
        this.torchTimer += dt;
        if (this.torchTimer > 0.05) {
            this.torchTimer = 0;
            for (const emitter of this.torchEmitters.values()) {
                if (Math.random() < 0.6) {
                    this._emitTorchParticle(emitter.x, emitter.y, emitter.z);
                }
            }
        }

        // Update burst particles
        this._updatePool(this.burstData, this.burstMesh, dt, true);

        // Update flame particles
        this._updatePool(this.flameData, this.flameMesh, dt, false);
    }

    _updatePool(pool, instancedMesh, dt, isBurst) {
        let writeIndex = 0;

        for (let i = 0; i < pool.length; i++) {
            const p = pool[i];
            p.age += dt;

            if (p.age >= p.lifetime) continue; // Dead, skip

            // Physics
            if (isBurst) {
                p.vy -= 20 * dt;
            } else {
                p.vy -= 0.5 * dt;
            }

            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;

            // Fade + shrink
            const t = p.age / p.lifetime;
            const scale = p.size * (1.0 - t * 0.5);

            // Write to instanced mesh
            _dummy.position.set(p.x, p.y, p.z);
            _dummy.scale.setScalar(scale / 0.1); // Normalize against base geometry size
            _dummy.updateMatrix();
            instancedMesh.setMatrixAt(writeIndex, _dummy.matrix);

            // Color with opacity baked into brightness
            const opacity = 1.0 - t;
            instancedMesh.instanceColor.setXYZ(
                writeIndex,
                p.r * opacity,
                p.g * opacity,
                p.b * opacity
            );

            // Compact the array
            if (writeIndex !== i) {
                pool[writeIndex] = p;
            }
            writeIndex++;
        }

        // Trim dead particles from end
        pool.length = writeIndex;

        // Update GPU buffers
        instancedMesh.count = writeIndex;
        if (writeIndex > 0) {
            instancedMesh.instanceMatrix.needsUpdate = true;
            instancedMesh.instanceColor.needsUpdate = true;
        }
    }

    _getBlockColor(blockId) {
        const colorMap = {
            1: 0x8B5A2B,  // Dirt
            2: 0x4CAF50,  // Grass
            3: 0x808080,  // Stone
            4: 0x6D4C2A,  // Wood
            5: 0x2E7D32,  // Leaves
            6: 0xEDC9AF,  // Sand
            7: 0xCCEEFF,  // Glass
            9: 0xC4A060,  // Oak Planks
            10: 0x666666, // Cobblestone
            11: 0x333333, // Coal Ore
            12: 0xCC9966, // Iron Ore
            13: 0xFFD700, // Gold Ore
            14: 0x00FFFF, // Diamond Ore
            48: 0xFF4400, // Lava
            49: 0x888888, // Gravel
            50: 0xA0A8B8, // Clay
            51: 0x2D7A1C, // Kelp
            53: 0x5A7555, // Mossy Cobblestone
        };
        return new THREE.Color(colorMap[blockId] || 0x888888);
    }
}
