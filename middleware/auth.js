const jwt = require('jsonwebtoken');

// Verify JWT token
function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
}

// Check if user has specific role
function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// Check if user has specific permission
async function requirePermission(action) {
    return async (req, res, next) => {
        const { pool } = require('../server');

        try {
            const result = await pool.query(
                `SELECT can_perform FROM permissions 
                 WHERE role = $1 AND action = $2`,
                [req.user.role, action]
            );

            if (result.rows.length === 0 || !result.rows[0].can_perform) {
                return res.status(403).json({ error: `Permission denied: ${action}` });
            }

            next();
        } catch (error) {
            return res.status(500).json({ error: 'Permission check failed' });
        }
    };
}

module.exports = { verifyToken, requireRole, requirePermission };
