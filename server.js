const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.set('io', io);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============ REGISTER ROUTES FIRST ============
const authRoutes = require('./auth');
const auditRoutes = require('./audit');
const permissionRoutes = require('./permissions');

app.use('/api/auth', authRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/permissions', permissionRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('✗ Server error:', err.message);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ START SERVER AND WEBSOCKET ============
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
});

io.on('connection', (socket) => {
    console.log('🔗 New client connected via WebSocket');
    console.log('   Socket ID:', socket.id);
    console.log('   Total connected clients:', Object.keys(io.sockets.sockets).length);

    // ---> NEW: Instant Google-Docs style cell relay <---
    socket.on('cell_edit', (data) => {
        socket.broadcast.emit('cell_updated', data);
    });

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
        console.log('   Remaining connected clients:', Object.keys(io.sockets.sockets).length);
    });
});

const initDB = async () => {
    if (!pool || typeof pool.connect !== 'function') {
        console.error('✗ Database pool not initialized');
        setTimeout(() => initDB(), 100);
        return;
    }

    const client = await pool.connect();
    try {
        console.log('Initializing database tables safely...');
        
        // Create users table safely
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create audit_records table safely
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_records (
                id SERIAL PRIMARY KEY,
                record_name VARCHAR(255) NOT NULL,
                record_type VARCHAR(50) NOT NULL,
                serial_number VARCHAR(100) UNIQUE NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                data JSONB,
                created_by INTEGER REFERENCES users(id),
                is_deleted BOOLEAN DEFAULT false,
                deleted_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create audit_logs table safely
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                record_id INTEGER REFERENCES audit_records(id),
                user_id INTEGER REFERENCES users(id),
                action VARCHAR(100) NOT NULL,
                comment TEXT,
                old_value JSONB,
                new_value JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create permissions table safely
        await client.query(`
            CREATE TABLE IF NOT EXISTS permissions (
                id SERIAL PRIMARY KEY,
                role VARCHAR(50) NOT NULL,
                action VARCHAR(100) NOT NULL,
                can_perform BOOLEAN DEFAULT false,
                UNIQUE (role, action)
            );
        `);

        // Create default admin user
        const adminCheck = await client.query("SELECT * FROM users WHERE username = 'admin'");
        if (adminCheck.rows.length === 0) {
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash('admin123', salt);
            await client.query(
                "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)",
                ['admin', hash, 'Audit Supervisor']
            );
            console.log('✓ Default Audit Supervisor (admin) created.');
        }

        console.log('✓ Database initialized successfully.');
    } catch (err) {
        console.error('✗ Database initialization failed:', err.message);
    } finally {
        client.release();
    }
};

// Test database connection first
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('✗ Database connection failed:', err.message);
    } else {
        console.log('✓ Database connected:', res.rows[0]);
        initDB();
    }
});

// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('✗ Uncaught Exception:', err);
    console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('✗ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Export io for other modules to use for broadcasting
module.exports = { app, io, server };