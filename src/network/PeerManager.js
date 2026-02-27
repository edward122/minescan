/**
 * PeerManager - WebRTC P2P multiplayer using PeerJS
 * 
 * Two modes:
 *   HOST: Creates a Peer, listens for connections, relays messages
 *   JOIN: Connects to a host peer, sends/receives game data
 */
import Peer from 'peerjs';

const ROOM_PREFIX = 'minescan-';

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/1/I to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

export class PeerManager {
    constructor() {
        this.peer = null;
        this.isHost = false;
        this.isConnected = false;
        this.roomCode = null;
        this.playerId = null;
        this.playerName = 'Player';

        // Host: map of peerId -> { conn, name, id }
        this.connections = new Map();
        // Join: single connection to host
        this.hostConnection = null;

        this.remotePlayers = new Map(); // id -> { position, rotation, name, inventory }
        this.spawnPosition = null; // joiner: received spawn from host
        this.receivedInventory = null; // joiner: received inventory from host

        // Next player ID counter (host only)
        this._nextId = 1;

        // Callbacks - set by main.js
        this.onConnected = null;        // (playerId) => void
        this.onDisconnected = null;     // () => void
        this.onPlayerJoin = null;       // (id, data) => void
        this.onPlayerLeave = null;      // (id) => void
        this.onPlayerMove = null;       // (id, data) => void
        this.onBlockChange = null;      // (x, y, z, blockId) => void
        this.onChatMessage = null;      // (id, name, message) => void
        this.onChunkDataReceived = null;// (chunkId, data) => void
        this.onChunkRequest = null;     // (chunkIds, peerId) => void — host only
        this.onRoomCreated = null;      // (roomCode) => void
        this.onPeerListChanged = null;  // (playerList) => void
        this.onError = null;            // (message) => void
        this.onResolvePeerSpawn = null; // (name) => { x, y, z } | null — host only, resolve saved position
        this.onTimeSync = null;         // (time) => void — joiner receives host time
        this.onPlayerDeath = null;      // (id) => void — remote player died
        this.onPlayerRespawn = null;    // (id, data) => void — remote player respawned
        this.onPlayerHit = null;        // (data) => void — this player was hit by someone
        this.onMobSync = null;          // (mobStates) => void — joiner receives mob positions from host
        this.onMobHit = null;           // (mobId, damage) => void — host: peer hit a mob
        this.onItemDrop = null;         // (itemId, count, x, y, z) => void — joiner sees item drop
        this.onRemoteSound = null;      // (sound, x, y, z) => void — remote sound effect
        this.onEvent = null;            // (type, payload, peerId) => void — catch-all for custom events

        // For join mode: world seed received from host
        this.receivedSeed = null;
        this.onWorldInfo = null;        // (seed) => void

        // Host position tracking (so we can include host in welcome)
        this._hostPosition = { x: 32, y: 100, z: 32 };
        this._hostRotation = { x: 0, y: 0 };
        this._worldTime = 0; // Current sky time for sync
    }

    /**
     * HOST MODE: Create a room and listen for incoming connections
     */
    hostWorld(playerName = 'Player') {
        this.isHost = true;
        this.playerName = playerName;
        this.roomCode = generateRoomCode();
        const peerId = ROOM_PREFIX + this.roomCode;

        this.peer = new Peer(peerId, {
            debug: 1,
        });

        this.peer.on('open', (id) => {
            console.log(`[Host] Room created: ${this.roomCode} (peerId: ${id})`);
            this.isConnected = true;
            this.playerId = 'host';
            if (this.onRoomCreated) this.onRoomCreated(this.roomCode);
            if (this.onConnected) this.onConnected(this.playerId);
        });

        this.peer.on('connection', (conn) => {
            this._handleIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('[Host] PeerJS error:', err);
            if (err.type === 'unavailable-id') {
                // Room code collision — try again
                this.disconnect();
                this.hostWorld(playerName);
                return;
            }
            if (this.onError) this.onError(`Connection error: ${err.type}`);
        });

        this.peer.on('disconnected', () => {
            // Try to reconnect to signaling server
            if (this.peer && !this.peer.destroyed) {
                this.peer.reconnect();
            }
        });
    }

    /**
     * JOIN MODE: Connect to a host using a room code
     */
    joinWorld(roomCode, playerName = 'Player') {
        this.isHost = false;
        this.playerName = playerName;
        this.roomCode = roomCode.toUpperCase().trim();
        const hostPeerId = ROOM_PREFIX + this.roomCode;

        this.peer = new Peer(undefined, {
            debug: 1,
        });

        this.peer.on('open', (myId) => {
            console.log(`[Join] My peer ID: ${myId}, connecting to host: ${hostPeerId}`);

            const conn = this.peer.connect(hostPeerId, {
                metadata: { name: this.playerName },
                serialization: 'json',
                reliable: true,
            });

            this.hostConnection = conn;

            conn.on('open', () => {
                console.log('[Join] Connected to host!');
                this.isConnected = true;
                // Send join message
                conn.send({ type: 'join', name: this.playerName });
            });

            conn.on('data', (msg) => {
                this._handleJoinerMessage(msg);
            });

            conn.on('close', () => {
                console.log('[Join] Connection to host closed');
                this._cleanup();
                if (this.onDisconnected) this.onDisconnected();
            });

            conn.on('error', (err) => {
                console.error('[Join] Connection error:', err);
                if (this.onError) this.onError('Connection to host failed');
            });
        });

        this.peer.on('error', (err) => {
            console.error('[Join] PeerJS error:', err);
            if (err.type === 'peer-unavailable') {
                if (this.onError) this.onError(`Room "${this.roomCode}" not found`);
            } else {
                if (this.onError) this.onError(`Connection error: ${err.type}`);
            }
        });
    }

    /**
     * HOST: Handle a new incoming peer connection
     */
    _handleIncomingConnection(conn) {
        const assignedId = `p${this._nextId++}`;

        conn.on('open', () => {
            console.log(`[Host] Peer connected: ${conn.peer}`);
        });

        conn.on('data', (msg) => {
            this._handleHostMessage(msg, conn, assignedId);
        });

        conn.on('close', () => {
            const peerInfo = this.connections.get(conn.peer);
            if (peerInfo) {
                console.log(`[Host] Peer disconnected: ${peerInfo.name} (${peerInfo.id})`);
                this.remotePlayers.delete(peerInfo.id);
                this.connections.delete(conn.peer);

                // Broadcast leave to all remaining peers
                this._broadcastToAll({
                    type: 'leave',
                    id: peerInfo.id,
                });

                if (this.onPlayerLeave) this.onPlayerLeave(peerInfo.id);
                if (this.onPeerListChanged) this.onPeerListChanged(this._getPeerList());
            }
        });

        // Store connection with assigned ID (name comes with 'join' message)
        this.connections.set(conn.peer, { conn, id: assignedId, name: 'Player' });
    }

    /**
     * HOST: Process a message from a connected peer
     */
    _handleHostMessage(msg, conn, assignedId) {
        const peerInfo = this.connections.get(conn.peer);
        if (!peerInfo) return;

        switch (msg.type) {
            case 'join': {
                peerInfo.name = msg.name || 'Player';

                // Build list of existing players for the joiner (including the host)
                const existingPlayers = [{
                    id: 'host',
                    name: this.playerName,
                    x: this._hostPosition.x,
                    y: this._hostPosition.y,
                    z: this._hostPosition.z,
                }];
                for (const [pId, info] of this.connections) {
                    if (pId !== conn.peer) {
                        const rp = this.remotePlayers.get(info.id);
                        existingPlayers.push({
                            id: info.id,
                            name: info.name,
                            x: rp?.position?.x || 32,
                            y: rp?.position?.y || 100,
                            z: rp?.position?.z || 32,
                        });
                    }
                }

                // Check if we have saved state for this player (by name)
                let spawnX = 32, spawnY = 100, spawnZ = 32;
                let savedInventory = null;
                if (this.onResolvePeerSpawn) {
                    const saved = this.onResolvePeerSpawn(peerInfo.name);
                    if (saved) {
                        spawnX = saved.x;
                        spawnY = saved.y;
                        spawnZ = saved.z;
                        if (saved.inventory) savedInventory = saved.inventory;
                    }
                }

                // Send welcome to joiner with their ID, seed, existing players, spawn, and inventory
                conn.send({
                    type: 'welcome',
                    id: assignedId,
                    seed: this._worldSeed || 'minecraft_seed',
                    players: existingPlayers,
                    spawnX,
                    spawnY,
                    spawnZ,
                    time: this._worldTime,
                    inventory: savedInventory,
                });

                // Notify host UI about new player
                this.remotePlayers.set(assignedId, {
                    name: peerInfo.name,
                    position: { x: spawnX, y: spawnY, z: spawnZ },
                    rotation: { x: 0, y: 0 },
                    inventory: savedInventory,
                });

                if (this.onPlayerJoin) this.onPlayerJoin(assignedId, { name: peerInfo.name, x: spawnX, y: spawnY, z: spawnZ });

                // Broadcast join to all other peers
                this._broadcastExcept(conn.peer, {
                    type: 'join',
                    id: assignedId,
                    name: peerInfo.name,
                });

                if (this.onPeerListChanged) this.onPeerListChanged(this._getPeerList());
                console.log(`[Host] ${peerInfo.name} (${assignedId}) joined`);
                break;
            }

            case 'move': {
                // Update stored position
                if (this.remotePlayers.has(assignedId)) {
                    const rp = this.remotePlayers.get(assignedId);
                    rp.position = { x: msg.x, y: msg.y, z: msg.z };
                    rp.rotation = { x: msg.rx || 0, y: msg.ry || 0 };
                }

                // Notify host's own rendering
                if (this.onPlayerMove) this.onPlayerMove(assignedId, msg);

                // Relay to all other peers
                this._broadcastExcept(conn.peer, {
                    type: 'move',
                    id: assignedId,
                    x: msg.x,
                    y: msg.y,
                    z: msg.z,
                    rx: msg.rx,
                    ry: msg.ry,
                });
                break;
            }

            case 'block': {
                // Apply block change on host
                if (this.onBlockChange) this.onBlockChange(msg.x, msg.y, msg.z, msg.blockId);

                // Relay to all other peers
                this._broadcastExcept(conn.peer, {
                    type: 'block',
                    x: msg.x,
                    y: msg.y,
                    z: msg.z,
                    blockId: msg.blockId,
                });
                break;
            }

            case 'request-chunks': {
                if (this.onChunkRequest) {
                    this.onChunkRequest(msg.chunks, conn.peer);
                }
                break;
            }

            case 'chat': {
                // Relay to all including sender
                const chatMsg = {
                    type: 'chat',
                    id: assignedId,
                    name: peerInfo.name,
                    message: msg.message,
                };
                this._broadcastToAll(chatMsg);
                if (this.onChatMessage) this.onChatMessage(assignedId, peerInfo.name, msg.message);
                break;
            }

            case 'player-death': {
                // Relay to all other peers
                this._broadcastExcept(conn.peer, {
                    type: 'player-death',
                    id: assignedId,
                });
                if (this.onPlayerDeath) this.onPlayerDeath(assignedId);
                break;
            }

            case 'player-respawn': {
                // Relay to all other peers
                this._broadcastExcept(conn.peer, {
                    type: 'player-respawn',
                    id: assignedId,
                    x: msg.x,
                    y: msg.y,
                    z: msg.z,
                });
                if (this.onPlayerRespawn) this.onPlayerRespawn(assignedId, msg);
                break;
            }

            case 'inventory-sync': {
                // Store peer's inventory on host for persistence
                const rp = this.remotePlayers.get(assignedId);
                if (rp) {
                    rp.inventory = msg.inventory;
                }
                break;
            }

            case 'player-hit': {
                // A peer wants to hit another player
                // targetId is 'host' or 'pN'
                if (msg.targetId === 'host') {
                    // Host is being hit
                    if (this.onPlayerHit) {
                        this.onPlayerHit({
                            attackerId: assignedId,
                            damage: msg.damage,
                            kbX: msg.kbX,
                            kbY: msg.kbY,
                            kbZ: msg.kbZ,
                            isCritical: msg.isCritical,
                        });
                    }
                } else {
                    // Relay the hit to the target peer
                    for (const [, info] of this.connections) {
                        if (info.id === msg.targetId && info.conn?.open) {
                            info.conn.send({
                                type: 'player-hit',
                                attackerId: assignedId,
                                damage: msg.damage,
                                kbX: msg.kbX,
                                kbY: msg.kbY,
                                kbZ: msg.kbZ,
                                isCritical: msg.isCritical,
                            });
                            break;
                        }
                    }
                }
                break;
            }

            case 'mob-hit': {
                // Peer hit a mob on host — apply damage on host side
                if (this.onMobHit) this.onMobHit(msg.mobId, msg.damage);
                break;
            }

            case 'sound': {
                // Relay sound to all OTHER peers (not sender)
                this._broadcastExcept(conn.peer, msg);
                // Also play on host side
                if (this.onRemoteSound) this.onRemoteSound(msg.sound, msg.x, msg.y, msg.z);
                break;
            }

            case 'player-drop': {
                // A joiner dropped an item — create it on host and broadcast to all peers
                const dx = Math.round((msg.x || 0) * 10) / 10;
                const dy = Math.round((msg.y || 0) * 10) / 10;
                const dz = Math.round((msg.z || 0) * 10) / 10;
                // Create on host side
                if (this.onItemDrop) this.onItemDrop(msg.itemId, msg.count, dx, dy, dz);
                // Broadcast to ALL peers (including the dropper for consistency,
                // but dropper already created it locally — they'll get a duplicate visual
                // which is acceptable, or we can exclude them)
                this._broadcastExcept(conn.peer, {
                    type: 'item-drop',
                    itemId: msg.itemId,
                    count: msg.count,
                    x: dx, y: dy, z: dz,
                });
                break;
            }

            default: {
                if (this.onEvent) this.onEvent(msg.type, msg, assignedId);
                // Relay chest updates
                if (msg.type === 'CHEST_UPDATE_SLOT') {
                    this._broadcastExcept(conn.peer, msg);
                }
                break;
            }
        }
    }

    /**
     * JOINER: Process a message from the host
     */
    _handleJoinerMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                this.playerId = msg.id;
                this.receivedSeed = msg.seed;
                // Store spawn position from host (may be a saved position)
                this.spawnPosition = {
                    x: msg.spawnX ?? 32,
                    y: msg.spawnY ?? 100,
                    z: msg.spawnZ ?? 32,
                };
                // Store saved inventory from host (if returning player)
                this.receivedInventory = msg.inventory || null;

                // Add existing players
                if (msg.players) {
                    for (const p of msg.players) {
                        this.remotePlayers.set(p.id, {
                            name: p.name,
                            position: { x: p.x || 0, y: p.y || 0, z: p.z || 0 },
                            rotation: { x: 0, y: 0 },
                        });
                        if (this.onPlayerJoin) this.onPlayerJoin(p.id, p);
                    }
                }

                if (this.onWorldInfo) this.onWorldInfo(msg.seed);
                if (this.onTimeSync && msg.time !== undefined) this.onTimeSync(msg.time);
                if (this.onConnected) this.onConnected(this.playerId);
                break;

            case 'join':
                this.remotePlayers.set(msg.id, {
                    name: msg.name,
                    position: { x: 0, y: 80, z: 0 },
                    rotation: { x: 0, y: 0 },
                });
                if (this.onPlayerJoin) this.onPlayerJoin(msg.id, msg);
                break;

            case 'leave':
                this.remotePlayers.delete(msg.id);
                if (this.onPlayerLeave) this.onPlayerLeave(msg.id);
                break;

            case 'move':
                if (this.remotePlayers.has(msg.id)) {
                    const rp = this.remotePlayers.get(msg.id);
                    rp.position = { x: msg.x, y: msg.y, z: msg.z };
                    rp.rotation = { x: msg.rx || 0, y: msg.ry || 0 };
                }
                if (this.onPlayerMove) this.onPlayerMove(msg.id, msg);
                break;

            case 'block':
                if (this.onBlockChange) this.onBlockChange(msg.x, msg.y, msg.z, msg.blockId);
                break;

            case 'chunk-data': {
                if (this.onChunkDataReceived) {
                    // Decode base64 back to Uint8Array
                    const binary = atob(msg.data);
                    const chunkArray = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        chunkArray[i] = binary.charCodeAt(i);
                    }
                    this.onChunkDataReceived(msg.chunkId, chunkArray);
                }
                break;
            }

            case 'chat':
                if (this.onChatMessage) this.onChatMessage(msg.id, msg.name, msg.message);
                break;

            case 'time-sync':
                if (this.onTimeSync) this.onTimeSync(msg.time);
                break;

            case 'player-death':
                if (this.onPlayerDeath) this.onPlayerDeath(msg.id);
                break;

            case 'player-respawn':
                if (this.onPlayerRespawn) this.onPlayerRespawn(msg.id, msg);
                break;

            case 'player-hit':
                if (this.onPlayerHit) {
                    this.onPlayerHit(msg);
                }
                break;

            case 'host-disconnect':
                // Host is intentionally disconnecting — clean up immediately
                console.log('[Join] Host sent disconnect signal');
                this._cleanup();
                if (this.onDisconnected) this.onDisconnected();
                break;

            case 'kicked':
                console.log('[Join] Kicked by host');
                this._cleanup();
                if (this.onDisconnected) this.onDisconnected();
                break;

            case 'mob-sync':
                if (this.onMobSync) this.onMobSync(msg.mobs);
                break;

            case 'item-drop':
                if (this.onItemDrop) this.onItemDrop(msg.itemId, msg.count, msg.x, msg.y, msg.z);
                break;

            case 'sound':
                if (this.onRemoteSound) this.onRemoteSound(msg.sound, msg.x, msg.y, msg.z);
                break;

            default:
                if (this.onEvent) this.onEvent(msg.type, msg);
                break;
        }
    }

    // ---- Public API (used by main.js) ----

    /**
     * Set the world seed (host calls this so joiners can receive it)
     */
    setWorldSeed(seed) {
        this._worldSeed = seed;
    }

    /**
     * Set the world time (host calls this so joiners receive correct time)
     */
    setWorldTime(time) {
        this._worldTime = time;
    }

    /**
     * Send player position update (both host and joiner)
     */
    sendPosition(position, rotation, flags = {}) {
        const data = {
            type: 'move',
            x: Math.round(position.x * 100) / 100,
            y: Math.round(position.y * 100) / 100,
            z: Math.round(position.z * 100) / 100,
            rx: Math.round(rotation.x * 100) / 100,
            ry: Math.round(rotation.y * 100) / 100,
        };
        // Include action flags (punching, mining) for arm swing animation
        if (flags.punching) data.p = 1;
        if (flags.mining) data.m = 1;

        if (this.isHost) {
            // Track host position for welcome messages
            this._hostPosition = { x: data.x, y: data.y, z: data.z };
            this._hostRotation = { x: data.rx, y: data.ry };
            // Broadcast to all connected peers
            this._broadcastToAll({
                ...data,
                id: 'host',
            });
        } else if (this.hostConnection?.open) {
            this.hostConnection.send(data);
        }
    }

    /**
     * Send block change
     */
    sendBlockChange(x, y, z, blockId) {
        const data = { type: 'block', x, y, z, blockId };

        if (this.isHost) {
            this._broadcastToAll(data);
        } else if (this.hostConnection?.open) {
            this.hostConnection.send(data);
        }
    }

    /**
     * Send chat message
     */
    sendChat(message) {
        const data = { type: 'chat', message };

        if (this.isHost) {
            const chatMsg = {
                type: 'chat',
                id: 'host',
                name: this.playerName,
                message,
            };
            this._broadcastToAll(chatMsg);
        } else if (this.hostConnection?.open) {
            this.hostConnection.send(data);
        }
    }

    /**
     * HOST: Send chunk data to a specific peer
     */
    sendChunkData(peerId, chunkId, chunkData) {
        // Look up peer by Map key first (conn.peer UUID), then by assigned ID
        let peerInfo = this.connections.get(peerId);
        if (!peerInfo) {
            // peerId might be an assigned ID like 'p1' — search by id field
            for (const [, info] of this.connections) {
                if (info.id === peerId) {
                    peerInfo = info;
                    break;
                }
            }
        }
        if (peerInfo?.conn?.open) {
            // Convert Uint8Array to base64 for efficient JSON serialization
            // Process in 8KB batches to avoid stack overflow with apply()
            const BATCH = 8192;
            let binStr = '';
            for (let i = 0; i < chunkData.length; i += BATCH) {
                const slice = chunkData.subarray(i, Math.min(i + BATCH, chunkData.length));
                binStr += String.fromCharCode.apply(null, slice);
            }
            peerInfo.conn.send({
                type: 'chunk-data',
                chunkId,
                data: btoa(binStr),
            });
        }
    }

    /**
     * JOINER: Request chunks from host
     */
    requestChunks(chunkIds) {
        if (!this.isHost && this.hostConnection?.open) {
            this.hostConnection.send({
                type: 'request-chunks',
                chunks: chunkIds,
            });
        }
    }

    /**
     * HOST: Send time sync to all peers
     */
    sendTimeSync(time) {
        if (this.isHost) {
            this._broadcastToAll({ type: 'time-sync', time });
        }
    }

    /**
     * Send a hit to another player
     * @param {string} targetId - The target player's ID ('host' or 'pN')
     * @param {number} damage - Damage amount
     * @param {object} knockback - { x, y, z } knockback direction
     * @param {boolean} isCritical - Whether this is a critical hit
     */
    sendPlayerHit(targetId, damage, knockback, isCritical) {
        const data = {
            type: 'player-hit',
            targetId,
            damage,
            kbX: knockback.x,
            kbY: knockback.y,
            kbZ: knockback.z,
            isCritical,
        };

        if (this.isHost) {
            // Host hitting a peer: send directly to target
            for (const [, info] of this.connections) {
                if (info.id === targetId && info.conn?.open) {
                    info.conn.send({
                        type: 'player-hit',
                        attackerId: 'host',
                        damage,
                        kbX: knockback.x,
                        kbY: knockback.y,
                        kbZ: knockback.z,
                        isCritical,
                    });
                    break;
                }
            }
        } else if (this.hostConnection?.open) {
            // Peer hitting someone: send to host for relay
            this.hostConnection.send(data);
        }
    }

    /**
     * Send player death notification
     */
    sendPlayerDeath() {
        const data = { type: 'player-death' };
        if (this.isHost) {
            this._broadcastToAll({ ...data, id: 'host' });
        } else if (this.hostConnection?.open) {
            this.hostConnection.send(data);
        }
    }

    /**
     * Send player respawn notification
     */
    sendPlayerRespawn(position) {
        const data = {
            type: 'player-respawn',
            x: position.x,
            y: position.y,
            z: position.z,
        };
        if (this.isHost) {
            this._broadcastToAll({ ...data, id: 'host' });
        } else if (this.hostConnection?.open) {
            this.hostConnection.send(data);
        }
    }

    /**
     * JOINER: Send inventory to host for persistence
     */
    sendInventorySync(inventorySlots) {
        if (!this.isHost && this.hostConnection?.open) {
            this.hostConnection.send({
                type: 'inventory-sync',
                inventory: inventorySlots,
            });
        }
    }

    /**
     * HOST: Broadcast mob states to all peers (compact format)
     */
    sendMobSync(mobStates) {
        if (!this.isHost) return;
        this._broadcastToAll({
            type: 'mob-sync',
            mobs: mobStates, // Array of {id, type, x, y, z, ry, health, dead}
        });
    }

    /**
     * Send generic custom event
     */
    sendEvent(type, payload) {
        if (this.isHost) {
            this._broadcastToAll({ type, ...payload });
        } else if (this.hostConnection?.open) {
            this.hostConnection.send({ type, ...payload });
        }
    }

    /**
     * JOINER: Tell host that we hit a mob
     */
    sendMobHit(mobId, damage) {
        if (this.isHost) {
            // Host hits mob directly (handled locally)
            return;
        }
        if (this.hostConnection?.open) {
            this.hostConnection.send({
                type: 'mob-hit',
                mobId,
                damage,
            });
        }
    }

    /**
     * HOST: Broadcast item drop to all peers
     */
    sendItemDrop(itemId, count, x, y, z) {
        if (!this.isHost) return;
        this._broadcastToAll({
            type: 'item-drop',
            itemId, count,
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            z: Math.round(z * 10) / 10,
        });
    }

    /**
     * JOINER: Tell host that we dropped an item (host will create + broadcast)
     */
    sendPlayerDrop(itemId, count, x, y, z) {
        if (this.isHost) return; // Host uses sendItemDrop directly
        if (this.hostConnection?.open) {
            this.hostConnection.send({
                type: 'player-drop',
                itemId, count,
                x: Math.round(x * 10) / 10,
                y: Math.round(y * 10) / 10,
                z: Math.round(z * 10) / 10,
            });
        }
    }

    /**
     * Broadcast a sound effect to all peers (host) or host (joiner)
     */
    sendSoundEffect(sound, x, y, z) {
        const data = {
            type: 'sound', sound,
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            z: Math.round(z * 10) / 10,
        };
        if (this.isHost) {
            this._broadcastToAll(data);
        } else if (this.hostConnection?.open) {
            this.hostConnection.send(data);
        }
    }

    /**
     * HOST: Kick a specific player by assigned ID
     */
    kickPlayer(assignedId) {
        if (!this.isHost) return;
        for (const [connPeerId, info] of this.connections) {
            if (info.id === assignedId && info.conn?.open) {
                try {
                    info.conn.send({ type: 'kicked' });
                    info.conn.close();
                } catch (e) { /* ignore */ }
                this.connections.delete(connPeerId);
                this.remotePlayers.delete(assignedId);
                // Broadcast leave to other peers
                this._broadcastToAll({ type: 'leave', id: assignedId });
                if (this.onPlayerLeave) this.onPlayerLeave(assignedId);
                if (this.onPeerListChanged) this.onPeerListChanged(this._getPeerList());
                break;
            }
        }
    }

    /**
     * Disconnect and clean up
     */
    disconnect() {
        this._cleanup();
        if (this.onDisconnected) this.onDisconnected();
    }

    _cleanup() {
        // Close all peer connections explicitly BEFORE destroying
        // This ensures remote peers get the 'close' event immediately
        if (this.isHost) {
            // Notify all peers that host is disconnecting
            for (const [, info] of this.connections) {
                if (info.conn?.open) {
                    try {
                        info.conn.send({ type: 'host-disconnect' });
                        info.conn.close();
                    } catch (e) { /* ignore */ }
                }
            }
        }
        if (this.hostConnection?.open) {
            try { this.hostConnection.close(); } catch (e) { /* ignore */ }
        }

        this.isConnected = false;
        this.isHost = false;
        this.roomCode = null;
        this.playerId = null;
        this.remotePlayers.clear();
        this.connections.clear();
        this.hostConnection = null;
        this.receivedSeed = null;
        this._worldSeed = null;
        this._hostPosition = { x: 32, y: 100, z: 32 };
        this._hostRotation = { x: 0, y: 0 };
        this._worldTime = 0;
        this.spawnPosition = null;
        this.receivedInventory = null;

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
    }

    // ---- Internal broadcast helpers ----

    _broadcastToAll(data) {
        for (const [, info] of this.connections) {
            if (info.conn?.open) {
                info.conn.send(data);
            }
        }
    }

    _broadcastExcept(excludePeerId, data) {
        for (const [peerId, info] of this.connections) {
            if (peerId !== excludePeerId && info.conn?.open) {
                info.conn.send(data);
            }
        }
    }

    _getPeerList() {
        const list = [{ id: 'host', name: this.playerName + ' (Host)' }];
        for (const [, info] of this.connections) {
            list.push({ id: info.id, name: info.name });
        }
        return list;
    }
}
