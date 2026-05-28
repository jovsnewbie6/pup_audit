const express = require('express');
const { pool } = require('../server');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get role-based permissions (Audit Supervisor only)
router.get('/role/:role', verifyToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const { role } = req.params;

        if (!['Audit Supervisor', 'Staff Auditor'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const result = await pool.query(
            `SELECT id, role, action, can_perform FROM permissions WHERE role = $1 ORDER BY action`,
            [role]
        );

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update permission for a role (Audit Supervisor only)
router.put('/role/:role/:action', verifyToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const { role, action } = req.params;
        const { can_perform } = req.body;

        if (!['Audit Supervisor', 'Staff Auditor'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const result = await pool.query(
            `UPDATE permissions SET can_perform = $1 WHERE role = $2 AND action = $3 RETURNING id, role, action, can_perform`,
            [can_perform, role, action]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Permission not found' });
        }

        // Log the action
        await pool.query(
            'INSERT INTO audit_logs (user_id, action, comment) VALUES ($1, $2, $3)',
            [req.user.id, 'permission_updated', `Updated ${role} permission for ${action} to ${can_perform}`]
        );

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user permissions
router.get('/user/:userId', verifyToken, async (req, res) => {
    try {
        const { userId } = req.params;

        // Can only view own permissions unless Audit Supervisor
        if (req.user.id != userId && req.user.role !== 'Audit Supervisor') {
            return res.status(403).json({ error: 'Permission denied' });
        }

        const result = await pool.query(
            `SELECT p.id, p.role, p.action, p.can_perform, up.assigned_at 
             FROM permissions p
             LEFT JOIN user_permissions up ON p.id = up.permission_id
             LEFT JOIN users u ON u.id = up.user_id
             WHERE (u.id = $1 OR p.role = (SELECT role FROM users WHERE id = $1))
             ORDER BY p.action`,
            [userId]
        );

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all permissions summary
router.get('/summary', verifyToken, requireRole('Audit Supervisor'), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT role, COUNT(*) as total, 
                   SUM(CASE WHEN can_perform = true THEN 1 ELSE 0 END) as granted
            FROM permissions
            GROUP BY role
        `);

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
