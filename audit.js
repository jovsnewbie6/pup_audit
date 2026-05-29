const express = require('express');
const router = express.Router();
const pool = require('./pool');
const { authenticateToken, requireRole } = require('./middleware');

const logAction = async (client, recordId, userId, action, comment, oldVal, newVal) => {
    await client.query(
        "INSERT INTO audit_logs (record_id, user_id, action, comment, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)",
        [recordId, userId, action, comment, oldVal, newVal]
    );
};

router.post('/', authenticateToken, async (req, res) => {
    const { record_name, record_type, serial_number, data } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const newRecord = await client.query(
            "INSERT INTO audit_records (record_name, record_type, serial_number, data, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [record_name, record_type, serial_number, data, req.user.id]
        );
        await logAction(client, newRecord.rows[0].id, req.user.id, 'CREATE', 'Initial record creation', null, data);
        await client.query('COMMIT');
        res.json(newRecord.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const records = await pool.query("SELECT * FROM audit_records WHERE is_deleted = false ORDER BY created_at DESC");
        res.json(records.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', authenticateToken, requireRole('Audit Supervisor'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const record = await client.query("UPDATE audit_records SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *", [req.params.id]);
        if(record.rows.length === 0) return res.status(404).json({error: "Not found"});
        await logAction(client, req.params.id, req.user.id, 'DELETE', 'Moved to bin', null, null);
        await client.query('COMMIT');
        res.json({ message: "Record moved to bin" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;