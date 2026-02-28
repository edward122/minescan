import * as THREE from 'three';

export class SkyManager {
    constructor(scene) {
        this.scene = scene;

        // Time variables
        // A full Minecraft day is 20 minutes (1200 seconds)
        this.dayDuration = 1200;
        this.time = 0; // Time in seconds, 0 = sunrise

        // Lighting
        this.ambientLight = new THREE.HemisphereLight(0x87CEEB, 0x444444, 0.8);
        this.scene.add(this.ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffffee, 0.8);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 512;
        this.sunLight.shadow.mapSize.height = 512;
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 400;
        this.sunLight.shadow.camera.left = -100;
        this.sunLight.shadow.camera.right = 100;
        this.sunLight.shadow.camera.top = 100;
        this.sunLight.shadow.camera.bottom = -100;
        this.sunLight.shadow.bias = -0.0005; // Prevent shadow acne
        this.scene.add(this.sunLight);

        this.moonLight = new THREE.DirectionalLight(0x88bbff, 0.25);
        this.moonLight.castShadow = false; // Moon is too faint to justify shadow passes
        this.scene.add(this.moonLight);

        // Colors for sky gradients
        this.colors = {
            day: new THREE.Color(0x6aa6cc), // Warmer/icier blue
            dusk: new THREE.Color(0xf27649), // Richer orange/red
            night: new THREE.Color(0x05051a), // Deeper dark blue
            dawn: new THREE.Color(0xe89eb3), // Vibrant pink/orange
        };

        this.scene.background = this.colors.day.clone();

        // Pre-allocated color for sky interpolation (avoids per-frame allocation)
        this._skyColor = new THREE.Color();

        this.createCelestialBodies();
        this.createStars();
        this.createClouds();
    }

    createCelestialBodies() {
        const createTexture = (isSun) => {
            const size = 16;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            if (isSun) {
                ctx.fillStyle = '#ffdd00'; // Bright sun
                ctx.fillRect(2, 2, 12, 12);
                ctx.fillStyle = '#ffffff'; // Hot center
                ctx.fillRect(4, 4, 8, 8);
            } else {
                ctx.fillStyle = '#dddddd'; // Moon base
                ctx.fillRect(2, 2, 12, 12);
                ctx.fillStyle = '#aaaaaa'; // Craters
                ctx.fillRect(4, 4, 3, 3);
                ctx.fillRect(9, 3, 2, 2);
                ctx.fillRect(10, 8, 3, 3);
                ctx.fillRect(4, 10, 2, 2);
                ctx.fillStyle = '#ffffff'; // Highlight edge
                ctx.fillRect(2, 2, 12, 1);
                ctx.fillRect(2, 2, 1, 12);
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            return tex;
        };

        const sunMat = new THREE.SpriteMaterial({ map: createTexture(true), color: 0xffffff });
        this.sunSprite = new THREE.Sprite(sunMat);
        this.sunSprite.scale.set(60, 60, 1);
        this.scene.add(this.sunSprite);

        const moonMat = new THREE.SpriteMaterial({ map: createTexture(false), color: 0xffffff });
        this.moonSprite = new THREE.Sprite(moonMat);
        this.moonSprite.scale.set(40, 40, 1);
        this.scene.add(this.moonSprite);
    }

    createStars() {
        const starCount = 200;
        const positions = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 0.8 + 0.2); // Upper hemisphere bias
            const r = 350;
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.starMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 2,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0,
        });
        this.stars = new THREE.Points(starGeo, this.starMaterial);
        this.scene.add(this.stars);
    }

    createClouds() {
        // Merge all clouds into a single geometry to minimize draw calls
        const cloudMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.7,
        });

        const geometries = [];
        const _tempMatrix = new THREE.Matrix4();

        for (let i = 0; i < 30; i++) {
            const cx = (Math.random() - 0.5) * 400;
            const cz = (Math.random() - 0.5) * 400;

            const numBlobs = 3 + Math.floor(Math.random() * 4);
            for (let j = 0; j < numBlobs; j++) {
                const w = 8 + Math.random() * 15;
                const h = 2 + Math.random() * 2;
                const d = 6 + Math.random() * 10;
                const geo = new THREE.BoxGeometry(w, h, d);

                _tempMatrix.makeTranslation(
                    cx + (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 2,
                    cz + (Math.random() - 0.5) * 8
                );
                geo.applyMatrix4(_tempMatrix);
                geometries.push(geo);
            }
        }

        // Merge all geometries into one
        const mergedGeo = THREE.BufferGeometryUtils
            ? THREE.BufferGeometryUtils.mergeGeometries(geometries)
            : this._mergeGeometries(geometries);

        for (const g of geometries) g.dispose();

        const cloudMesh = new THREE.Mesh(mergedGeo, cloudMat);
        cloudMesh.frustumCulled = false;

        this.cloudGroup = new THREE.Group();
        this.cloudGroup.position.y = 150;
        this.cloudGroup.add(cloudMesh);
        this.scene.add(this.cloudGroup);
    }

    // Simple geometry merge fallback if BufferGeometryUtils not available
    _mergeGeometries(geometries) {
        let totalVerts = 0, totalIndices = 0;
        for (const g of geometries) {
            totalVerts += g.getAttribute('position').count;
            totalIndices += g.index ? g.index.count : g.getAttribute('position').count;
        }

        const positions = new Float32Array(totalVerts * 3);
        const normals = new Float32Array(totalVerts * 3);
        const indices = new Uint32Array(totalIndices);
        let vertOffset = 0, idxOffset = 0, vertCount = 0;

        for (const g of geometries) {
            const pos = g.getAttribute('position');
            const norm = g.getAttribute('normal');
            const idx = g.index;

            for (let i = 0; i < pos.count * 3; i++) {
                positions[vertOffset * 3 + i] = pos.array[i];
                normals[vertOffset * 3 + i] = norm.array[i];
            }

            if (idx) {
                for (let i = 0; i < idx.count; i++) {
                    indices[idxOffset + i] = idx.array[i] + vertOffset;
                }
                idxOffset += idx.count;
            }
            vertOffset += pos.count;
        }

        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        merged.setIndex(new THREE.BufferAttribute(indices, 1));
        return merged;
    }

    isNight() {
        const p = this.time / this.dayDuration;
        return p > 0.45 && p < 0.95;
    }

    getTimeProgress() {
        return this.time / this.dayDuration;
    }

    update(dt, playerX = 0, playerZ = 0) {
        this.time += dt;
        if (this.time >= this.dayDuration) {
            this.time -= this.dayDuration;
        }

        const progress = this.time / this.dayDuration;
        const angle = (progress * 2 * Math.PI) - (Math.PI / 2);
        const orbitRadius = 400;

        const xPos = playerX + Math.cos(angle) * orbitRadius;
        const yPos = Math.sin(angle) * orbitRadius;
        const zPos = playerZ + 50;

        this.sunLight.position.set(xPos, yPos, zPos);
        this.sunLight.target.position.set(playerX, 0, playerZ);
        this.sunLight.target.updateMatrixWorld();
        this.sunSprite.position.set(xPos, yPos, zPos);

        this.moonLight.position.set(playerX - Math.cos(angle) * orbitRadius, -yPos, playerZ - 50);
        this.moonLight.target.position.set(playerX, 0, playerZ);
        this.moonLight.target.updateMatrixWorld();
        this.moonSprite.position.set(playerX - Math.cos(angle) * orbitRadius, -yPos, playerZ - 50);

        const sunHeight = Math.sin(angle);
        this.sunLight.intensity = Math.max(0, sunHeight) * 0.8;
        this.moonLight.intensity = Math.max(0, -sunHeight) * 0.3;

        const ambientMin = 0.35;
        const ambientMax = 0.75;
        const ambientFactor = (sunHeight + 1) / 2;
        this.ambientLight.intensity = ambientMin + (ambientMax - ambientMin) * ambientFactor;

        this.updateSkyColor(progress);

        // Stars: visible at night
        if (progress > 0.45 && progress < 0.95) {
            let starOpacity = 0;
            if (progress < 0.55) {
                starOpacity = (progress - 0.45) / 0.1;
            } else if (progress > 0.85) {
                starOpacity = (0.95 - progress) / 0.1;
            } else {
                starOpacity = 1;
            }
            this.starMaterial.opacity = starOpacity * 0.8;
        } else {
            this.starMaterial.opacity = 0;
        }

        // Drift clouds
        this.cloudGroup.position.x += dt * 1.5;
        if (this.cloudGroup.position.x > 200) {
            this.cloudGroup.position.x -= 400;
        }
    }

    updateSkyColor(progress) {
        const c = this._skyColor;

        if (progress < 0.1) {
            const t = progress / 0.1;
            c.copy(this.colors.dawn).lerp(this.colors.day, t);
        } else if (progress < 0.4) {
            c.copy(this.colors.day);
        } else if (progress < 0.5) {
            const t = (progress - 0.4) / 0.1;
            c.copy(this.colors.day).lerp(this.colors.dusk, t);
        } else if (progress < 0.6) {
            const t = (progress - 0.5) / 0.1;
            c.copy(this.colors.dusk).lerp(this.colors.night, t);
        } else if (progress < 0.9) {
            c.copy(this.colors.night);
        } else {
            const t = (progress - 0.9) / 0.1;
            c.copy(this.colors.night).lerp(this.colors.dawn, t);
        }

        this.scene.background.copy(c);
    }
}
