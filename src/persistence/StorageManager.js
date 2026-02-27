export class StorageManager {
    constructor(dbName = 'minecraft_clone_db', version = 3) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('player_state')) {
                    db.createObjectStore('player_state');
                }
                if (!db.objectStoreNames.contains('chunks')) {
                    db.createObjectStore('chunks');
                }
                if (!db.objectStoreNames.contains('worlds')) {
                    db.createObjectStore('worlds', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('chest_inventories')) {
                    db.createObjectStore('chest_inventories');
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    // ---- World Management ----

    async listWorlds() {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            const transaction = this.db.transaction(['worlds'], 'readonly');
            const store = transaction.objectStore('worlds');
            const request = store.getAll();

            request.onsuccess = (event) => {
                const worlds = event.target.result || [];
                // Sort by most recently created first
                worlds.sort((a, b) => b.createdAt - a.createdAt);
                resolve(worlds);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async createWorld(name, seed) {
        const id = 'world_' + Date.now();
        const world = {
            id,
            name: name || 'New World',
            seed: seed || String(Math.floor(Math.random() * 999999999)),
            createdAt: Date.now(),
        };
        await this._put('worlds', world.id, world);
        return world;
    }

    async getWorld(worldId) {
        return this._get('worlds', worldId);
    }

    async deleteWorld(worldId) {
        // Delete the world entry
        await this._delete('worlds', worldId);

        // Delete all chunks and player state for this world
        await this._delete('player_state', worldId);

        // Delete all chunks with this worldId prefix
        await this._deleteByPrefix('chunks', worldId + '_');

        // Delete all chests with this worldId prefix
        if (this.db && this.db.objectStoreNames.contains('chest_inventories')) {
            await this._deleteByPrefix('chest_inventories', worldId + '_');
        }
    }

    // ---- Player State ----

    async savePlayerState(worldKey, data) {
        return this._put('player_state', worldKey, data);
    }

    async loadPlayerState(worldKey) {
        return this._get('player_state', worldKey);
    }

    // ---- Chunks ----

    async saveChunk(worldKey, chunkId, chunkData) {
        const key = `${worldKey}_${chunkId}`;
        return this._put('chunks', key, chunkData);
    }

    async loadChunk(worldKey, chunkId) {
        const key = `${worldKey}_${chunkId}`;
        return this._get('chunks', key);
    }

    // ---- Chests ----

    async saveChest(worldKey, chestId, data) {
        const key = `${worldKey}_${chestId}`;
        return this._put('chest_inventories', key, data);
    }

    async loadChest(worldKey, chestId) {
        const key = `${worldKey}_${chestId}`;
        return this._get('chest_inventories', key);
    }

    async loadAllChests(worldKey) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            const transaction = this.db.transaction(['chest_inventories'], 'readonly');
            const store = transaction.objectStore('chest_inventories');
            const request = store.openCursor();

            const chests = new Map();
            const prefix = worldKey + '_';

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
                        const chestId = cursor.key.substring(prefix.length);
                        chests.set(chestId, cursor.value);
                    }
                    cursor.continue();
                } else {
                    resolve(chests);
                }
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // ---- Internal Helpers ----

    _put(storeName, key, data) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            // For worlds store, data IS the value with keyPath
            const request = storeName === 'worlds' ? store.put(data) : store.put(data, key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    _get(storeName, key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    _delete(storeName, key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    _deleteByPrefix(storeName, prefix) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB not initialized");
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }
}
