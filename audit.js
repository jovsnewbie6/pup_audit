const express = require('express');
const router = express.Router();
const pool = require('./pool');
const { authenticateToken, requireRole } = require('./middleware');

// io will be set by server.js after initialization
let io = null;

function setIo(ioInstance) {
    io = ioInstance;
}

function getIo() {
    return io;
}

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
        
        // Handle data field - convert string to object if needed
        let dataForDb = data;
        if (typeof data === 'string') {
            try {
                dataForDb = JSON.parse(data);
            } catch (e) {
                // If it's not valid JSON, use it as-is
                dataForDb = data;
            }
        }
        
        const newRecord = await client.query(
            "INSERT INTO audit_records (record_name, record_type, serial_number, data, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [record_name, record_type, serial_number, dataForDb, req.user.id]
        );
        await logAction(client, newRecord.rows[0].id, req.user.id, 'CREATE', 'Initial record creation', null, dataForDb);
        await client.query('COMMIT');
        
        const recordData = newRecord.rows[0];
        
        // Broadcast the new record to all connected clients
        const ioInstance = getIo();
        if (ioInstance) {
            ioInstance.emit('recordCreated', {
                id: recordData.id,
                serial: recordData.serial_number,
                type: recordData.record_type,
                name: recordData.record_name,
                status: recordData.status,
                date: recordData.created_at ? recordData.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
                data: recordData.data
            });
        }
        
        res.json(recordData);
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

router.put('/:id', authenticateToken, async (req, res) => {
    const { status, data, comment } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const getOldRecord = await client.query("SELECT * FROM audit_records WHERE id = $1", [req.params.id]);
        if (getOldRecord.rows.length === 0) {
            return res.status(404).json({ error: "Record not found" });
        }
        
        const oldValue = getOldRecord.rows[0];
        const updateQuery = data ? 
            "UPDATE audit_records SET status = $1, data = $2 WHERE id = $3 RETURNING *" :
            "UPDATE audit_records SET status = $1 WHERE id = $2 RETURNING *";
        
        const params = data ? [status, data, req.params.id] : [status, req.params.id];
        const updatedRecord = await client.query(updateQuery, params);
        
        // Log the action - convert data to proper format for logging
        const dataToLog = data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
        await logAction(client, req.params.id, req.user.id, 'UPDATE', comment || `Status changed to ${status}`, oldValue.data, dataToLog);
        await client.query('COMMIT');
        
        // Broadcast the update to all connected clients
        const ioInstance = getIo();
        if (ioInstance) {
            ioInstance.emit('recordUpdated', {
                id: updatedRecord.rows[0].id,
                serial: updatedRecord.rows[0].serial_number,
                type: updatedRecord.rows[0].record_type,
                name: updatedRecord.rows[0].record_name,
                status: updatedRecord.rows[0].status,
                date: updatedRecord.rows[0].created_at ? updatedRecord.rows[0].created_at.split('T')[0] : new Date().toISOString().split('T')[0],
                data: updatedRecord.rows[0].data,
                comment: comment
            });
        }
        
        res.json(updatedRecord.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
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
        
        // Broadcast the deletion to all connected clients
        const ioInstance = getIo();
        if (ioInstance) {
            ioInstance.emit('recordDeleted', {
                id: req.params.id
            });
        }
        
        res.json({ message: "Record moved to bin" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============ GET AUDIT LOGS FOR A RECORD ============
router.get('/:id/logs', authenticateToken, async (req, res) => {
    try {
        const logs = await pool.query(
            `SELECT l.id, l.action, l.comment, l.created_at, u.username, l.old_value, l.new_value 
             FROM audit_logs l
             LEFT JOIN users u ON l.user_id = u.id
             WHERE l.record_id = $1
             ORDER BY l.created_at ASC`,
            [req.params.id]
        );
        res.json(logs.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ ADD COMMENT/LOG TO A RECORD ============
router.post('/:id/logs', authenticateToken, async (req, res) => {
    const { comment } = req.body;
    const client = await pool.connect();
    try {
        if (!comment || !comment.trim()) {
            return res.status(400).json({ error: 'Comment cannot be empty' });
        }

        // Verify record exists
        const recordExists = await client.query('SELECT id FROM audit_records WHERE id = $1', [req.params.id]);
        if (recordExists.rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // Add the log
        const logResult = await client.query(
            `INSERT INTO audit_logs (record_id, user_id, action, comment, created_at) 
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
             RETURNING id, action, comment, created_at`,
            [req.params.id, req.user.id, 'COMMENT', comment]
        );

        // Get username for broadcast
        const userResult = await client.query('SELECT username FROM users WHERE id = $1', [req.user.id]);
        const username = userResult.rows[0]?.username || 'Unknown User';

        // Broadcast new comment to all connected clients
        const ioInstance = getIo();
        if (ioInstance) {
            ioInstance.emit('logAdded', {
                recordId: parseInt(req.params.id),
                log: {
                    id: logResult.rows[0].id,
                    action: logResult.rows[0].action,
                    comment: logResult.rows[0].comment,
                    created_at: logResult.rows[0].created_at,
                    username: username
                }
            });
        }

        res.json(logResult.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;
module.exports.setIo = setIo;