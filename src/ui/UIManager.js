const SETTINGS_KEY = 'mc_clone_settings';

const DEFAULT_SETTINGS = {
    fov: 75,
    renderDistance: 4,
    resolution: 100,
    shadows: 'off',
    particles: 'all',
    sensitivity: 100,
    volume: 100,
    antialiasing: 'off',
    clouds: 'on',
    torchLights: 'on',
    preset: 'medium'
};

const PRESETS = {
    low: { renderDistance: 2, resolution: 50, shadows: 'off', particles: 'off', antialiasing: 'off', clouds: 'off', torchLights: 'off' },
    medium: { renderDistance: 4, resolution: 75, shadows: 'off', particles: 'reduced', antialiasing: 'off', clouds: 'on', torchLights: 'on' },
    high: { renderDistance: 8, resolution: 100, shadows: 'soft', particles: 'all', antialiasing: 'off', clouds: 'on', torchLights: 'on' },
};

export class UIManager {
    constructor(inputManager) {
        this.inputManager = inputManager;

        // Overlay containers
        this.uiLayer = document.getElementById('ui-layer');
        this.mainMenu = document.getElementById('main-menu');
        this.pauseMenu = document.getElementById('pause-menu');
        this.settingsMenu = document.getElementById('settings-menu');
        this.loadingScreen = document.getElementById('loading-screen');

        // World selection
        this.worldList = document.getElementById('world-list');
        this.btnCreateWorld = document.getElementById('btn-create-world');
        this.newWorldName = document.getElementById('new-world-name');
        this.newWorldSeed = document.getElementById('new-world-seed');

        // Buttons
        this.btnSettings = document.getElementById('btn-settings');
        this.btnResume = document.getElementById('btn-resume');
        this.btnPauseSettings = document.getElementById('btn-pause-settings');
        this.btnSettingsBack = document.getElementById('btn-settings-back');
        this.btnRespawn = document.getElementById('btn-respawn');
        this.btnQuit = document.getElementById('btn-quit');
        this.deathScreen = document.getElementById('death-screen');

        // Settings inputs
        this.fovInput = document.getElementById('setting-fov');
        this.fovVal = document.getElementById('val-fov');
        this.renderDistInput = document.getElementById('setting-render-dist');
        this.renderDistVal = document.getElementById('val-render-dist');
        this.resolutionInput = document.getElementById('setting-resolution');
        this.resolutionVal = document.getElementById('val-resolution');
        this.shadowsInput = document.getElementById('setting-shadows');
        this.particlesInput = document.getElementById('setting-particles');
        this.sensitivityInput = document.getElementById('setting-sensitivity');
        this.sensitivityVal = document.getElementById('val-sensitivity');
        this.volumeInput = document.getElementById('setting-volume');
        this.volumeVal = document.getElementById('val-volume');

        // New settings
        this.antialiasingInput = document.getElementById('setting-antialiasing');
        this.cloudsInput = document.getElementById('setting-clouds');
        this.torchLightsInput = document.getElementById('setting-torch-lights');
        this.presetInput = document.getElementById('setting-preset');

        this.state = 'MENU'; // MENU, LOADING, PLAYING, PAUSED, SETTINGS, DEAD
        this.previousState = 'MENU';

        // Callbacks
        this.onStartGame = null;
        this.onRespawn = null;
        this.onWorldSelected = null;    // (worldId, seed) => void
        this.onWorldDeleted = null;     // (worldId) => void
        this.onWorldCreated = null;     // (name, seed) => Promise<void>
        this.onQuitToTitle = null;      // async () => Promise<void>
        this.onSettingsChanged = null;  // (settings) => void

        // Load saved settings
        this._settings = this._loadSettings();
        this._applySettingsToDOM();

        this.initEventListeners();
        this.showMainMenu();
    }

    _loadSettings() {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Merge with defaults so new settings don't break old saves
                return { ...DEFAULT_SETTINGS, ...parsed };
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
        return { ...DEFAULT_SETTINGS };
    }

    _saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    }

    _applySettingsToDOM() {
        const s = this._settings;

        this.fovInput.value = s.fov;
        this.fovVal.textContent = s.fov;

        this.renderDistInput.value = s.renderDistance;
        this.renderDistVal.textContent = s.renderDistance;

        this.resolutionInput.value = s.resolution;
        this.resolutionVal.textContent = s.resolution + '%';

        this.shadowsInput.value = s.shadows;
        this.particlesInput.value = s.particles;

        this.sensitivityInput.value = s.sensitivity;
        this.sensitivityVal.textContent = s.sensitivity + '%';

        this.volumeInput.value = s.volume;
        this.volumeVal.textContent = s.volume + '%';

        this.antialiasingInput.value = s.antialiasing || 'off';
        this.cloudsInput.value = s.clouds || 'on';
        this.torchLightsInput.value = s.torchLights || 'on';
        this.presetInput.value = s.preset || 'custom';
    }

    _updateSetting(key, value) {
        this._settings[key] = value;
        this._saveSettings();
        if (this.onSettingsChanged) {
            this.onSettingsChanged(this._settings);
        }
    }

    initEventListeners() {
        // Create world
        this.btnCreateWorld.addEventListener('click', async () => {
            const name = this.newWorldName.value.trim() || 'New World';
            const seed = this.newWorldSeed.value.trim() || '';
            if (this.onWorldCreated) {
                await this.onWorldCreated(name, seed);
            }
            this.newWorldName.value = '';
            this.newWorldSeed.value = '';
        });

        this.btnResume.addEventListener('click', () => {
            this.startGame();
        });

        this.btnQuit.addEventListener('click', async () => {
            this.btnQuit.textContent = "Saving...";
            this.btnQuit.disabled = true;
            if (this.onQuitToTitle) {
                await this.onQuitToTitle();
            }
            this.btnQuit.textContent = "Save & Quit to Title";
            this.btnQuit.disabled = false;
            this.showMainMenu();
        });

        const openSettings = () => {
            this.previousState = this.state;
            this.showSettings();
        };

        this.btnSettings.addEventListener('click', openSettings);
        this.btnPauseSettings.addEventListener('click', openSettings);

        this.btnSettingsBack.addEventListener('click', () => {
            if (this.previousState === 'MENU') {
                this.showMainMenu();
            } else {
                this.showPauseMenu();
            }
        });

        this.btnRespawn.addEventListener('click', () => {
            if (this.onRespawn) this.onRespawn();
            this.startGame();
        });

        // --- Settings input listeners ---

        // FOV
        this.fovInput.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            this.fovVal.textContent = v;
            this._updateSetting('fov', v);
        });

        // Render Distance
        this.renderDistInput.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            this.renderDistVal.textContent = v;
            this._updateSetting('renderDistance', v);
            this._markCustomPreset();
        });

        // Resolution Scale
        this.resolutionInput.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            this.resolutionVal.textContent = v + '%';
            this._updateSetting('resolution', v);
            this._markCustomPreset();
        });

        // Shadows
        this.shadowsInput.addEventListener('change', (e) => {
            this._updateSetting('shadows', e.target.value);
            this._markCustomPreset();
        });

        // Antialiasing
        this.antialiasingInput.addEventListener('change', (e) => {
            this._updateSetting('antialiasing', e.target.value);
            this._markCustomPreset();
        });

        // Clouds
        this.cloudsInput.addEventListener('change', (e) => {
            this._updateSetting('clouds', e.target.value);
            this._markCustomPreset();
        });

        // Torch Lights
        this.torchLightsInput.addEventListener('change', (e) => {
            this._updateSetting('torchLights', e.target.value);
            this._markCustomPreset();
        });

        // Particles
        this.particlesInput.addEventListener('change', (e) => {
            this._updateSetting('particles', e.target.value);
            this._markCustomPreset();
        });

        // Graphics Preset
        this.presetInput.addEventListener('change', (e) => {
            const preset = e.target.value;
            this._updateSetting('preset', preset);
            if (preset !== 'custom' && PRESETS[preset]) {
                this._applyPreset(preset);
            }
        });

        // Mouse Sensitivity
        this.sensitivityInput.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            this.sensitivityVal.textContent = v + '%';
            this._updateSetting('sensitivity', v);
        });

        // Master Volume
        this.volumeInput.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            this.volumeVal.textContent = v + '%';
            this._updateSetting('volume', v);
        });
    }

    /**
     * Render the world list from an array of world objects
     * @param {Array} worlds - [{id, name, seed, createdAt}, ...]
     */
    renderWorldList(worlds) {
        this.worldList.innerHTML = '';

        if (worlds.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'world-list-empty';
            empty.textContent = 'No worlds yet — create one below!';
            this.worldList.appendChild(empty);
            return;
        }

        for (const world of worlds) {
            const entry = document.createElement('div');
            entry.className = 'world-entry';

            const info = document.createElement('div');
            info.className = 'world-info';

            const name = document.createElement('div');
            name.className = 'world-name';
            name.textContent = world.name;

            const meta = document.createElement('div');
            meta.className = 'world-meta';
            const date = new Date(world.createdAt);
            meta.textContent = `Seed: ${world.seed} • ${date.toLocaleDateString()}`;

            info.appendChild(name);
            info.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'world-actions';

            const playBtn = document.createElement('button');
            playBtn.className = 'mc-button mc-button-small';
            playBtn.textContent = 'Play';
            playBtn.addEventListener('click', () => {
                if (this.onWorldSelected) {
                    this.showLoading();
                    setTimeout(() => {
                        this.onWorldSelected(world.id, world.seed);
                    }, 300);
                }
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'mc-button mc-button-small mc-button-danger';
            deleteBtn.textContent = '✕';
            deleteBtn.title = 'Delete World';
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete "${world.name}"? This cannot be undone.`)) {
                    if (this.onWorldDeleted) {
                        await this.onWorldDeleted(world.id);
                    }
                }
            });

            actions.appendChild(playBtn);
            actions.appendChild(deleteBtn);

            entry.appendChild(info);
            entry.appendChild(actions);
            this.worldList.appendChild(entry);
        }
    }

    // Called primarily by main.js when pointer lock is lost
    handlePointerLockLost() {
        if (this.state === 'PLAYING') {
            const isInventoryOpen = !document.getElementById('inventory-screen').classList.contains('hidden');
            if (!isInventoryOpen) {
                this.showPauseMenu();
            }
        }
    }

    hideAll() {
        this.uiLayer.classList.remove('hidden');
        this.mainMenu.classList.add('hidden');
        this.pauseMenu.classList.add('hidden');
        this.settingsMenu.classList.add('hidden');
        this.loadingScreen.classList.add('hidden');
        this.deathScreen.classList.add('hidden');
    }

    showMainMenu() {
        this.hideAll();
        this.mainMenu.classList.remove('hidden');
        this.state = 'MENU';
    }

    showLoading() {
        this.hideAll();
        this.loadingScreen.classList.remove('hidden');
        this.state = 'LOADING';
    }

    showPauseMenu() {
        this.hideAll();
        this.pauseMenu.classList.remove('hidden');
        this.state = 'PAUSED';
    }

    showSettings() {
        this.hideAll();
        this.settingsMenu.classList.remove('hidden');
        this.state = 'SETTINGS';
    }

    showDeathScreen() {
        this.hideAll();
        this.deathScreen.classList.remove('hidden');
        this.state = 'DEAD';
    }

    startGame() {
        this.hideAll();
        this.uiLayer.classList.add('hidden');
        this.state = 'PLAYING';

        if (this.onStartGame) {
            this.onStartGame();
        }
    }

    getSettings() {
        return { ...this._settings };
    }

    _applyPreset(presetName) {
        const preset = PRESETS[presetName];
        if (!preset) return;

        // Apply each preset value
        for (const [key, value] of Object.entries(preset)) {
            this._settings[key] = value;
        }

        this._saveSettings();
        this._applySettingsToDOM();

        if (this.onSettingsChanged) {
            this.onSettingsChanged(this._settings);
        }
    }

    _markCustomPreset() {
        if (this._settings.preset !== 'custom') {
            this._settings.preset = 'custom';
            this.presetInput.value = 'custom';
            this._saveSettings();
        }
    }
}
