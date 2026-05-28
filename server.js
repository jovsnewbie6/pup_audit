const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { Pool } = require('pg');
const path = require('path'); // Add this near the top with your other requires

app.use(express.static(__dirname));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Import routes
const authRoutes = require('./routes/auth');
const permissionsRoutes = require('./routes/permissions');
const auditRoutes = require('./routes/audit');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/audit', auditRoutes);

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Initialize database and start server
async function initializeDatabase() {
    try {
        // Check connection
        const result = await pool.query('SELECT NOW()');
        console.log('✓ Database connected:', result.rows[0]);

        // Create tables if they don't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL CHECK (role IN ('Audit Supervisor', 'Staff Auditor')),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS permissions (
                id SERIAL PRIMARY KEY,
                role VARCHAR(50) NOT NULL CHECK (role IN ('Audit Supervisor', 'Staff Auditor')),
                action VARCHAR(100) NOT NULL,
                can_perform BOOLEAN DEFAULT false,
                PRIMARY KEY (role, action)
            );

            CREATE TABLE IF NOT EXISTS user_permissions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                assigned_by INTEGER REFERENCES users(id),
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, permission_id)
            );

            CREATE TABLE IF NOT EXISTS audit_records (
                id SERIAL PRIMARY KEY,
                record_name VARCHAR(255) NOT NULL,
                record_type VARCHAR(50) NOT NULL CHECK (record_type IN ('Reimbursement', 'Liquidation')),
                serial_number VARCHAR(100) UNIQUE,
                status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
                created_by INTEGER NOT NULL REFERENCES users(id),
                assigned_to INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP,
                is_deleted BOOLEAN DEFAULT false
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                record_id INTEGER NOT NULL REFERENCES audit_records(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                action VARCHAR(100) NOT NULL,
                comment TEXT,
                old_value TEXT,
                new_value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_audit_records_status ON audit_records(status);
            CREATE INDEX IF NOT EXISTS idx_audit_records_created_by ON audit_records(created_by);
        `);

        // Create default roles and permissions
        await pool.query(`
            DELETE FROM permissions WHERE role IN ('Audit Supervisor', 'Staff Auditor');
            
            INSERT INTO permissions (role, action, can_perform) VALUES
            ('Audit Supervisor', 'create_record', true),
            ('Audit Supervisor', 'read_record', true),
            ('Audit Supervisor', 'update_record', true),
            ('Audit Supervisor', 'delete_record', true),
            ('Audit Supervisor', 'approve_record', true),
            ('Audit Supervisor', 'assign_record', true),
            ('Audit Supervisor', 'manage_permissions', true),
            ('Audit Supervisor', 'view_audit_log', true),
            ('Audit Supervisor', 'export_data', true),
            ('Audit Supervisor', 'backup_database', true),
            ('Staff Auditor', 'create_record', true),
            ('Staff Auditor', 'read_record', true),
            ('Staff Auditor', 'update_record', true),
            ('Staff Auditor', 'delete_record', false),
            ('Staff Auditor', 'approve_record', false),
            ('Staff Auditor', 'assign_record', false),
            ('Staff Auditor', 'manage_permissions', false),
            ('Staff Auditor', 'view_audit_log', false),
            ('Staff Auditor', 'export_data', false),
            ('Staff Auditor', 'backup_database', false)
            ON CONFLICT DO NOTHING;
        `);

        // Create default admin user if it doesn't exist
        const bcrypt = require('bcryptjs');
        const adminExists = await pool.query('SELECT * FROM users WHERE username = $1', ['Admin']);
        
        if (adminExists.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('Admin123', 10);
            await pool.query(
                'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)',
                ['Admin', 'admin@pup-audit.local', hashedPassword, 'Audit Supervisor']
            );
            console.log('✓ Default admin user created (Admin / Admin123)');
        }

        console.log('✓ Database initialized successfully');
    } catch (error) {
        console.error('✗ Database initialization failed:', error.message);
        process.exit(1);
    }
}

// Start server
app.listen(PORT, async () => {
    await initializeDatabase();
    console.log(`✓ Server running on http://localhost:${PORT}`);
});

module.exports = { pool };
