const express = require('express');
const { pool } = require('../server');
const { verifyToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Create audit record
router.post('/records', verifyToken, async (req, res) => {
    try {
        const permission = await requirePermission('create_record')(req, res, () => {});
        
        const { record_name, record_type, serial_number } = req.body;

        if (!record_name || !record_type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!['Reimbursement', 'Liquidation'].includes(record_type)) {
            return res.status(400).json({ error: 'Invalid record type' });
        }

        const result = await pool.query(
            `INSERT INTO audit_records (record_name, record_type, serial_number, created_by) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, record_name, record_type, serial_number, status, created_at`,
            [record_name, record_type, serial_number, req.user.id]
        );

        // Log creation
        await pool.query(
            'INSERT INTO audit_logs (record_id, user_id, action, comment) VALUES ($1, $2, $3, $4)',
            [result.rows[0].id, req.user.id, 'record_created', `Created ${record_type} record`]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all audit records
router.get('/records', verifyToken, async (req, res) => {
    try {
        const { type, year } = req.query;
        let query = 'SELECT * FROM audit_records WHERE is_deleted = false';
        let params = [];

        if (type) {
            query += ` AND record_type = $${params.length + 1}`;
            params.push(type);
        }

        if (year) {
            query += ` AND EXTRACT(YEAR FROM created_at) = $${params.length + 1}`;
            params.push(year);
        }

        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single record
router.get('/records/:recordId', verifyToken, async (req, res) => {
    try {
        const { recordId } = req.params;

        const result = await pool.query(
            'SELECT * FROM audit_records WHERE id = $1 AND is_deleted = false',
            [recordId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update record
router.put('/records/:recordId', verifyToken, async (req, res) => {
    try {
        const { recordId } = req.params;
        const { status } = req.body;

        // Check permission
        await requirePermission('update_record')(req, res, () => {});

        const updateResult = await pool.query(
            'UPDATE audit_records SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND is_deleted = false RETURNING *',
            [status, recordId]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // Log update
        await pool.query(
            'INSERT INTO audit_logs (record_id, user_id, action, old_value, new_value) VALUES ($1, $2, $3, $4, $5)',
            [recordId, req.user.id, 'status_updated', req.body.old_status, status]
        );

        res.json(updateResult.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete record (soft delete)
router.delete('/records/:recordId', verifyToken, async (req, res) => {
    try {
        const { recordId } = req.params;

        // Check permission
        await requirePermission('delete_record')(req, res, () => {});

        const result = await pool.query(
            'UPDATE audit_records SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
            [recordId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // Log deletion
        await pool.query(
            'INSERT INTO audit_logs (record_id, user_id, action, comment) VALUES ($1, $2, $3, $4)',
            [recordId, req.user.id, 'record_deleted', 'Record moved to recycle bin']
        );

        res.json({ message: 'Record deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get audit log for record
router.get('/records/:recordId/log', verifyToken, async (req, res) => {
    try {
        const { recordId } = req.params;

        const result = await pool.query(
            `SELECT al.*, u.username FROM audit_logs al
             JOIN users u ON al.user_id = u.id
             WHERE al.record_id = $1
             ORDER BY al.created_at DESC`,
            [recordId]
        );

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get records by status
router.get('/records/status/:status', verifyToken, async (req, res) => {
    try {
        const { status } = req.params;

        if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const result = await pool.query(
            'SELECT * FROM audit_records WHERE status = $1 AND is_deleted = false ORDER BY created_at DESC',
            [status]
        );

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
