/**
 * Database Auto-Initialization Module
 * Runs once on server startup - creates tables & default accounts if they don't exist
 * Safe to run multiple times - only creates missing tables/accounts
 */

const pool = require('./pool');
const bcrypt = require('bcryptjs');

async function initializeDatabaseOnStartup() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 Checking database...');
        
        // Check if users table exists
        const tableCheck = await client.query(`
            SELECT EXISTS(
                SELECT 1 FROM information_schema.tables 
                WHERE table_name = 'users'
            );
        `);
        
        if (tableCheck.rows[0].exists) {
            console.log('✅ Database already initialized');
            return;
        }
        
        console.log('📋 Creating tables...');
        
        // ============ CREATE USERS TABLE ============
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

        // ============ CREATE AUDIT_RECORDS TABLE ============
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

        // ============ CREATE AUDIT_LOGS TABLE ============
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

        // ============ CREATE PERMISSIONS TABLE ============
        await client.query(`
            CREATE TABLE IF NOT EXISTS permissions (
                id SERIAL PRIMARY KEY,
                role VARCHAR(50) NOT NULL,
                action VARCHAR(100) NOT NULL,
                can_perform BOOLEAN DEFAULT TRUE,
                UNIQUE(role, action)
            );
        `);

        console.log('✅ Tables created');

        // ============ INSERT DEFAULT ACCOUNTS ============
        console.log('🔑 Creating default accounts...');
        
        const salt = await bcrypt.genSalt(10);
        const adminHash = await bcrypt.hash('Admin123', salt);
        const staffHash = await bcrypt.hash('Staff123', salt);
        
        await client.query(
            `INSERT INTO users (username, password_hash, role, is_active) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (username) DO NOTHING`,
            ['Admin', adminHash, 'Audit Supervisor', true]
        );
        
        await client.query(
            `INSERT INTO users (username, password_hash, role, is_active) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (username) DO NOTHING`,
            ['Staff', staffHash, 'Staff Auditor', true]
        );

        console.log('✅ Default accounts created (Admin / Staff)');

        // ============ SETUP DEFAULT PERMISSIONS ============
        console.log('🔐 Setting up permissions...');
        
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

        console.log('✅ Permissions configured');
        console.log('\n✨ DATABASE INITIALIZATION COMPLETE!\n');
        console.log('🔐 You can now login with:');
        console.log('   Admin: username "Admin", password "Admin123"');
        console.log('   Staff: username "Staff", password "Staff123"\n');

    } catch (error) {
        console.error('❌ Database initialization error:', error.message);
        // Don't exit - let the server continue even if init fails
        // (might be a temporary connection issue)
    } finally {
        client.release();
    }
}

module.exports = { initializeDatabaseOnStartup };
