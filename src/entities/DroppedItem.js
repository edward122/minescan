import * as THREE from 'three';
import { BlockRegistry } from '../world/BlockRegistry.js';

export class DroppedItem {
    constructor(itemId, count, position, scene, world, initialVelocity = null) {
        this.itemId = itemId;
        this.count = count;
        this.scene = scene;
        this.world = world;
        this.isDead = false;
        this.lifetime = 300; // 5 minutes
        this.age = 0;
        this.pickupDelay = 0.5; // Can't pick up immediately (prevents instant re-grab)

        // Physics
        this.velocity = initialVelocity || new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            5 + Math.random() * 3,
            (Math.random() - 0.5) * 4
        );
        this.isGrounded = false;

        // Visual: small textured cube
        const size = 0.25;
        const geo = new THREE.BoxGeometry(size, size, size);
        const color = this._getColor(itemId);
        const mat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.8,
            metalness: 0.1
        });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.position.copy(position);
        this.mesh.position.y += 0.5; // Pop up from center of broken block

        this.bobOffset = Math.random() * Math.PI * 2; // Random phase for bobbing
        this.scene.add(this.mesh);
    }

    _getColor(blockId) {
        const colorMap = {
            1: 0x8B5A2B, 2: 0x4CAF50, 3: 0x808080, 4: 0x6D4C2A,
            5: 0x2E7D32, 6: 0xEDC9AF, 7: 0xCCEEFF, 9: 0xC4A060,
            10: 0x666666, 11: 0x333333, 12: 0xCC9966, 13: 0xFFD700,
            14: 0x00FFFF, 15: 0xC4A060, 40: 0xf0f0f0, 41: 0x333333,
            42: 0x41980a, 43: 0xff3333, 44: 0xffdd00, // grass, flowers
            45: 0xFFAABB, // Raw Porkchop (pink)
            46: 0xBB3333, // Raw Beef (red)
            47: 0xD4A04A, // Bread (golden)
        };
        // Tool items (wooden=brown, stone=gray, iron=silver, gold=gold, diamond=cyan)
        if (blockId >= 16 && blockId <= 19) return 0x8B6914; // wood tools
        if (blockId >= 20 && blockId <= 23) return 0x888888; // stone tools
        if (blockId >= 24 && blockId <= 27) return 0xCCCCCC; // iron tools
        if (blockId >= 28 && blockId <= 31) return 0xFFD700; // gold tools
        if (blockId >= 32 && blockId <= 35) return 0x00DDDD; // diamond tools
        if (blockId === 36 || blockId === 37) return 0x8B4513; // sticks, crafting table
        return colorMap[blockId] || 0x888888;
    }

    update(dt, playerPos) {
        this.age += dt;
        if (this.age > this.lifetime) {
            this.destroy();
            return;
        }
        if (this.pickupDelay > 0) this.pickupDelay -= dt;

        // Gravity
        if (!this.isGrounded) {
            this.velocity.y -= 20 * dt;
            if (this.velocity.y < -20) this.velocity.y = -20;
        }

        // Move Y
        const nextY = this.mesh.position.y + this.velocity.y * dt;
        const blockBelow = this.world.getVoxel(
            Math.floor(this.mesh.position.x),
            Math.floor(nextY - 0.1),
            Math.floor(this.mesh.position.z)
        );
        if (blockBelow > 0 && blockBelow !== 8 && blockBelow !== 42 && blockBelow !== 43 && blockBelow !== 44) {
            // Hit ground
            this.velocity.y = 0;
            this.isGrounded = true;
            this.mesh.position.y = Math.floor(nextY - 0.1) + 1 + 0.15;
        } else {
            this.mesh.position.y = nextY;
            this.isGrounded = false;
        }

        // Move X/Z (only while airborne)
        if (!this.isGrounded) {
            this.mesh.position.x += this.velocity.x * dt;
            this.mesh.position.z += this.velocity.z * dt;
            // Friction
            this.velocity.x *= 0.98;
            this.velocity.z *= 0.98;
        }

        // Bobbing & spinning when grounded
        if (this.isGrounded) {
            this.mesh.position.y += Math.sin(this.age * 2 + this.bobOffset) * 0.05;
        }
        this.mesh.rotation.y += dt * 2;

        // Magnet toward player when close
        if (this.pickupDelay <= 0 && playerPos) {
            const dist = this.mesh.position.distanceTo(playerPos);
            if (dist < 3.0) {
                // Fly toward player
                const dir = new THREE.Vector3().subVectors(playerPos, this.mesh.position).normalize();
                this.mesh.position.addScaledVector(dir, dt * 10);
            }
        }
    }

    canPickup(playerPos) {
        if (this.pickupDelay > 0 || this.isDead) return false;
        const dist = this.mesh.position.distanceTo(playerPos);
        return dist < 2.0;
    }

    destroy() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.isDead = true;
    }
}
