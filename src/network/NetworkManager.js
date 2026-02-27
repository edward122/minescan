/**
 * NetworkManager - WebSocket client for multiplayer
 * Handles connection, message sending/receiving, and remote player state
 */
export class NetworkManager {
    constructor() {
        this.ws = null;
        this.playerId = null;
        this.isConnected = false;
        this.remotePlayers = new Map(); // id -> { position, rotation, name }

        // Callbacks
        this.onConnected = null;
        this.onDisconnected = null;
        this.onPlayerJoin = null;       // (id, data) => void
        this.onPlayerLeave = null;      // (id) => void
        this.onPlayerMove = null;       // (id, position, rotation) => void
        this.onBlockChange = null;      // (x, y, z, blockId) => void
        this.onChatMessage = null;      // (id, name, message) => void
    }

    connect(serverUrl, playerName = 'Player') {
        if (this.ws) {
            this.ws.close();
        }

        try {
            this.ws = new WebSocket(serverUrl);
        } catch (e) {
            console.error('Failed to create WebSocket:', e);
            return;
        }

        this.ws.onopen = () => {
            console.log('Connected to multiplayer server');
            this.isConnected = true;
            // Send join message
            this.send({
                type: 'join',
                name: playerName
            });
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._handleMessage(msg);
            } catch (e) {
                console.error('Failed to parse server message:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('Disconnected from multiplayer server');
            this.isConnected = false;
            this.remotePlayers.clear();
            if (this.onDisconnected) this.onDisconnected();
        };

        this.ws.onerror = (event) => {
            console.error('WebSocket error:', event);
        };
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.remotePlayers.clear();
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    // Send player position update (should be called every frame or throttled)
    sendPosition(position, rotation) {
        this.send({
            type: 'move',
            x: Math.round(position.x * 100) / 100,
            y: Math.round(position.y * 100) / 100,
            z: Math.round(position.z * 100) / 100,
            rx: Math.round(rotation.x * 100) / 100,
            ry: Math.round(rotation.y * 100) / 100
        });
    }

    // Send block change
    sendBlockChange(x, y, z, blockId) {
        this.send({
            type: 'block',
            x, y, z,
            blockId
        });
    }

    // Send chat message
    sendChat(message) {
        this.send({
            type: 'chat',
            message
        });
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                this.playerId = msg.id;
                // Receive existing players
                if (msg.players) {
                    for (const p of msg.players) {
                        this.remotePlayers.set(p.id, {
                            name: p.name,
                            position: { x: p.x || 0, y: p.y || 0, z: p.z || 0 },
                            rotation: { x: 0, y: 0 }
                        });
                        if (this.onPlayerJoin) this.onPlayerJoin(p.id, p);
                    }
                }
                if (this.onConnected) this.onConnected(this.playerId);
                break;

            case 'join':
                this.remotePlayers.set(msg.id, {
                    name: msg.name,
                    position: { x: 0, y: 80, z: 0 },
                    rotation: { x: 0, y: 0 }
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
                if (this.onBlockChange) {
                    this.onBlockChange(msg.x, msg.y, msg.z, msg.blockId);
                }
                break;

            case 'chat':
                if (this.onChatMessage) {
                    this.onChatMessage(msg.id, msg.name, msg.message);
                }
                break;
        }
    }
}
