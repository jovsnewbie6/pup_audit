/**
 * Database Initialization Script
 * Run this ONCE after setting up your PostgreSQL database
 * 
 * Usage: node init-db.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
        mode: 'require'
    }
});

async function initializeDatabase() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 Initializing database...\n');
        
        // ============ CREATE USERS TABLE ============
        console.log('📋 Creating users table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'Staff Auditor',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Users table created/verified\n');

        // ============ CREATE AUDIT_RECORDS TABLE ============
        console.log('📋 Creating audit_records table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_records (
                id SERIAL PRIMARY KEY,
                record_name VARCHAR(255) NOT NULL,
                record_type VARCHAR(50) NOT NULL,
                serial_number VARCHAR(50) UNIQUE NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                data JSONB,
                created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Audit records table created/verified\n');

        // ============ CREATE AUDIT_LOGS TABLE ============
        console.log('📋 Creating audit_logs table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                record_id INTEGER NOT NULL REFERENCES audit_records(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
                action VARCHAR(50) NOT NULL,
                comment TEXT,
                old_value TEXT,
                new_value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Audit logs table created/verified\n');

        // ============ CREATE PERMISSIONS TABLE ============
        console.log('📋 Creating permissions table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS permissions (
                id SERIAL PRIMARY KEY,
                role VARCHAR(50) NOT NULL,
                action VARCHAR(100) NOT NULL,
                can_perform BOOLEAN DEFAULT TRUE,
                UNIQUE(role, action)
            );
        `);
        console.log('✅ Permissions table created/verified\n');

        // ============ INSERT DEFAULT ADMIN ACCOUNT ============
        console.log('🔑 Setting up default admin account...');
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('Admin123', salt);
        
        try {
            await client.query(
                `INSERT INTO users (username, password_hash, role, is_active) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (username) DO NOTHING`,
                ['Admin', hashedPassword, 'Audit Supervisor', true]
            );
            console.log('✅ Admin account ready (username: Admin, password: Admin123)\n');
        } catch (err) {
            if (err.message.includes('duplicate')) {
                console.log('ℹ️  Admin account already exists\n');
            } else {
                throw err;
            }
        }

        // ============ INSERT DEFAULT STAFF ACCOUNT ============
        console.log('🔑 Setting up default staff account...');
        const staffSalt = await bcrypt.genSalt(10);
        const staffHashedPassword = await bcrypt.hash('Staff123', staffSalt);
        
        try {
            await client.query(
                `INSERT INTO users (username, password_hash, role, is_active) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (username) DO NOTHING`,
                ['Staff', staffHashedPassword, 'Staff Auditor', true]
            );
            console.log('✅ Staff account ready (username: Staff, password: Staff123)\n');
        } catch (err) {
            if (err.message.includes('duplicate')) {
                console.log('ℹ️  Staff account already exists\n');
            } else {
                throw err;
            }
        }

        // ============ SETUP DEFAULT PERMISSIONS ============
        console.log('🔐 Setting up default permissions...');
        const permissions = [
            ['Audit Supervisor', 'CREATE_RECORD', true],
            ['Audit Supervisor', 'READ_RECORD', true],
            ['Audit Supervisor', 'UPDATE_RECORD', true],
            ['Audit Supervisor', 'DELETE_RECORD', true],
            ['Audit Supervisor', 'APPROVE_RECORD', true],
            ['Audit Supervisor', 'MANAGE_USERS', true],
            ['Staff Auditor', 'CREATE_RECORD', true],
            ['Staff Auditor', 'READ_RECORD', true],
            ['Staff Auditor', 'UPDATE_RECORD', true],
            ['Staff Auditor', 'DELETE_RECORD', false],
            ['Staff Auditor', 'APPROVE_RECORD', false],
            ['Staff Auditor', 'MANAGE_USERS', false]
        ];

        for (const [role, action, canPerform] of permissions) {
            await client.query(
                `INSERT INTO permissions (role, action, can_perform) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (role, action) DO UPDATE SET can_perform = $3`,
                [role, action, canPerform]
            );
        }
        console.log('✅ Default permissions configured\n');

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✨ DATABASE INITIALIZATION COMPLETE!\n');
        console.log('🔐 Default Accounts Created:');
        console.log('   Admin:');
        console.log('      Username: Admin');
        console.log('      Password: Admin123');
        console.log('      Role: Audit Supervisor\n');
        console.log('   Staff:');
        console.log('      Username: Staff');
        console.log('      Password: Staff123');
        console.log('      Role: Staff Auditor\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n🚀 You can now start the server with: npm start\n');

    } catch (error) {
        console.error('❌ Database initialization failed:');
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

initializeDatabase();
