import * as THREE from 'three';
import { Blocks } from '../world/BlockRegistry.js';
import { DroppedItem } from './DroppedItem.js';

// Basic boxy textured material helper
function createBoxMesh(width, height, depth, colorStr) {
    const geo = new THREE.BoxGeometry(width, height, depth);
    // Move origin to bottom center for easier placement on ground
    geo.translate(0, height / 2, 0);
    const mat = new THREE.MeshLambertMaterial({ color: colorStr });
    return new THREE.Mesh(geo, mat);
}

function createCenteredBox(w, h, d, color) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({ color });
    return new THREE.Mesh(geo, mat);
}

export class Mob {
    constructor(type, position, scene, world) {
        this.type = type;
        this.scene = scene;
        this.world = world;

        this.health = 20;
        this.speed = 2.0;
        this.attackDamage = 2;
        this.attackCooldown = 0;
        this.isDead = false;
        this.velocity = new THREE.Vector3();
        this.isGrounded = false;
        this.knockbackTimer = 0;

        // AI state
        this.actionTimer = 0;
        this.targetDirection = new THREE.Vector3();
        this.wantsToShoot = false;
        this.bowCooldown = 0;
        this.isBurning = false;
        this.fleeTimer = 0;
        this.fleeDir = new THREE.Vector3();
        this.awareness = 0;

        // Creeper-specific
        this.fuseTimer = 0;
        this.fuseTime = 1.5; // seconds before explosion
        this.isFusing = false;
        this.explosionRadius = 3;

        this.mesh = new THREE.Group();
        this.mesh.position.copy(position);

        this.buildModel();
        this.scene.add(this.mesh);
    }

    buildModel() {
        if (this.type === 'pig') {
            const pigColor = '#FFAABB';
            const body = createCenteredBox(0.8, 0.6, 1.2, pigColor);
            body.position.set(0, 0.7, 0); // center of body

            const head = createCenteredBox(0.6, 0.6, 0.6, pigColor);
            head.position.set(0, 0.9, 0.7); // forward and up

            const snout = createCenteredBox(0.3, 0.2, 0.1, '#FF8899');
            snout.position.set(0, -0.1, 0.35);
            head.add(snout);

            // Eyes
            const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const rightEye = new THREE.Mesh(eyeGeo, eyeMat); rightEye.position.set(0.2, 0.1, 0.31);
            const leftEye = new THREE.Mesh(eyeGeo, eyeMat); leftEye.position.set(-0.2, 0.1, 0.31);
            head.add(rightEye, leftEye);

            const legMat = new THREE.MeshLambertMaterial({ color: pigColor });
            const legGeo = new THREE.BoxGeometry(0.2, 0.5, 0.2);
            legGeo.translate(0, -0.25, 0); // origin top of leg

            const fl = new THREE.Mesh(legGeo, legMat); fl.position.set(-0.25, 0.5, 0.4);
            const fr = new THREE.Mesh(legGeo, legMat); fr.position.set(0.25, 0.5, 0.4);
            const bl = new THREE.Mesh(legGeo, legMat); bl.position.set(-0.25, 0.5, -0.4);
            const br = new THREE.Mesh(legGeo, legMat); br.position.set(0.25, 0.5, -0.4);

            this.model = new THREE.Group();
            this.model.add(body, head, fl, fr, bl, br);
            this.mesh.add(this.model);

            this.legs = [fl, fr, bl, br];
            this.speed = 1.5;
            this.isHostile = false;
            this.health = 10;
            this.lootTable = [{ id: Blocks.RAW_PORKCHOP, minCount: 1, maxCount: 3, chance: 1.0 }];
        } else if (this.type === 'cow') {
            const cowColor = '#442211'; // Brown
            const body = createCenteredBox(0.9, 0.8, 1.4, cowColor);
            body.position.set(0, 0.9, 0);

            const head = createCenteredBox(0.6, 0.6, 0.6, cowColor);
            head.position.set(0, 1.1, 0.8);

            // Snout/nose
            const snout = createCenteredBox(0.4, 0.3, 0.2, '#DDCCAA');
            snout.position.set(0, -0.15, 0.4);
            head.add(snout);

            const hornMat = new THREE.MeshLambertMaterial({ color: '#dddddd' });
            const hornGeo = new THREE.BoxGeometry(0.1, 0.3, 0.1);
            const lh = new THREE.Mesh(hornGeo, hornMat); lh.position.set(-0.25, 0.4, 0);
            const rh = new THREE.Mesh(hornGeo, hornMat); rh.position.set(0.25, 0.4, 0);
            head.add(lh, rh);

            const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const rightEye = new THREE.Mesh(eyeGeo, eyeMat); rightEye.position.set(0.2, 0.1, 0.31);
            const leftEye = new THREE.Mesh(eyeGeo, eyeMat); leftEye.position.set(-0.2, 0.1, 0.31);
            head.add(rightEye, leftEye);

            const legMat = new THREE.MeshLambertMaterial({ color: cowColor });
            const legGeo = new THREE.BoxGeometry(0.25, 0.6, 0.25);
            legGeo.translate(0, -0.3, 0);

            const fl = new THREE.Mesh(legGeo, legMat); fl.position.set(-0.3, 0.6, 0.5);
            const fr = new THREE.Mesh(legGeo, legMat); fr.position.set(0.3, 0.6, 0.5);
            const bl = new THREE.Mesh(legGeo, legMat); bl.position.set(-0.3, 0.6, -0.5);
            const br = new THREE.Mesh(legGeo, legMat); br.position.set(0.3, 0.6, -0.5);

            this.model = new THREE.Group();
            this.model.add(body, head, fl, fr, bl, br);
            this.mesh.add(this.model);

            this.legs = [fl, fr, bl, br];
            this.speed = 1.0;
            this.isHostile = false;
            this.health = 15;
            this.lootTable = [{ id: Blocks.RAW_BEEF, minCount: 1, maxCount: 3, chance: 1.0 }];
        } else if (this.type === 'zombie') {
            const skinColor = '#228B22'; // Green
            const shirtColor = '#00BFFF'; // Blue shirt
            const pantsColor = '#4B0082'; // Purple pants

            const head = createCenteredBox(0.5, 0.5, 0.5, skinColor);
            head.position.set(0, 1.6, 0);

            const body = createCenteredBox(0.5, 0.75, 0.25, shirtColor);
            body.position.set(0, 1.0, 0);

            const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const rightEye = new THREE.Mesh(eyeGeo, eyeMat); rightEye.position.set(0.15, 0, 0.26);
            const leftEye = new THREE.Mesh(eyeGeo, eyeMat); leftEye.position.set(-0.15, 0, 0.26);
            head.add(rightEye, leftEye);

            const armGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
            armGeo.translate(0, -0.25, 0); // origin shoulder
            const armMat = new THREE.MeshLambertMaterial({ color: skinColor }); // skin arms

            const la = new THREE.Mesh(armGeo, armMat); la.position.set(-0.4, 1.3, 0); la.rotation.x = -Math.PI / 2 + 0.2; // arms forward
            const ra = new THREE.Mesh(armGeo, armMat); ra.position.set(0.4, 1.3, 0); ra.rotation.x = -Math.PI / 2 - 0.2;

            const legGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
            legGeo.translate(0, -0.375, 0); // origin hip
            const legMat = new THREE.MeshLambertMaterial({ color: pantsColor });

            const ll = new THREE.Mesh(legGeo, legMat); ll.position.set(-0.125, 0.75, 0);
            const rl = new THREE.Mesh(legGeo, legMat); rl.position.set(0.125, 0.75, 0);

            this.model = new THREE.Group();
            this.model.add(head, body, la, ra, ll, rl);
            this.mesh.add(this.model);

            this.legs = [ll, rl];
            // I'll also wiggle the arms later!
            this.arms = [la, ra];
            this.speed = 2.5;
            this.isHostile = true;
            this.health = 20;
            this.lootTable = [{ id: Blocks.IRON_ORE, minCount: 0, maxCount: 1, chance: 0.5 }];
        } else if (this.type === 'skeleton') {
            const boneColor = '#DDDDDD'; // light gray

            const head = createCenteredBox(0.4, 0.4, 0.4, boneColor);
            head.position.set(0, 1.6, 0);

            const body = createCenteredBox(0.4, 0.6, 0.2, boneColor);
            body.position.set(0, 1.1, 0);

            const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const rightEye = new THREE.Mesh(eyeGeo, eyeMat); rightEye.position.set(0.1, 0, 0.21);
            const leftEye = new THREE.Mesh(eyeGeo, eyeMat); leftEye.position.set(-0.1, 0, 0.21);
            head.add(rightEye, leftEye);

            const limbGeo = new THREE.BoxGeometry(0.15, 0.75, 0.15);
            limbGeo.translate(0, -0.375, 0);
            const limbMat = new THREE.MeshLambertMaterial({ color: boneColor });

            const la = new THREE.Mesh(limbGeo, limbMat); la.position.set(-0.3, 1.3, 0); la.rotation.x = -Math.PI / 2 + 0.1;
            const ra = new THREE.Mesh(limbGeo, limbMat); ra.position.set(0.3, 1.3, 0); ra.rotation.x = -Math.PI / 2 - 0.1;

            const ll = new THREE.Mesh(limbGeo, limbMat); ll.position.set(-0.1, 0.75, 0);
            const rl = new THREE.Mesh(limbGeo, limbMat); rl.position.set(0.1, 0.75, 0);

            this.model = new THREE.Group();
            this.model.add(head, body, la, ra, ll, rl);
            this.mesh.add(this.model);

            this.legs = [ll, rl];
            this.arms = [la, ra];
            this.speed = 3.0;
            this.isHostile = true;
            this.health = 20;
            this.lootTable = [
                { id: Blocks.COBBLESTONE, minCount: 0, maxCount: 2, chance: 0.7 },
                { id: Blocks.STICK, minCount: 0, maxCount: 1, chance: 0.5 },
            ];
        } else if (this.type === 'creeper') {
            const creeperGreen = '#00AA00';
            const darkGreen = '#006600';

            const head = createCenteredBox(0.5, 0.5, 0.5, creeperGreen);
            head.position.set(0, 1.4, 0);

            // Creeper face: dark patches for eyes and mouth
            const eyeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.05);
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const re = new THREE.Mesh(eyeGeo, eyeMat); re.position.set(0.12, 0.05, 0.26);
            const le = new THREE.Mesh(eyeGeo, eyeMat); le.position.set(-0.12, 0.05, 0.26);
            const mouthTall = new THREE.BoxGeometry(0.1, 0.15, 0.05);
            const mouth = new THREE.Mesh(mouthTall, eyeMat); mouth.position.set(0, -0.12, 0.26);
            head.add(re, le, mouth);

            const body = createCenteredBox(0.4, 0.7, 0.35, creeperGreen);
            body.position.set(0, 0.85, 0);

            // 4 short stubby legs (no arms for creeper)
            const legMat = new THREE.MeshLambertMaterial({ color: darkGreen });
            const legGeo = new THREE.BoxGeometry(0.2, 0.5, 0.2);
            legGeo.translate(0, -0.25, 0);

            const fl = new THREE.Mesh(legGeo, legMat); fl.position.set(-0.15, 0.5, 0.1);
            const fr = new THREE.Mesh(legGeo, legMat); fr.position.set(0.15, 0.5, 0.1);
            const bl = new THREE.Mesh(legGeo, legMat); bl.position.set(-0.15, 0.5, -0.1);
            const br = new THREE.Mesh(legGeo, legMat); br.position.set(0.15, 0.5, -0.1);

            this.model = new THREE.Group();
            this.model.add(head, body, fl, fr, bl, br);
            this.mesh.add(this.model);

            this.legs = [fl, fr, bl, br];
            this.speed = 1.8;
            this.isHostile = true;
            this.health = 20;
            this.lootTable = [{ id: Blocks.TNT || Blocks.COBBLESTONE, minCount: 0, maxCount: 1, chance: 0.3 }];

        } else if (this.type === 'spider') {
            const spiderColor = '#333333';
            const eyeColor = '#FF0000';

            // Flat wide body
            const body = createCenteredBox(0.8, 0.4, 1.0, spiderColor);
            body.position.set(0, 0.5, 0);

            const head = createCenteredBox(0.6, 0.4, 0.5, '#444444');
            head.position.set(0, 0.5, 0.6);

            // Red eyes (multiple)
            const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.05);
            const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });
            for (let i = 0; i < 4; i++) {
                const ox = (i - 1.5) * 0.12;
                const oy = 0.05 + (i % 2) * 0.08;
                const eye = new THREE.Mesh(eyeGeo, eyeMat);
                eye.position.set(ox, oy, 0.26);
                head.add(eye);
            }

            // 8 legs (4 per side)
            const legMat = new THREE.MeshLambertMaterial({ color: spiderColor });
            const spiderLegs = [];
            for (let side = -1; side <= 1; side += 2) {
                for (let i = 0; i < 4; i++) {
                    const legGeo = new THREE.BoxGeometry(0.08, 0.08, 0.6);
                    const leg = new THREE.Mesh(legGeo, legMat);
                    leg.position.set(side * 0.5, 0.3, 0.3 - i * 0.25);
                    leg.rotation.x = Math.PI * 0.15;
                    leg.rotation.z = side * Math.PI * 0.3;
                    spiderLegs.push(leg);
                }
            }

            this.model = new THREE.Group();
            this.model.add(body, head, ...spiderLegs);
            this.mesh.add(this.model);

            this.legs = spiderLegs;
            this.speed = 4.0; // Fast!
            this.isHostile = true; // changes to passive in daytime (handled in updateAI)
            this.nightOnly = true;
            this.health = 16;
            this.attackDamage = 3;
            this.lootTable = [
                { id: Blocks.COBBLESTONE, minCount: 0, maxCount: 2, chance: 0.6 },
            ];

        } else if (this.type === 'chicken') {
            const chickenColor = '#EEEEEE';
            const beakColor = '#FF8800';
            const combColor = '#FF2222';

            const body = createCenteredBox(0.4, 0.35, 0.5, chickenColor);
            body.position.set(0, 0.4, 0);

            const head = createCenteredBox(0.25, 0.25, 0.25, chickenColor);
            head.position.set(0, 0.7, 0.25);

            const beak = createCenteredBox(0.1, 0.08, 0.12, beakColor);
            beak.position.set(0, -0.05, 0.18);
            head.add(beak);

            const comb = createCenteredBox(0.08, 0.1, 0.06, combColor);
            comb.position.set(0, 0.15, 0.05);
            head.add(comb);

            // Eyes
            const eyeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.03);
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
            const re = new THREE.Mesh(eyeGeo, eyeMat); re.position.set(0.1, 0.02, 0.13);
            const le = new THREE.Mesh(eyeGeo, eyeMat); le.position.set(-0.1, 0.02, 0.13);
            head.add(re, le);

            // Short legs
            const legMat = new THREE.MeshLambertMaterial({ color: beakColor });
            const legGeo = new THREE.BoxGeometry(0.06, 0.25, 0.06);
            legGeo.translate(0, -0.125, 0);
            const ll = new THREE.Mesh(legGeo, legMat); ll.position.set(-0.1, 0.25, 0);
            const rl = new THREE.Mesh(legGeo, legMat); rl.position.set(0.1, 0.25, 0);

            // Small tail
            const tail = createCenteredBox(0.15, 0.2, 0.1, chickenColor);
            tail.position.set(0, 0.55, -0.3);
            tail.rotation.x = -0.3;

            this.model = new THREE.Group();
            this.model.add(body, head, ll, rl, tail);
            this.mesh.add(this.model);

            this.legs = [ll, rl];
            this.speed = 1.2;
            this.isHostile = false;
            this.health = 4;
            this.lootTable = [
                { id: Blocks.STICK, minCount: 0, maxCount: 2, chance: 0.8 },
            ];

        } else {
            const body = createBoxMesh(1, 1, 1, '#ffffff');
            this.model = new THREE.Group();
            this.model.add(body);
            this.mesh.add(this.model);
        }

        // Bounding box for collisions
        const box = new THREE.Box3().setFromObject(this.model);
        this.width = box.max.x - box.min.x;
        this.height = box.max.y - box.min.y;
        this.depth = box.max.z - box.min.z;

        // Apply visual red overlay if taking damage logic (see takeDamage)
        this.materials = [];
        this.model.traverse(child => {
            if (child.isMesh) {
                this.materials.push(child.material);
            }
        });
    }

    update(dt, player, entities) {
        this.updateAI(dt, player.position);
        this.applyPhysics(dt, player, entities);

        // Only rotate if not knocked back and moving intentionally
        if (this.knockbackTimer <= 0 && (Math.abs(this.velocity.x) > 0.1 || Math.abs(this.velocity.z) > 0.1)) {
            const angle = Math.atan2(this.velocity.x, this.velocity.z);
            this.mesh.rotation.y = angle;
        }

        // Animate legs
        const speedSq = this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z;
        if (speedSq > 0.1 && this.isGrounded) {
            this.animTime = (this.animTime || 0) + dt * this.speed * 2;
            const swing = Math.sin(this.animTime) * 0.5;
            if (this.legs && this.legs.length === 4) { // quadruped
                this.legs[0].rotation.x = swing; // FL
                this.legs[1].rotation.x = -swing; // FR
                this.legs[2].rotation.x = -swing; // BL
                this.legs[3].rotation.x = swing; // BR
            } else if (this.legs && this.legs.length === 2) { // biped
                this.legs[0].rotation.x = swing;
                this.legs[1].rotation.x = -swing;
            }
        } else {
            // reset rotation
            if (this.legs) {
                for (let leg of this.legs) leg.rotation.x = 0;
            }
        }
    }

    hasLineOfSight(targetPos) {
        // Simple raycast from mob eye level to player — check every 0.5 blocks
        const start = this.mesh.position.clone();
        start.y += this.height * 0.8; // Eye level
        const dir = new THREE.Vector3().subVectors(targetPos, start);
        const dist = dir.length();
        dir.normalize();

        const step = 0.5;
        for (let d = step; d < dist; d += step) {
            const px = Math.floor(start.x + dir.x * d);
            const py = Math.floor(start.y + dir.y * d);
            const pz = Math.floor(start.z + dir.z * d);
            const v = this.world.getVoxel(px, py, pz);
            if (v > 0 && v !== 8 && v !== 42 && v !== 43 && v !== 44) { // Solid, not water/grass/flowers
                return false;
            }
        }
        return true;
    }

    updateAI(dt, playerPos) {
        if (this.knockbackTimer > 0) {
            this.knockbackTimer -= dt;
            this.velocity.x *= 0.9;
            this.velocity.z *= 0.9;
            return;
        }

        this.actionTimer -= dt;
        if (this.attackCooldown > 0) this.attackCooldown -= dt;
        if (this.bowCooldown > 0) this.bowCooldown -= dt;

        // Passive mobs: flee when hit
        if (!this.isHostile && this.fleeTimer > 0) {
            this.fleeTimer -= dt;
            this.velocity.x = this.fleeDir.x * this.speed * 2;
            this.velocity.z = this.fleeDir.z * this.speed * 2;
            // Auto-jump while fleeing
            if (this.isGrounded) {
                const moveDir = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).normalize();
                if (this.checkCollisionAhead(moveDir)) {
                    this.velocity.y = 8;
                }
            }
            return;
        }

        if (this.isHostile) {
            const dx = playerPos.x - this.mesh.position.x;
            const dz = playerPos.z - this.mesh.position.z;
            const dy = playerPos.y - this.mesh.position.y;
            const distSq = dx * dx + dz * dz;
            const dist = Math.sqrt(distSq);
            const yDist = Math.abs(dy);

            // Only engage if player is within 2.5 blocks vertically
            if (yDist > 2.5) {
                // Player is too far above/below — wander instead
            } else if (dist < 16) {
                // Check line of sight
                const canSee = this.hasLineOfSight(playerPos);

                if (canSee) {
                    // Build awareness over time
                    this.awareness = Math.min(1, this.awareness + dt * 2);
                } else {
                    this.awareness = Math.max(0, this.awareness - dt * 0.5);
                }

                if (this.awareness > 0.3) {
                    // Face player
                    this.mesh.rotation.y = Math.atan2(dx, dz);

                    if (this.type === 'skeleton') {
                        // SKELETON: Ranged attacker — keep distance and shoot
                        if (dist < 5) {
                            const awayDir = new THREE.Vector3(-dx, 0, -dz).normalize();
                            this.velocity.x = awayDir.x * this.speed;
                            this.velocity.z = awayDir.z * this.speed;
                        } else if (dist < 15 && canSee) {
                            this.velocity.x = 0;
                            this.velocity.z = 0;
                            if (this.bowCooldown <= 0) {
                                this.wantsToShoot = true;
                                this.bowCooldown = 2.0;
                            }
                        } else {
                            const dir = new THREE.Vector3(dx, 0, dz).normalize();
                            this.velocity.x = dir.x * this.speed;
                            this.velocity.z = dir.z * this.speed;
                        }
                        if (this.isGrounded && Math.abs(this.velocity.x) + Math.abs(this.velocity.z) > 0) {
                            const moveDir = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).normalize();
                            if (this.checkCollisionAhead(moveDir)) {
                                this.velocity.y = 8;
                            }
                        }
                        return;

                    } else if (this.type === 'creeper') {
                        // CREEPER: Approach and fuse when close
                        if (dist < 2.5) {
                            // Start fuse!
                            this.velocity.x = 0;
                            this.velocity.z = 0;
                            if (!this.isFusing) {
                                this.isFusing = true;
                                this.fuseTimer = 0;
                            }
                            this.fuseTimer += dt;

                            // Flash white as fuse progresses
                            const fuseProgress = this.fuseTimer / this.fuseTime;
                            if (this.materials) {
                                const flashIntensity = Math.sin(fuseProgress * Math.PI * 8) > 0;
                                this.materials.forEach(mat => {
                                    if (flashIntensity) {
                                        mat.emissive = mat.emissive || new THREE.Color();
                                        mat.emissive.setHex(0xffffff);
                                        mat.emissiveIntensity = fuseProgress * 0.8;
                                    } else {
                                        if (mat.emissive) mat.emissiveIntensity = 0;
                                    }
                                });
                            }

                            // Scale up slightly as fuse progresses
                            const scale = 1 + fuseProgress * 0.2;
                            this.model.scale.set(scale, scale, scale);

                            if (this.fuseTimer >= this.fuseTime) {
                                this.explode();
                                return;
                            }
                            return;
                        } else {
                            // Cancel fuse if player walks away
                            if (this.isFusing) {
                                this.isFusing = false;
                                this.fuseTimer = 0;
                                this.model.scale.set(1, 1, 1);
                                if (this.materials) {
                                    this.materials.forEach(mat => {
                                        if (mat.emissive) mat.emissiveIntensity = 0;
                                    });
                                }
                            }
                            // Chase player
                            const dir = new THREE.Vector3(dx, 0, dz).normalize();
                            this.velocity.x = dir.x * this.speed;
                            this.velocity.z = dir.z * this.speed;
                            if (this.isGrounded && this.checkCollisionAhead(dir)) {
                                this.velocity.y = 8;
                            }
                            return;
                        }

                    } else if (this.type === 'spider') {
                        // SPIDER: Fast chase melee (only hostile at night or if provoked)
                        if (dist < 1.5) {
                            this.velocity.x = 0;
                            this.velocity.z = 0;
                            if (this.attackCooldown <= 0) {
                                window.dispatchEvent(new CustomEvent('mob-attack', {
                                    detail: { damage: this.attackDamage, mob: this }
                                }));
                                this.attackCooldown = 0.7; // Faster attacks
                            }
                            return;
                        } else {
                            const dir = new THREE.Vector3(dx, 0, dz).normalize();
                            this.velocity.x = dir.x * this.speed;
                            this.velocity.z = dir.z * this.speed;
                            if (this.isGrounded && this.checkCollisionAhead(dir)) {
                                this.velocity.y = 10; // Higher jump (climber)
                            }
                            return;
                        }

                    } else {
                        // ZOMBIE: Melee attacker
                        if (dist < 1.7) {
                            this.velocity.x = 0;
                            this.velocity.z = 0;
                            if (this.attackCooldown <= 0) {
                                window.dispatchEvent(new CustomEvent('mob-attack', { detail: { damage: this.attackDamage, mob: this } }));
                                this.attackCooldown = 1.0;
                            }
                            return;
                        } else {
                            const dir = new THREE.Vector3(dx, 0, dz).normalize();
                            this.velocity.x = dir.x * this.speed;
                            this.velocity.z = dir.z * this.speed;
                            if (this.isGrounded && this.checkCollisionAhead(dir)) {
                                this.velocity.y = 8;
                            }
                            return;
                        }
                    }
                }
            } else {
                // Player far away — lose awareness
                this.awareness = Math.max(0, this.awareness - dt * 1.0);
            }
        }

        // Passive or Idle Hostile: Wander randomly
        if (this.actionTimer <= 0) {
            const action = Math.random();
            if (action < 0.3) {
                this.velocity.x = 0;
                this.velocity.z = 0;
            } else {
                const angle = Math.random() * Math.PI * 2;
                this.targetDirection.set(Math.sin(angle), 0, Math.cos(angle));
                this.velocity.x = this.targetDirection.x * this.speed;
                this.velocity.z = this.targetDirection.z * this.speed;
            }
            this.actionTimer = 1 + Math.random() * 3;
        }

        // Auto-jump while wandering
        if (this.isGrounded && Math.abs(this.velocity.x) + Math.abs(this.velocity.z) > 0) {
            const moveDir = new THREE.Vector3(this.velocity.x, 0, this.velocity.z).normalize();
            if (this.checkCollisionAhead(moveDir)) {
                this.velocity.y = 8;
            }
        }
    }

    checkCollisionAhead(dir) {
        // Look 1 block ahead at feet level
        const nextX = this.mesh.position.x + dir.x;
        const nextZ = this.mesh.position.z + dir.z;
        const blockAhead = this.world.getVoxel(Math.floor(nextX), Math.floor(this.mesh.position.y), Math.floor(nextZ));
        return (blockAhead !== 0); // If not air, there's a wall
    }

    applyPhysics(dt, player, entities) {
        // Gravity
        this.velocity.y -= 25 * dt; // Gravity acc

        // Calculate potential new position
        const nextPos = this.mesh.position.clone();

        // Y-axis collision
        nextPos.y += this.velocity.y * dt;
        if (this.checkCollision(nextPos, player, entities)) {
            if (this.velocity.y < 0) {
                this.isGrounded = true;
                this.velocity.y = 0;
                // Snap to top of block
                nextPos.y = Math.floor(nextPos.y) + 1;
            } else {
                this.velocity.y = 0; // Hit ceiling
                nextPos.y = this.mesh.position.y;
            }
        } else {
            this.isGrounded = false;
        }
        this.mesh.position.y = nextPos.y;

        // X-axis collision
        nextPos.copy(this.mesh.position);
        nextPos.x += this.velocity.x * dt;
        if (this.checkCollision(nextPos, player, entities)) {
            nextPos.x = this.mesh.position.x; // Block movement
        }
        this.mesh.position.x = nextPos.x;

        // Z-axis collision
        nextPos.copy(this.mesh.position);
        nextPos.z += this.velocity.z * dt;
        if (this.checkCollision(nextPos, player, entities)) {
            nextPos.z = this.mesh.position.z;
        }
        this.mesh.position.z = nextPos.z;
    }

    checkCollision(pos, player, entities) {
        // VERY simplified AABB collision against voxels for mobs
        // Check standard 4 corners at foot level and head level
        const minX = Math.floor(pos.x - this.width / 2);
        const maxX = Math.floor(pos.x + this.width / 2);
        const minY = Math.floor(pos.y);
        const maxY = Math.floor(pos.y + this.height - 0.1);
        const minZ = Math.floor(pos.z - this.depth / 2);
        const maxZ = Math.floor(pos.z + this.depth / 2);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const voxel = this.world.getVoxel(x, y, z);
                    // Standard solid blocks are > 0. (Needs refinement if adding water)
                    if (voxel > 0) {
                        return true;
                    }
                }
            }
        }

        // Player collision
        if (player) {
            const pMinX = player.position.x - player.radius;
            const pMaxX = player.position.x + player.radius;
            const pMinY = player.position.y - player.height;
            const pMaxY = player.position.y + 0.1;
            const pMinZ = player.position.z - player.radius;
            const pMaxZ = player.position.z + player.radius;

            if (pos.x + this.width / 2 > pMinX && pos.x - this.width / 2 < pMaxX &&
                pos.y + this.height > pMinY && pos.y < pMaxY &&
                pos.z + this.depth / 2 > pMinZ && pos.z - this.depth / 2 < pMaxZ) {
                return true;
            }
        }

        // Other mob collision
        if (entities) {
            for (const other of entities) {
                if (other === this) continue;
                const oMinX = other.mesh.position.x - other.width / 2;
                const oMaxX = other.mesh.position.x + other.width / 2;
                const oMinY = other.mesh.position.y;
                const oMaxY = other.mesh.position.y + other.height;
                const oMinZ = other.mesh.position.z - other.depth / 2;
                const oMaxZ = other.mesh.position.z + other.depth / 2;

                if (pos.x + this.width / 2 > oMinX && pos.x - this.width / 2 < oMaxX &&
                    pos.y + this.height > oMinY && pos.y < oMaxY &&
                    pos.z + this.depth / 2 > oMinZ && pos.z - this.depth / 2 < oMaxZ) {
                    return true;
                }
            }
        }

        return false;
    }

    takeDamage(amount) {
        this.health -= amount;

        // Passive mobs flee when hit
        if (!this.isHostile) {
            this.fleeTimer = 3.0; // Flee for 3 seconds
            // Run away from the damage source (approximate: away from player direction)
            const angle = Math.random() * Math.PI * 2;
            this.fleeDir.set(Math.sin(angle), 0, Math.cos(angle));
        }

        // Flash red
        if (this.materials) {
            const originalColors = this.materials.map(mat => mat.color.getHex());
            this.materials.forEach(mat => mat.color.setHex(0xff0000));
            setTimeout(() => {
                if (this.isDead) return;
                this.materials.forEach((mat, i) => mat.color.setHex(originalColors[i]));
            }, 200);
        }

        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        // Spawn drops
        if (this.lootTable) {
            for (const drop of this.lootTable) {
                if (Math.random() < drop.chance) {
                    const count = drop.minCount + Math.floor(Math.random() * (drop.maxCount - drop.minCount + 1));
                    if (count > 0) {
                        const droppedItem = new DroppedItem(
                            drop.id,
                            count,
                            this.mesh.position.clone(),
                            this.scene,
                            this.world
                        );
                        window.dispatchEvent(new CustomEvent('item-dropped', { detail: { item: droppedItem } }));
                    }
                }
            }
        }

        this.scene.remove(this.mesh);
        this.isDead = true;
    }

    explode() {
        // Creeper explosion: destroy blocks in radius and damage player
        const pos = this.mesh.position;
        const radius = this.explosionRadius;

        // Destroy blocks in sphere
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    if (dx * dx + dy * dy + dz * dz <= radius * radius) {
                        const bx = Math.floor(pos.x) + dx;
                        const by = Math.floor(pos.y) + dy;
                        const bz = Math.floor(pos.z) + dz;
                        const existing = this.world.getVoxel(bx, by, bz);
                        if (existing > 0 && existing !== 7) { // Don't destroy bedrock
                            this.world.setVoxel(bx, by, bz, 0, false, true);
                        }
                    }
                }
            }
        }

        // Signal to update chunk meshes around the explosion
        window.dispatchEvent(new CustomEvent('creeper-explosion', {
            detail: {
                x: Math.floor(pos.x),
                y: Math.floor(pos.y),
                z: Math.floor(pos.z),
                radius: radius,
                damage: 12 // Explosion damage to player
            }
        }));

        this.scene.remove(this.mesh);
        this.isDead = true;
    }
}
