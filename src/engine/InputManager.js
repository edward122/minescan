export class InputManager {
    constructor(domElement) {
        this.domElement = domElement;
        this.keys = new Set();
        this.mouseButtons = new Set();
        this.mouseMovement = { x: 0, y: 0 };
        this.isLocked = false;
        this.onPointerLockLost = null;

        // Keyboard
        window.addEventListener('keydown', (e) => this.keys.add(e.code));
        window.addEventListener('keyup', (e) => this.keys.delete(e.code));

        // Mouse
        this.domElement.addEventListener('mousedown', (e) => {
            if (!this.isLocked) {
                this.domElement.requestPointerLock();
            } else {
                this.mouseButtons.add(e.button);
            }
        });

        this.domElement.addEventListener('mouseup', (e) => {
            this.mouseButtons.delete(e.button);
        });

        this.domElement.addEventListener('mousemove', (e) => {
            if (this.isLocked) {
                this.mouseMovement.x += e.movementX;
                this.mouseMovement.y += e.movementY;
            }
        });

        // Pointer Lock events
        document.addEventListener('pointerlockchange', () => {
            const wasLocked = this.isLocked;
            this.isLocked = document.pointerLockElement === this.domElement;
            if (wasLocked && !this.isLocked && this.onPointerLockLost) {
                this.onPointerLockLost();
            }
        });
    }

    isKeyPressed(code) {
        return this.keys.has(code);
    }

    isMouseButtonPressed(button) {
        return this.mouseButtons.has(button);
    }

    getMouseMovement() {
        const movement = { x: this.mouseMovement.x, y: this.mouseMovement.y };
        // Reset after reading
        this.mouseMovement.x = 0;
        this.mouseMovement.y = 0;
        return movement;
    }
}
