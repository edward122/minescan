/**
 * Minecraft Clone - Multiplayer WebSocket Server
 * Run with: node server.js [port]
 */
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.argv[2]) || 8080;

const wss = new WebSocketServer({ port: PORT });

let nextId = 1;
const players = new Map(); // ws -> { id, name, x, y, z, rx, ry }

console.log(`Minecraft multiplayer server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
    const playerId = `p${nextId++}`;
    const playerData = { id: playerId, name: 'Player', x: 32, y: 100, z: 32, rx: 0, ry: 0 };
    players.set(ws, playerData);

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        switch (msg.type) {
            case 'join':
                playerData.name = msg.name || 'Player';

                // Send welcome with existing players
                const existingPlayers = [];
                for (const [otherWs, otherData] of players) {
                    if (otherWs !== ws) {
                        existingPlayers.push({
                            id: otherData.id,
                            name: otherData.name,
                            x: otherData.x,
                            y: otherData.y,
                            z: otherData.z
                        });
                    }
                }

                ws.send(JSON.stringify({
                    type: 'welcome',
                    id: playerId,
                    players: existingPlayers
                }));

                // Broadcast join to others
                broadcast(ws, {
                    type: 'join',
                    id: playerId,
                    name: playerData.name
                });

                console.log(`${playerData.name} (${playerId}) joined`);
                break;

            case 'move':
                playerData.x = msg.x;
                playerData.y = msg.y;
                playerData.z = msg.z;
                playerData.rx = msg.rx || 0;
                playerData.ry = msg.ry || 0;

                broadcast(ws, {
                    type: 'move',
                    id: playerId,
                    x: msg.x,
                    y: msg.y,
                    z: msg.z,
                    rx: msg.rx,
                    ry: msg.ry
                });
                break;

            case 'block':
                // Broadcast block change to all other players
                broadcast(ws, {
                    type: 'block',
                    x: msg.x,
                    y: msg.y,
                    z: msg.z,
                    blockId: msg.blockId
                });
                break;

            case 'chat':
                broadcastAll({
                    type: 'chat',
                    id: playerId,
                    name: playerData.name,
                    message: msg.message
                });
                break;
        }
    });

    ws.on('close', () => {
        console.log(`${playerData.name} (${playerId}) disconnected`);
        broadcast(ws, {
            type: 'leave',
            id: playerId
        });
        players.delete(ws);
    });
});

// Send to all players except sender
function broadcast(senderWs, data) {
    const json = JSON.stringify(data);
    for (const [ws] of players) {
        if (ws !== senderWs && ws.readyState === 1) {
            ws.send(json);
        }
    }
}

// Send to ALL players
function broadcastAll(data) {
    const json = JSON.stringify(data);
    for (const [ws] of players) {
        if (ws.readyState === 1) {
            ws.send(json);
        }
    }
}
