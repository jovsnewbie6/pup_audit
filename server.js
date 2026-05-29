const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const initDB = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Drop tables if they exist (in reverse order of creation due to foreign keys)
        await client.query('DROP TABLE IF EXISTS audit_logs CASCADE');
        await client.query('DROP TABLE IF EXISTS audit_records CASCADE');
        await client.query('DROP TABLE IF EXISTS permissions CASCADE');
        await client.query('DROP TABLE IF EXISTS users CASCADE');
        
        await client.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE audit_records (
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

        await client.query(`
            CREATE TABLE audit_logs (
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

        await client.query(`
            CREATE TABLE permissions (
                id SERIAL PRIMARY KEY,
                role VARCHAR(50) NOT NULL,
                action VARCHAR(100) NOT NULL,
                can_perform BOOLEAN DEFAULT false,
                UNIQUE (role, action)
            );
        `);

        const adminCheck = await client.query("SELECT * FROM users WHERE username = 'admin'");
        if (adminCheck.rows.length === 0) {
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash('admin123', salt);
            await client.query(
                "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)",
                ['admin', hash, 'Audit Supervisor']
            );
            console.log('Default Audit Supervisor (admin) created.');
        }

        await client.query('COMMIT');
        console.log('✓ Database initialized successfully.');
        
        // Register routes after database is ready
        const authRoutes = require('./auth');
        const auditRoutes = require('./audit');
        const permissionRoutes = require('./permissions');

        app.use('/api/auth', authRoutes);
        app.use('/api/audit', auditRoutes);
        app.use('/api/permissions', permissionRoutes);

        app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => {
            console.log(`✓ Server running on port ${PORT}`);
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('✗ Database initialization failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
    }
};

initDB();