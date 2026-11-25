const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', (room, callback) => {
    const roomName = String(room || '').trim().toUpperCase()
      .replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!roomName) return callback?.({ ok: false, error: 'Invalid room code' });

    const members = rooms.get(roomName) || new Set();
    if (members.size >= 2 && !members.has(socket.id)) {
      return callback?.({ ok: false, error: 'This room is full' });
    }

    members.add(socket.id);
    rooms.set(roomName, members);
    socket.join(roomName);
    socket.data.room = roomName;

    const peerId = [...members].find((id) => id !== socket.id);
    callback?.({ ok: true, room: roomName, peerId: peerId || null });
    if (peerId) io.to(peerId).emit('peer-ready', socket.id);
  });

  socket.on('signal', (room, payload) => {
    socket.to(String(room)).emit('signal', payload);
  });

  socket.on('disconnect', () => {
    const roomName = socket.data.room;
    if (!roomName) return;
    const members = rooms.get(roomName);
    if (!members) return;
    members.delete(socket.id);
    if (members.size === 0) rooms.delete(roomName);
    else io.to(roomName).emit('peer-left');
  });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Wi-Fi file transfer app listening on http://0.0.0.0:${port}`);
});
