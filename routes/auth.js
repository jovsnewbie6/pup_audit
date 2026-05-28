const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../server');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Register new user (Audit Supervisor only can register Staff Auditors)
router.post('/register', verifyToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const { username, email, password, role } = req.body;

        // Validation
        if (!username || !email || !password || !role) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!['Audit Supervisor', 'Staff Auditor'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Check if user already exists
        const userExists = await pool.query(
            'SELECT * FROM users WHERE username = $1 OR email = $2',
            [username, email]
        );

        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
            [username, email, hashedPassword, role]
        );

        const newUser = result.rows[0];

        // Log the action
        await pool.query(
            'INSERT INTO audit_logs (user_id, action, comment) VALUES ($1, $2, $3)',
            [req.user.id, 'user_created', `Created ${role} user: ${username}`]
        );

        res.status(201).json({
            message: 'User registered successfully',
            user: newUser
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Find user
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1 AND is_active = true',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role,
                email: user.email
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Change password
router.post('/change-password', verifyToken, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'Old and new passwords required' });
        }

        // Get user
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];

        // Verify old password
        const validPassword = await bcrypt.compare(oldPassword, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [hashedPassword, req.user.id]
        );

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get current user info
router.get('/me', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, email, role, is_active, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all users (Audit Supervisor only)
router.get('/users', verifyToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, email, role, is_active, created_at FROM users ORDER BY created_at DESC'
        );

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deactivate user (Audit Supervisor only)
router.post('/deactivate-user/:userId', verifyToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await pool.query(
            'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, username',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User deactivated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
