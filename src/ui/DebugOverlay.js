export class DebugOverlay {
    constructor() {
        this.overlay = document.getElementById('debug-overlay');
        this.fpsElement = document.getElementById('debug-fps');
        this.xyzElement = document.getElementById('debug-xyz');
        this.chunkElement = document.getElementById('debug-chunk');
        this.facingElement = document.getElementById('debug-facing');

        this.isVisible = false;

        // FPS calculation
        this.frames = 0;
        this.lastTime = performance.now();
        this.fps = 0;

        this.initKeyListener();
    }

    initKeyListener() {
        window.addEventListener('keydown', (e) => {
            // F3 key (key code 114)
            if (e.code === 'F3') {
                e.preventDefault(); // Prevent default browser search behavior
                this.toggle();
            }
        });
    }

    toggle() {
        this.isVisible = !this.isVisible;
        if (this.isVisible) {
            this.overlay.classList.remove('hidden');
        } else {
            this.overlay.classList.add('hidden');
        }
    }

    update(player, world, camera) {
        if (!this.isVisible) return;

        // Calculate FPS
        this.frames++;
        const now = performance.now();
        if (now >= this.lastTime + 1000) {
            this.fps = Math.round((this.frames * 1000) / (now - this.lastTime));
            this.frames = 0;
            this.lastTime = now;
            this.fpsElement.textContent = this.fps;
        }

        // Update Position
        const px = player.position.x.toFixed(2);
        const py = player.position.y.toFixed(2);
        const pz = player.position.z.toFixed(2);
        this.xyzElement.textContent = `${px} / ${py} / ${pz}`;

        // Update Chunk
        const coords = world.computeChunkCoordinates(player.position.x, player.position.y, player.position.z);
        this.chunkElement.textContent = `${coords.chunkX} / ${coords.chunkY} / ${coords.chunkZ}`;

        // Update Facing
        const rotY = player.rotation.y % (Math.PI * 2);
        let normalizedRot = rotY;
        if (normalizedRot < 0) normalizedRot += Math.PI * 2;

        let facing = "Unknown";
        if (normalizedRot >= Math.PI * 1.75 || normalizedRot < Math.PI * 0.25) facing = "South (+Z)";
        else if (normalizedRot >= Math.PI * 0.25 && normalizedRot < Math.PI * 0.75) facing = "West (+X)";
        else if (normalizedRot >= Math.PI * 0.75 && normalizedRot < Math.PI * 1.25) facing = "North (-Z)";
        else if (normalizedRot >= Math.PI * 1.25 && normalizedRot < Math.PI * 1.75) facing = "East (-X)";

        this.facingElement.textContent = facing;
    }
}
