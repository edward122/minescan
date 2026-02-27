import * as THREE from 'three';

export class Arrow {
    constructor(position, direction, scene, world, isPlayerArrow = false) {
        this.scene = scene;
        this.world = world;
        this.isPlayerArrow = isPlayerArrow;
        this.isDead = false;
        this.lifetime = 5; // seconds before despawn
        this.damage = 4;

        // Create arrow mesh (thin box)
        const shaftGeo = new THREE.BoxGeometry(0.05, 0.05, 0.6);
        const shaftMat = new THREE.MeshLambertMaterial({ color: '#8B4513' });
        this.mesh = new THREE.Mesh(shaftGeo, shaftMat);

        // Arrowhead
        const headGeo = new THREE.BoxGeometry(0.1, 0.1, 0.15);
        const headMat = new THREE.MeshLambertMaterial({ color: '#888888' });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.z = -0.35;
        this.mesh.add(head);

        this.mesh.position.copy(position);
        scene.add(this.mesh);

        // Velocity
        this.velocity = direction.clone().normalize().multiplyScalar(20); // 20 blocks/second

        // Point arrow in direction of travel
        const target = position.clone().add(direction);
        this.mesh.lookAt(target);
    }

    update(dt) {
        if (this.isDead) return;

        this.lifetime -= dt;
        if (this.lifetime <= 0) {
            this.destroy();
            return;
        }

        // Gravity
        this.velocity.y -= 15 * dt;

        // Move
        const movement = this.velocity.clone().multiplyScalar(dt);
        this.mesh.position.add(movement);

        // Update rotation to face direction of travel
        if (this.velocity.lengthSq() > 0.1) {
            const target = this.mesh.position.clone().add(this.velocity);
            this.mesh.lookAt(target);
        }

        // Check block collision
        const px = Math.floor(this.mesh.position.x);
        const py = Math.floor(this.mesh.position.y);
        const pz = Math.floor(this.mesh.position.z);
        const voxel = this.world.getVoxel(px, py, pz);
        if (voxel > 0 && voxel !== 8) { // Hit solid block (not water)
            this.destroy();
            return;
        }

        // Below ground
        if (this.mesh.position.y < 0) {
            this.destroy();
        }
    }

    checkPlayerHit(playerPos) {
        if (this.isDead || this.isPlayerArrow) return false;
        const dist = this.mesh.position.distanceTo(playerPos);
        return dist < 1.0;
    }

    destroy() {
        this.isDead = true;
        this.scene.remove(this.mesh);
        if (this.mesh.geometry) this.mesh.geometry.dispose();
    }
}
