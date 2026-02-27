import * as THREE from 'three';
import { Mob } from './Mob.js';
import { DroppedItem } from './DroppedItem.js';
import { Arrow } from './Arrow.js';

export class EntityManager {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.entities = [];
        this.droppedItems = [];
        this.arrows = [];
        this.skyManager = null; // Set externally after construction

        // Settings
        this.maxEntities = 20;
        this.spawnTimer = 0;
        this.spawnInterval = 5; // Attempt spawn every 5 seconds
        this.sunburnTimer = 0;

        // Listen for item drops from mobs
        window.addEventListener('item-dropped', (e) => {
            this.droppedItems.push(e.detail.item);
        });
    }

    addDroppedItem(itemId, count, position, velocity = null) {
        const item = new DroppedItem(itemId, count, position, this.scene, this.world, velocity);
        this.droppedItems.push(item);
        return item;
    }

    addArrow(position, direction) {
        const arrow = new Arrow(position, direction, this.scene, this.world, false);
        this.arrows.push(arrow);
        return arrow;
    }

    update(dt, player, inventory, audioSystem) {
        const isNight = this.skyManager ? this.skyManager.isNight() : false;

        // Update all existing entities
        for (let i = this.entities.length - 1; i >= 0; i--) {
            const entity = this.entities[i];

            if (entity.isDead) {
                this.entities.splice(i, 1);
                continue;
            }

            entity.update(dt, player, this.entities);

            // Skeleton arrow shooting
            if (entity.type === 'skeleton' && !entity.isDead) {
                if (entity.wantsToShoot) {
                    entity.wantsToShoot = false;
                    const arrowPos = entity.mesh.position.clone();
                    arrowPos.y += 1.4; // Shoot from head height
                    const dir = new THREE.Vector3().subVectors(player.position, arrowPos);
                    dir.y += dir.length() * 0.07; // Slight arc upward
                    this.addArrow(arrowPos, dir);
                }
            }
        }

        // Sunburn: hostile mobs burn in daylight unless under shade
        if (!isNight) {
            this.sunburnTimer -= dt;
            if (this.sunburnTimer <= 0) {
                this.sunburnTimer = 1.0; // Check every second
                for (const entity of this.entities) {
                    if (entity.isHostile && !entity.isDead) {
                        // Check if mob has sky above (not shaded)
                        const mx = Math.floor(entity.mesh.position.x);
                        const my = Math.floor(entity.mesh.position.y) + 2;
                        const mz = Math.floor(entity.mesh.position.z);
                        let shaded = false;
                        for (let y = my; y < my + 30; y++) {
                            const v = this.world.getVoxel(mx, y, mz);
                            if (v > 0 && v !== 8) { // Solid block above (not water)
                                shaded = true;
                                break;
                            }
                        }
                        if (!shaded) {
                            entity.takeDamage(2); // Burn damage
                            entity.isBurning = true;
                        } else {
                            entity.isBurning = false;
                        }
                    }
                }
            }
        }

        // Update arrows
        for (let i = this.arrows.length - 1; i >= 0; i--) {
            const arrow = this.arrows[i];

            if (arrow.isDead) {
                this.arrows.splice(i, 1);
                continue;
            }

            arrow.update(dt);

            // Check if arrow hit player
            if (arrow.checkPlayerHit(player.position)) {
                player.takeDamage(arrow.damage);
                if (audioSystem) audioSystem.playHit();
                arrow.destroy();
                this.arrows.splice(i, 1);
            }
        }

        // Update dropped items
        for (let i = this.droppedItems.length - 1; i >= 0; i--) {
            const item = this.droppedItems[i];

            if (item.isDead) {
                this.droppedItems.splice(i, 1);
                continue;
            }

            item.update(dt, player.position);

            // Check pickup
            if (item.canPickup(player.position)) {
                // Try to add to inventory
                const added = this._addToInventory(inventory, item.itemId, item.count);
                if (added) {
                    if (audioSystem) audioSystem.playPickup();
                    item.destroy();
                    this.droppedItems.splice(i, 1);
                    if (this._onItemPickedUp) this._onItemPickedUp();
                }
            }
        }

        // Handle Spawning
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnTimer = this.spawnInterval;
            this.attemptSpawn(player, isNight);
        }
    }

    _addToInventory(inventory, itemId, count) {
        // First try to stack with existing items
        for (let i = 0; i < inventory.slots.length; i++) {
            const slot = inventory.slots[i];
            if (slot && slot.id === itemId && slot.count < 64) {
                const space = 64 - slot.count;
                const toAdd = Math.min(space, count);
                slot.count += toAdd;
                count -= toAdd;
                if (count <= 0) return true;
            }
        }
        // Then try empty slots
        for (let i = 0; i < inventory.slots.length; i++) {
            if (!inventory.slots[i]) {
                const toAdd = Math.min(64, count);
                inventory.slots[i] = { id: itemId, count: toAdd };
                count -= toAdd;
                if (count <= 0) return true;
            }
        }
        return count <= 0; // Return false if inventory full
    }

    attemptSpawn(player, isNight) {
        if (this.entities.length >= this.maxEntities) {
            return;
        }

        const angle = Math.random() * Math.PI * 2;
        const distance = 15 + Math.random() * 15; // Spawn further away (15-30 blocks)

        const spawnX = Math.floor(player.position.x + Math.cos(angle) * distance);
        const spawnZ = Math.floor(player.position.z + Math.sin(angle) * distance);

        const spawnY = this.getSurfaceHeight(spawnX, spawnZ, player.position.y);

        if (spawnY !== null) {
            let type;
            if (isNight) {
                // Night: mostly hostile mobs, some passive
                const roll = Math.random();
                if (roll < 0.25) type = 'zombie';
                else if (roll < 0.45) type = 'skeleton';
                else if (roll < 0.60) type = 'creeper';
                else if (roll < 0.72) type = 'spider';
                else if (roll < 0.82) type = 'pig';
                else if (roll < 0.92) type = 'cow';
                else type = 'chicken';
            } else {
                // Day: only passive mobs spawn
                const roll = Math.random();
                if (roll < 0.35) type = 'pig';
                else if (roll < 0.65) type = 'cow';
                else type = 'chicken';
            }

            const position = new THREE.Vector3(spawnX + 0.5, spawnY, spawnZ + 0.5);
            try {
                const mob = new Mob(type, position, this.scene, this.world);
                this.entities.push(mob);
            } catch (e) {
                console.error("Error instantiating Mob:", e);
            }
        }
    }

    getSurfaceHeight(x, z, playerY) {
        const startY = Math.floor(playerY) + 30;

        for (let y = startY; y > playerY - 40; y--) {
            if (y < 0) break;
            const voxel = this.world.getVoxel(x, y, z);
            if (voxel > 0 && voxel !== 8 && voxel !== 42 && voxel !== 43 && voxel !== 44) {
                return y + 1;
            }
        }

        return 61;
    }
}
