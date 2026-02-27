import * as THREE from 'three';
import { Blocks, BlockRegistry, isBlockNoCollision } from '../world/BlockRegistry.js';

export class Player {
    constructor(camera, inputManager, world) {
        this.camera = camera;
        this.inputManager = inputManager;
        this.world = world;

        this.position = new THREE.Vector3(32, 20, 32);
        this.velocity = new THREE.Vector3(0, 0, 0);

        // Euler rotation for camera (YXZ order for FPS control)
        this.rotation = new THREE.Euler(0, 0, 0, 'YXZ');

        // Physics constants
        this.speed = 4.3; // walking speed m/s
        this.sprintSpeed = 5.6;
        this.mouseSensitivity = 0.002;
        this.jumpForce = 8.0;
        this.gravity = 30.0;

        this.onGround = false;
        this.radius = 0.3; // Half-width
        this.height = 1.6; // Eye height

        // Survival Stats
        this.health = 20;
        this.maxHealth = 20;
        this.hunger = 20;
        this.maxHunger = 20;

        this.hungerTimer = 0;
        this.lastDamageTime = 0;

        this.distanceMoved = 0;

        // Water state
        this.isInWater = false;
        this.isSubmerged = false; // Head underwater
        this.underwaterTimer = 0;
        this.maxAir = 10; // seconds of air
        this.air = this.maxAir;

        // Fall damage
        this.fallStartY = this.position.y;
        this.isFalling = false;

        this.audioSystem = null;

        // Noclip fly mode (localhost only)
        this.isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        this.noclip = false;
        this.noclipSpeed = 20;
        this.noclipFastSpeed = 60;

        // HUD Elements
        this.healthBar = document.getElementById('health-bar');
        this.hungerBar = document.getElementById('hunger-bar');
        this.airBar = document.getElementById('air-bar');
        this.underwaterOverlay = document.getElementById('underwater-overlay');
        this.initHUD();
    }

    initHUD() {
        if (!this.healthBar || !this.hungerBar || !this.airBar) return;
        this.healthBar.innerHTML = '';
        this.hungerBar.innerHTML = '';
        this.airBar.innerHTML = '';

        // Create 10 hearts, 10 hunger icons, and 10 air bubbles
        for (let i = 0; i < 10; i++) {
            const heart = document.createElement('div');
            heart.className = 'heart';
            this.healthBar.appendChild(heart);

            const hunger = document.createElement('div');
            hunger.className = 'hunger';
            this.hungerBar.appendChild(hunger);

            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            this.airBar.appendChild(bubble);
        }
        this.updateHUD();
    }

    updateHUD() {
        if (!this.healthBar || !this.hungerBar) return;

        // Update Hearts
        const hearts = this.healthBar.children;
        for (let i = 0; i < 10; i++) {
            // Simplified: 1 icon = 2 HP
            if (this.health >= (i + 1) * 2) {
                hearts[i].className = 'heart';
            } else if (this.health > i * 2) {
                hearts[i].className = 'heart half'; // If we add half-style later
            } else {
                hearts[i].className = 'heart empty';
            }
        }

        // Update Hunger
        const hungers = this.hungerBar.children;
        for (let i = 0; i < 10; i++) {
            if (this.hunger >= (i + 1) * 2) {
                hungers[i].className = 'hunger';
            } else if (this.hunger > i * 2) {
                hungers[i].className = 'hunger half';
            } else {
                hungers[i].className = 'hunger empty';
            }
        }

        // Update Air
        const bubbles = this.airBar.children;
        for (let i = 0; i < 10; i++) {
            if (this.isSubmerged && i < Math.ceil(this.air)) {
                bubbles[i].className = 'bubble';
            } else {
                bubbles[i].className = 'bubble empty';
            }
        }
    }

    takeDamage(amount) {
        const now = performance.now();
        // 0.5s invulnerability frames (500ms)
        if (now - this.lastDamageTime < 500) return;

        this.health -= amount;
        this.lastDamageTime = now;

        if (this.audioSystem) {
            this.audioSystem.playHit();
        }

        // Damage flash
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.4)';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '1000';
        document.body.appendChild(overlay);

        setTimeout(() => document.body.removeChild(overlay), 200);

        if (this.health <= 0) {
            this.die();
        }
        this.updateHUD();
    }

    die() {
        console.log("Player Died!");
        window.dispatchEvent(new CustomEvent('player-death'));
    }

    respawn() {
        this.position.set(32, 100, 32);
        this.velocity.set(0, 0, 0);
        this.health = this.maxHealth;
        this.hunger = this.maxHunger;
        this.air = this.maxAir;
        this.underwaterTimer = 0;
        this.isInWater = false;
        this.isSubmerged = false;
        this.updateHUD();
    }

    update(dt) {
        this.handleMouse();

        // Noclip toggle (Z key, localhost only)
        if (this.isLocalhost) {
            const zPressed = this.inputManager.isKeyPressed('KeyZ');
            if (zPressed && !this.noclip) {
                this.noclip = true;
                this.velocity.set(0, 0, 0);
            } else if (!zPressed && this.noclip) {
                this.noclip = false;
                this.velocity.set(0, 0, 0);
                this.isFalling = false;
                this.fallStartY = this.position.y;
            }
        }

        this.handleKeyboard(dt);
        if (!this.noclip) {
            this.applyPhysics(dt);
        }

        // Water detection
        const feetBlock = this.world.getVoxel(
            Math.floor(this.position.x),
            Math.floor(this.position.y - this.height),
            Math.floor(this.position.z)
        );
        const headBlock = this.world.getVoxel(
            Math.floor(this.position.x),
            Math.floor(this.position.y),
            Math.floor(this.position.z)
        );
        const wasInWater = this.isInWater;
        this.isInWater = (feetBlock === Blocks.WATER || headBlock === Blocks.WATER);

        const wasSubmerged = this.isSubmerged;
        this.isSubmerged = (headBlock === Blocks.WATER);

        if (this.underwaterOverlay) {
            if (this.isSubmerged && this.underwaterOverlay.classList.contains('hidden')) {
                this.underwaterOverlay.classList.remove('hidden');
            } else if (!this.isSubmerged && !this.underwaterOverlay.classList.contains('hidden')) {
                this.underwaterOverlay.classList.add('hidden');
            }
        }

        // Splash sound on entering water
        if (this.isInWater && !wasInWater && this.audioSystem) {
            this.audioSystem.playSplash();
        }

        // Drowning
        if (this.isSubmerged) {
            this.underwaterTimer += dt;
            if (this.underwaterTimer > this.maxAir) {
                // 1 damage per second after air runs out
                const drownTick = this.underwaterTimer - this.maxAir;
                if (drownTick - Math.floor(drownTick) < dt) {
                    this.takeDamage(1);
                }
            }
            this.air = Math.max(0, this.maxAir - this.underwaterTimer);
            if (!wasSubmerged || Math.ceil(this.air) !== Math.ceil(Math.max(0, this.maxAir - (this.underwaterTimer - dt)))) {
                this.updateHUD(); // Only update HUD when air changes an integer value or on first submerge
            }
        } else {
            const hadAirMissing = this.air < this.maxAir;
            this.underwaterTimer = 0;
            this.air = this.maxAir;
            if (wasSubmerged || hadAirMissing) {
                this.updateHUD();
            }
        }

        // Calculate horizontal distance moved for footsteps
        if (this.onGround && (this.velocity.x !== 0 || this.velocity.z !== 0)) {
            const hDist = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2) * dt;
            this.distanceMoved += hDist;

            if (this.distanceMoved > 2.0) {
                this.distanceMoved = 0;
                if (this.audioSystem) {
                    this.audioSystem.playFootstep();
                }
            }
        } else if (!this.onGround) {
            this.distanceMoved = 1.8;
        }

        // Manage hunger over time
        this.hungerTimer += dt;
        if (this.hungerTimer > 10) {
            this.hungerTimer = 0;
            if (this.velocity.x !== 0 || this.velocity.z !== 0 || !this.onGround) {
                this.hunger = Math.max(0, this.hunger - 1);
                this.updateHUD();
            }
        }

        // Natural regeneration if food is full
        if (this.hunger >= 18 && this.health < this.maxHealth && this.hungerTimer % 4 < dt) {
            this.health = Math.min(this.maxHealth, this.health + 1);
            this.updateHUD();
        }

        // Update camera to match player
        this.camera.position.copy(this.position);
        this.camera.quaternion.setFromEuler(this.rotation);
    }

    handleMouse() {
        if (!this.inputManager.isLocked) return;

        const { x, y } = this.inputManager.getMouseMovement();

        this.rotation.y -= x * this.mouseSensitivity;
        this.rotation.x -= y * this.mouseSensitivity;

        // Clamp pitch to prevent looking past straight up/down
        this.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.rotation.x));
    }

    handleKeyboard(dt) {
        if (!this.inputManager.isLocked) {
            if (this.onGround) {
                this.velocity.x = 0;
                this.velocity.z = 0;
            }
            return;
        }

        // --- Noclip fly mode ---
        if (this.noclip) {
            const shiftHeld = this.inputManager.isKeyPressed('ShiftLeft') || this.inputManager.isKeyPressed('ShiftRight');
            const speed = shiftHeld ? this.noclipFastSpeed : this.noclipSpeed;

            const moveDir = new THREE.Vector3();
            if (this.inputManager.isKeyPressed('KeyW')) moveDir.z += 1;
            if (this.inputManager.isKeyPressed('KeyS')) moveDir.z -= 1;
            if (this.inputManager.isKeyPressed('KeyA')) moveDir.x -= 1;
            if (this.inputManager.isKeyPressed('KeyD')) moveDir.x += 1;

            // Vertical movement
            if (this.inputManager.isKeyPressed('Space')) moveDir.y += 1;
            if (this.inputManager.isKeyPressed('ControlLeft') || this.inputManager.isKeyPressed('ControlRight')) moveDir.y -= 1;

            if (moveDir.lengthSq() > 0) {
                moveDir.normalize();
            }

            // Apply camera rotation (pitch + yaw) so you fly where you look
            const forward = new THREE.Vector3(0, 0, -1).applyEuler(this.rotation);
            const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);
            const up = new THREE.Vector3(0, 1, 0);

            const flyVelocity = new THREE.Vector3();
            flyVelocity.addScaledVector(right, moveDir.x);
            flyVelocity.addScaledVector(up, moveDir.y);
            flyVelocity.addScaledVector(forward, moveDir.z);

            // Re-normalize after combining if non-zero to get consistent speed
            if (flyVelocity.lengthSq() > 0) {
                flyVelocity.normalize();
            }
            flyVelocity.multiplyScalar(speed);

            // Directly move position (no collision)
            this.position.addScaledVector(flyVelocity, dt);
            this.velocity.set(0, 0, 0);
            return;
        }

        // --- Normal movement ---
        let speed = this.inputManager.isKeyPressed('ShiftLeft') ? this.sprintSpeed : this.speed;
        if (this.isInWater) speed *= 0.4; // Slow in water

        const moveDir = new THREE.Vector3();
        if (this.inputManager.isKeyPressed('KeyW')) moveDir.z -= 1;
        if (this.inputManager.isKeyPressed('KeyS')) moveDir.z += 1;
        if (this.inputManager.isKeyPressed('KeyA')) moveDir.x -= 1;
        if (this.inputManager.isKeyPressed('KeyD')) moveDir.x += 1;

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
        }

        // Apply yaw rotation to move direction
        const moveVelocity = moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);
        moveVelocity.multiplyScalar(speed);

        // Instant velocity change for FPS feel (no inertia on x/z)
        this.velocity.x = moveVelocity.x;
        this.velocity.z = moveVelocity.z;

        // Jumping / Swimming
        if (this.inputManager.isKeyPressed('Space')) {
            if (this.isInWater) {
                this.velocity.y = 4; // Swim upward
            } else if (this.onGround) {
                this.velocity.y = this.jumpForce;
                this.onGround = false;
            }
        }
    }

    applyPhysics(dt) {
        // Gravity (reduced in water)
        const grav = this.isInWater ? this.gravity * 0.3 : this.gravity;
        this.velocity.y -= grav * dt;

        // Terminal velocity
        const maxFall = this.isInWater ? -5 : -30;
        if (this.velocity.y < maxFall) this.velocity.y = maxFall;

        // Water drag
        if (this.isInWater) {
            this.velocity.y *= 0.95;
        }

        const deltaPosition = this.velocity.clone().multiplyScalar(dt);

        this.collide(deltaPosition);
    }

    collide(deltaPosition) {
        // Check X
        this.position.x += deltaPosition.x;
        if (this.checkCollision()) {
            this.position.x -= deltaPosition.x;
            this.velocity.x = 0;
            deltaPosition.x = 0;
        }

        // Check Y
        this.position.y += deltaPosition.y;
        if (this.checkCollision()) {
            this.position.y -= deltaPosition.y;
            if (deltaPosition.y < 0) {
                // Landing — check fall damage
                if (this.isFalling) {
                    const fallDist = this.fallStartY - this.position.y;
                    if (fallDist > 3 && !this.isInWater) {
                        const damage = Math.floor(fallDist - 3);
                        this.takeDamage(damage);
                        if (this.audioSystem) this.audioSystem.playHit();
                    }
                    this.isFalling = false;
                }
                this.onGround = true;
            }
            this.velocity.y = 0;
            deltaPosition.y = 0;
        } else {
            this.onGround = false;
            // Track fall start position
            if (!this.isFalling && this.velocity.y < 0) {
                this.isFalling = true;
                this.fallStartY = this.position.y;
            }
            // Update fall start to highest point
            if (this.position.y > this.fallStartY) {
                this.fallStartY = this.position.y;
            }
        }

        // Check Z
        this.position.z += deltaPosition.z;
        if (this.checkCollision()) {
            this.position.z -= deltaPosition.z;
            this.velocity.z = 0;
            deltaPosition.z = 0;
        }
    }

    checkCollision() {
        const minX = Math.floor(this.position.x - this.radius);
        const maxX = Math.floor(this.position.x + this.radius);
        const minY = Math.floor(this.position.y - this.height);
        const maxY = Math.floor(this.position.y + 0.1);
        const minZ = Math.floor(this.position.z - this.radius);
        const maxZ = Math.floor(this.position.z + this.radius);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const voxel = this.world.getVoxel(x, y, z);

                    if (voxel === Blocks.CACTUS) {
                        this.takeDamage(1);
                    }

                    if (voxel !== 0 && voxel !== Blocks.WATER && !isBlockNoCollision(voxel)) {
                        return true;
                    }

                    // Custom AABB for doors to match visual mesh
                    if (voxel === Blocks.OAK_DOOR || voxel === Blocks.OAK_DOOR_TOP ||
                        voxel === Blocks.OAK_DOOR_BOTTOM_OPEN || voxel === Blocks.OAK_DOOR_TOP_OPEN) {

                        let dMinX = x, dMaxX = x + 1;
                        let dMinZ = z, dMaxZ = z + 1;

                        if (voxel === Blocks.OAK_DOOR || voxel === Blocks.OAK_DOOR_TOP) {
                            // Closed: clings to minX, spans Z
                            dMaxX = x + 3 / 16;
                        } else {
                            // Open: clings to minZ, spans X
                            dMaxZ = z + 3 / 16;
                        }

                        // Check intersection with player AABB
                        const pMinX = this.position.x - this.radius;
                        const pMaxX = this.position.x + this.radius;
                        const pMinY = this.position.y - this.height;
                        const pMaxY = this.position.y + 0.1;
                        const pMinZ = this.position.z - this.radius;
                        const pMaxZ = this.position.z + this.radius;

                        if (pMaxX > dMinX && pMinX < dMaxX &&
                            pMaxY > y && pMinY < y + 1 &&
                            pMaxZ > dMinZ && pMinZ < dMaxZ) {
                            return true;
                        }
                    }

                    // Custom AABB for trapdoors to match visual mesh
                    if (voxel === Blocks.TRAPDOOR || voxel === Blocks.TRAPDOOR_OPEN) {
                        let tMinX = x, tMaxX = x + 1;
                        let tMinY = y, tMaxY = y + 1;
                        let tMinZ = z, tMaxZ = z + 1;

                        if (voxel === Blocks.TRAPDOOR) {
                            // Closed: top of the block
                            tMinY = y + 13 / 16;
                        } else {
                            // Open: clings to minZ
                            tMaxZ = z + 3 / 16;
                        }

                        // Check intersection with player AABB
                        const pMinX = this.position.x - this.radius;
                        const pMaxX = this.position.x + this.radius;
                        const pMinY = this.position.y - this.height;
                        const pMaxY = this.position.y + 0.1;
                        const pMinZ = this.position.z - this.radius;
                        const pMaxZ = this.position.z + this.radius;

                        if (pMaxX > tMinX && pMinX < tMaxX &&
                            pMaxY > tMinY && pMinY < tMaxY &&
                            pMaxZ > tMinZ && pMinZ < tMaxZ) {
                            return true;
                        }
                    }
                }
            }
        }

        // Entity collision
        if (this.entityManager) {
            const pMinX = this.position.x - this.radius;
            const pMaxX = this.position.x + this.radius;
            const pMinY = this.position.y - this.height;
            const pMaxY = this.position.y + 0.1;
            const pMinZ = this.position.z - this.radius;
            const pMaxZ = this.position.z + this.radius;

            for (const mob of this.entityManager.entities) {
                const mobMinX = mob.mesh.position.x - mob.width / 2;
                const mobMaxX = mob.mesh.position.x + mob.width / 2;
                const mobMinY = mob.mesh.position.y;
                const mobMaxY = mob.mesh.position.y + mob.height;
                const mobMinZ = mob.mesh.position.z - mob.depth / 2;
                const mobMaxZ = mob.mesh.position.z + mob.depth / 2;

                if (pMaxX > mobMinX && pMinX < mobMaxX &&
                    pMaxY > mobMinY && pMinY < mobMaxY &&
                    pMaxZ > mobMinZ && pMinZ < mobMaxZ) {
                    return true;
                }
            }
        }

        return false;
    }
}
