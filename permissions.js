const express = require('express');
const router = express.Router();
const pool = require('./pool');
const { authenticateToken, requireRole } = require('./middleware');

router.get('/role/:role', authenticateToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const perms = await pool.query("SELECT * FROM permissions WHERE role = $1", [req.params.role]);
        res.json(perms.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/role/:role/:action', authenticateToken, requireRole('Audit Supervisor'), async (req, res) => {
    const { can_perform } = req.body;
    try {
        const updated = await pool.query(
            "INSERT INTO permissions (role, action, can_perform) VALUES ($1, $2, $3) ON CONFLICT (role, action) DO UPDATE SET can_perform = $3 RETURNING *",
            [req.params.role, req.params.action, can_perform]
        );
        res.json(updated.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/user/:userId', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query("SELECT role FROM users WHERE id = $1", [req.params.userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: "User not found" });
        
        const perms = await pool.query("SELECT * FROM permissions WHERE role = $1", [userResult.rows[0].role]);
        res.json(perms.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/summary', authenticateToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const perms = await pool.query("SELECT * FROM permissions ORDER BY role, action");
        res.json(perms.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;