'use strict';

const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');

const PORT = Number(process.env.PORT || 1234);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('FreemanNotes Yjs WebSocket backend is running.\n');
});

server.on('error', (error) => {
  console.error('[ws-server] HTTP error:', error);
});

const wss = new WebSocket.Server({ server });

wss.on('error', (error) => {
  console.error('[ws-server] WebSocket server error:', error);
});

wss.on('connection', (conn, req) => {
  const path = req.url || '/';
  // Accept either '/<room>' or '/yjs/<room>' (common reverse-proxy mount point).
  let roomPath = path;
  if (roomPath.startsWith('/')) roomPath = roomPath.slice(1);
  if (roomPath.startsWith('yjs/')) roomPath = roomPath.slice('yjs/'.length);
  const room = roomPath;
  const clientIp = req.socket.remoteAddress || 'unknown';

  console.log(`[ws-server] client connected ip=${clientIp} room=${room || '(default)'}`);

  conn.on('message', (data) => {
    const byteLength = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    console.log(`[ws-server] message room=${room || '(default)'} bytes=${byteLength}`);
  });

  conn.on('close', () => {
    console.log(`[ws-server] client disconnected ip=${clientIp} room=${room || '(default)'}`);
  });

  conn.on('error', (error) => {
    console.error(`[ws-server] ws error room=${room || '(default)'}:`, error);
  });

  setupWSConnection(conn, req, {
    gc: true,
  });
});

server.listen(PORT, () => {
  console.log(`[ws-server] started on ws://localhost:${PORT}`);
  console.log('[ws-server] ready for WebsocketProvider("ws://localhost:1234", room, doc) clients');
});