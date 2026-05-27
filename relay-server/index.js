/**
 * THETA172 — Cloud Relay Server
 * A stateless WebSocket relay that routes messages between
 * hosts (teachers) and viewers (students) across the internet.
 *
 * The relay is protocol-transparent: it does NOT interpret
 * collab messages. It only understands room management
 * (create, join, leave) and forwards everything else.
 *
 * Deploy: Render, Railway, Fly.io, Glitch, or any Node.js host.
 * Usage:  node index.js
 *         PORT=8765 node index.js
 */

const { WebSocketServer } = require('ws');

// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

const PORT = parseInt(process.env.PORT) || 8765;
const MAX_ROOMS = 100;
const MAX_VIEWERS_PER_ROOM = 50;
const ROOM_IDLE_TIMEOUT = 30 * 60 * 1000;    // 30 minutes
const HEARTBEAT_INTERVAL = 30 * 1000;         // 30 seconds
const MAX_MESSAGE_SIZE = 1024 * 1024;          // 1 MB

// Relay message types
const RELAY = {
  CREATE:   'relay_create',
  JOIN:     'relay_join',
  LEAVE:    'relay_leave',
  CREATED:  'relay_created',
  JOINED:   'relay_joined',
  ERROR:    'relay_error',
  FORWARD:  'relay_forward',
};


// ══════════════════════════════════════════════════════════════════
// ROOM STORE
// ══════════════════════════════════════════════════════════════════

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {Object} Room
 * @property {string} roomKey
 * @property {WebSocket} host - The teacher's WebSocket
 * @property {string} hostName
 * @property {Map<string, { ws: WebSocket, name: string }>} viewers
 * @property {number} lastActivity - Timestamp of last message
 */

const http = require('http');

// ══════════════════════════════════════════════════════════════════
// SERVER
// ══════════════════════════════════════════════════════════════════

// HTTP server for health checks (Render, Railway, etc.)
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'theta172-relay',
      rooms: rooms.size,
      uptime: process.uptime(),
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// WebSocket server attached to the HTTP server
const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_MESSAGE_SIZE,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 3 },
    threshold: 256,
  },
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[RELAY] THETA172 Cloud Relay listening on port ${PORT}`);
  console.log(`[RELAY] Health check: http://0.0.0.0:${PORT}/`);
});

wss.on('listening', () => {
  console.log(`[RELAY] Listening on ws://0.0.0.0:${PORT}`);
  console.log(`[RELAY] Max rooms: ${MAX_ROOMS}, max viewers/room: ${MAX_VIEWERS_PER_ROOM}`);
});

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  ws._relayIp = ip;
  ws._relayRole = null;    // 'host' or 'viewer'
  ws._relayRoom = null;    // room key
  ws._relayId = null;      // viewer ID
  ws._relayAlive = true;

  ws.on('message', (rawData) => {
    try {
      const str = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
      const msg = JSON.parse(str);

      if (!msg || !msg.type) return;

      switch (msg.type) {
        case RELAY.CREATE:
          handleCreate(ws, msg);
          break;

        case RELAY.JOIN:
          handleJoin(ws, msg);
          break;

        case RELAY.LEAVE:
          handleLeave(ws);
          break;

        default:
          // Forward all other messages through the relay
          handleForward(ws, str);
          break;
      }
    } catch (err) {
      console.warn(`[RELAY] Parse error from ${ip}: ${err.message}`);
    }
  });

  ws.on('close', () => {
    handleLeave(ws);
  });

  ws.on('error', () => {
    handleLeave(ws);
  });

  ws.on('pong', () => {
    ws._relayAlive = true;
  });
});


// ══════════════════════════════════════════════════════════════════
// HANDLERS
// ══════════════════════════════════════════════════════════════════

/**
 * Host creates a room.
 * Payload: { roomKey, hostName, password? }
 */
function handleCreate(ws, msg) {
  const roomKey = msg.payload?.roomKey;
  const hostName = msg.payload?.hostName || 'Host';

  if (!roomKey || typeof roomKey !== 'string') {
    sendRelay(ws, RELAY.ERROR, { reason: 'Missing room key' });
    return;
  }

  if (rooms.size >= MAX_ROOMS) {
    sendRelay(ws, RELAY.ERROR, { reason: 'Server full. Max rooms reached.' });
    return;
  }

  if (rooms.has(roomKey)) {
    sendRelay(ws, RELAY.ERROR, { reason: 'Room already exists' });
    return;
  }

  const room = {
    roomKey,
    host: ws,
    hostName,
    viewers: new Map(),
    lastActivity: Date.now(),
  };

  rooms.set(roomKey, room);
  ws._relayRole = 'host';
  ws._relayRoom = roomKey;

  sendRelay(ws, RELAY.CREATED, {
    roomKey,
    hostName,
    message: 'Room created on relay',
  });

  console.log(`[RELAY] Room ${roomKey} created by ${hostName} (${ws._relayIp}) -- ${rooms.size} active rooms`);
}


/**
 * Viewer joins a room.
 * Payload: { roomKey, name, clientId }
 */
function handleJoin(ws, msg) {
  const roomKey = msg.payload?.roomKey;
  const name = msg.payload?.name || 'Viewer';
  const clientId = msg.payload?.clientId || generateId();

  if (!roomKey || typeof roomKey !== 'string') {
    sendRelay(ws, RELAY.ERROR, { reason: 'Missing room key' });
    return;
  }

  const room = rooms.get(roomKey);
  if (!room) {
    sendRelay(ws, RELAY.ERROR, { reason: 'Room not found' });
    return;
  }

  if (room.viewers.size >= MAX_VIEWERS_PER_ROOM) {
    sendRelay(ws, RELAY.ERROR, { reason: 'Room full' });
    return;
  }

  room.viewers.set(clientId, { ws, name });
  room.lastActivity = Date.now();
  ws._relayRole = 'viewer';
  ws._relayRoom = roomKey;
  ws._relayId = clientId;

  // Notify viewer they joined
  sendRelay(ws, RELAY.JOINED, {
    roomKey,
    hostName: room.hostName,
    clientId,
    viewerCount: room.viewers.size,
  });

  // Notify host that a viewer joined (forward as a regular message)
  // The host's collab server logic handles JOIN messages
  forwardToHost(room, JSON.stringify(msg));

  console.log(`[RELAY] ${name} (${clientId}) joined ${roomKey} -- ${room.viewers.size} viewers`);
}


/**
 * Handle participant leaving (close or explicit leave).
 */
function handleLeave(ws) {
  const roomKey = ws._relayRoom;
  if (!roomKey) return;

  const room = rooms.get(roomKey);
  if (!room) {
    ws._relayRoom = null;
    return;
  }

  if (ws._relayRole === 'host') {
    // Host left: close entire room
    console.log(`[RELAY] Host left room ${roomKey} -- closing room`);

    // Notify all viewers
    for (const [, viewer] of room.viewers) {
      sendRelay(viewer.ws, RELAY.ERROR, { reason: 'Host disconnected' });
      try { viewer.ws.close(1000, 'Host left'); } catch (_) {}
    }

    rooms.delete(roomKey);
  } else if (ws._relayRole === 'viewer') {
    const clientId = ws._relayId;

    if (clientId && room.viewers.has(clientId)) {
      const viewer = room.viewers.get(clientId);
      room.viewers.delete(clientId);
      room.lastActivity = Date.now();

      // Notify host that viewer left
      const leaveMsg = JSON.stringify({
        type: 'leave',
        payload: { clientId, name: viewer?.name || 'Viewer' },
        senderId: clientId,
      });
      forwardToHost(room, leaveMsg);

      console.log(`[RELAY] Viewer ${clientId} left ${roomKey} -- ${room.viewers.size} remaining`);
    }
  }

  ws._relayRoom = null;
  ws._relayRole = null;
  ws._relayId = null;
}


/**
 * Forward a message through the relay.
 * Host -> all viewers.
 * Viewer -> host only.
 */
function handleForward(ws, rawMsg) {
  const roomKey = ws._relayRoom;
  if (!roomKey) return;

  const room = rooms.get(roomKey);
  if (!room) return;

  room.lastActivity = Date.now();

  if (ws._relayRole === 'host') {
    // Host sends -> broadcast to all viewers
    for (const [, viewer] of room.viewers) {
      safeSend(viewer.ws, rawMsg);
    }
  } else if (ws._relayRole === 'viewer') {
    // Viewer sends -> forward to host
    forwardToHost(room, rawMsg);
  }
}


// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

function sendRelay(ws, type, payload) {
  safeSend(ws, JSON.stringify({ type, payload }));
}

function safeSend(ws, data) {
  try {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(data);
    }
  } catch (_) {}
}

function forwardToHost(room, data) {
  if (room.host && room.host.readyState === 1) {
    safeSend(room.host, data);
  }
}

function generateId() {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}


// ══════════════════════════════════════════════════════════════════
// HEARTBEAT + CLEANUP
// ══════════════════════════════════════════════════════════════════

// Ping all clients to detect dead connections
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws._relayAlive) {
      ws.terminate();
      return;
    }
    ws._relayAlive = false;
    try { ws.ping(); } catch (_) {}
  });
}, HEARTBEAT_INTERVAL);

// Clean up idle rooms
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, room] of rooms) {
    if (now - room.lastActivity > ROOM_IDLE_TIMEOUT) {
      console.log(`[RELAY] Room ${key} expired (idle ${Math.round((now - room.lastActivity) / 60000)}min)`);

      // Notify host
      sendRelay(room.host, RELAY.ERROR, { reason: 'Room expired due to inactivity' });
      try { room.host.close(1000, 'Room expired'); } catch (_) {}

      // Notify viewers
      for (const [, viewer] of room.viewers) {
        sendRelay(viewer.ws, RELAY.ERROR, { reason: 'Room expired' });
        try { viewer.ws.close(1000, 'Room expired'); } catch (_) {}
      }

      rooms.delete(key);
    }
  }
}, 60000); // Check every minute

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[RELAY] Shutting down...');
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  wss.close(() => {
    httpServer.close(() => {
      console.log('[RELAY] Server closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('[RELAY] Interrupted, shutting down...');
  clearInterval(heartbeatTimer);
  clearInterval(cleanupTimer);
  wss.close(() => {
    httpServer.close(() => process.exit(0));
  });
});
