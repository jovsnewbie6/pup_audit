// ============ EXPRESS SERVER WITH SOCKET.IO ============
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    } 
});

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Import route handlers
const authRoutes = require('./auth');
const auditRoutes = require('./audit');
const permissionsRoutes = require('./permissions');

// ============ ROUTES ============
app.use('/api/auth', authRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/permissions', permissionsRoutes);

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ WEBSOCKET CONNECTIONS ============
io.on('connection', (socket) => {
    console.log('✓ Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('✗ Client disconnected:', socket.id);
    });

    // Handle cell edits
    socket.on('cell_edit', (data) => {
        // Broadcast to other clients
        socket.broadcast.emit('cell_updated', data);
    });
});

// Export for use in other modules (like audit.js)
module.exports = { app, io, server };

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server initialized on port ${PORT}`);
});
