const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db'); // <-- Fixed this from './pool'
const { authenticateToken, requireRole } = require('./middleware');

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE username = $1 AND is_active = true", [username]);
        if (userResult.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });

        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: user.role, username: user.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/register', authenticateToken, requireRole('Audit Supervisor'), async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        
        const newUser = await pool.query(
            "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role",
            [username, hash, role]
        );
        res.json(newUser.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Username might already exist or server error.' });
    }
});

router.post('/change-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const userResult = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
        if (!userResult.rows[0]) return res.status(404).json({ error: 'User not found' });
        
        const validPassword = await bcrypt.compare(oldPassword, userResult.rows[0].password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Invalid old password' });

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPassword, salt);
        await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);
        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/me', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query("SELECT id, username, role FROM users WHERE id = $1", [req.user.id]);
        res.json(userResult.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/users', authenticateToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const users = await pool.query("SELECT id, username, role, is_active, created_at FROM users");
        res.json(users.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/deactivate-user/:userId', authenticateToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        await pool.query("UPDATE users SET is_active = false WHERE id = $1", [req.params.userId]);
        res.json({ message: 'User deactivated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ADMIN: FORCE RESET STAFF PASSWORD ---
router.post('/admin-reset-password/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const tempPassword = 'temp123'; // The default temporary password
        
        // Encrypt the new temporary password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(tempPassword, salt);
        
        // Update it in the database
        await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2', 
            [hashedPassword, userId]
        );
        
        res.json({ message: 'Password reset to temp123' });
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ error: 'Server error resetting password' });
    }
});

// Fetch active usernames for the login dropdown (No passwords exposed!)
router.get('/public-users', async (req, res) => {
    try {
        const result = await pool.query('SELECT username FROM users WHERE is_active = true ORDER BY username ASC');
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching public users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

module.exports = router;