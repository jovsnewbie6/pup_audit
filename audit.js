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
    const { record_name, record_type, data } = req.body;
    // NOTE: serial_number is now generated on the SERVER to ensure uniqueness!
    console.log('📨 POST /audit - Received request to create record');
    console.log('   User ID:', req.user?.id);
    console.log('   User:', req.user?.username);
    console.log('   Record name:', record_name);
    console.log('   Record type:', record_type);
    
    const client = await pool.connect();
    try {
        // Generate unique serial number on server
        const yearStr = new Date().getFullYear().toString();
        const typeIndicator = record_type === 'Reimbursement' ? 'R' : 'L';
        
        // Query for the highest sequence number for this type+year
        const sequenceQuery = await client.query(
            "SELECT COALESCE(MAX(CAST(SUBSTRING(serial_number FROM POSITION(' - ' IN serial_number) + 3) AS INTEGER)), 0) as max_seq FROM audit_records WHERE record_type = $1 AND serial_number LIKE $2",
            [record_type, `%${yearStr}%`]
        );
        
        let nextSequence = (sequenceQuery.rows[0]?.max_seq || 0) + 1;
        let serial_number = `AUD-${typeIndicator}: ${yearStr} - ${String(nextSequence).padStart(4, '0')}`;
        
        // Try up to 5 times in case of collision (shouldn't happen but just in case)
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                await client.query('BEGIN');
                
                let dataForDb = data;
                if (typeof data === 'string') {
                    try { dataForDb = JSON.parse(data); } catch (e) { dataForDb = data; }
                }
                // Ensure data is JSON-serializable for the database
                if (dataForDb && typeof dataForDb === 'object') {
                    dataForDb = JSON.stringify(dataForDb);
                }
                
                console.log('💾 Inserting record into database...');
                console.log('   Serial number:', serial_number);
                
                const newRecord = await client.query(
                    "INSERT INTO audit_records (record_name, record_type, serial_number, data, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
                    [record_name, record_type, serial_number, dataForDb, req.user.id]
                );
                console.log('✅ Record inserted, ID:', newRecord.rows[0].id);
                
                console.log('📝 Logging action...');
                await logAction(client, newRecord.rows[0].id, req.user.id, 'CREATE', 'Initial record creation', null, dataForDb);
                console.log('✅ Action logged');
                
                await client.query('COMMIT');
                
                const recordData = newRecord.rows[0];
                
                // Grab the WebSocket safely from the Express app
                const io = req.app.get('io');
                if (io) {
                    const broadcastData = {
                        id: recordData.id,
                        serial: recordData.serial_number,
                        type: recordData.record_type,
                        name: recordData.record_name,
                        status: recordData.status,
                        date: recordData.created_at ? new Date(recordData.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                        data: recordData.data
                    };
                    
                    console.log('📣 Socket.io: Broadcasting NEW RECORD to all connected browsers');
                    console.log('   Record ID:', broadcastData.id);
                    console.log('   Record Name:', broadcastData.name);
                    console.log('   Serial:', broadcastData.serial);
                    
                    io.emit('recordCreated', broadcastData);
                    console.log('✅ Broadcast complete - sent to', Object.keys(io.sockets.sockets).length, 'connected clients');
                } else {
                    console.error('❌ ERROR: Socket.io instance not available on req.app!');
                }
                
                res.json(recordData);
                return; // Success, exit loop
                
            } catch (innerErr) {
                if (innerErr.message.includes('duplicate key')) {
                    console.log('⚠️ Sequence collision, retrying with next sequence...');
                    nextSequence++;
                    serial_number = `AUD-${typeIndicator}: ${yearStr} - ${String(nextSequence).padStart(4, '0')}`;
                    await client.query('ROLLBACK');
                } else {
                    throw innerErr; // Re-throw if not a duplicate key error
                }
            }
        }
        
        throw new Error('Could not generate unique serial number after 5 attempts');
        
    } catch (err) {
        console.error('❌ ERROR in POST /audit:', err.message);
        console.error('   Stack:', err.stack);
        try {
            await client.query('ROLLBACK');
        } catch (e) {}
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
        if (getOldRecord.rows.length === 0) return res.status(404).json({ error: "Record not found" });
        
        const oldValue = getOldRecord.rows[0];
        const updateQuery = data ? 
            "UPDATE audit_records SET status = $1, data = $2 WHERE id = $3 RETURNING *" :
            "UPDATE audit_records SET status = $1 WHERE id = $2 RETURNING *";
        
        const params = data ? [status, data, req.params.id] : [status, req.params.id];
        const updatedRecord = await client.query(updateQuery, params);
        
        const dataToLog = data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
        await logAction(client, req.params.id, req.user.id, 'UPDATE', comment || `Status changed to ${status}`, oldValue.data, dataToLog);
        await client.query('COMMIT');
        
        // Grab the WebSocket safely from the Express app
        const io = req.app.get('io');
        if (io) {
            console.log('📣 Broadcasting UPDATE to all browsers!');
            console.log('Socket.io instance available. Emitting recordUpdated event.');
            io.emit('recordUpdated', {
                id: updatedRecord.rows[0].id,
                serial: updatedRecord.rows[0].serial_number,
                type: updatedRecord.rows[0].record_type,
                name: updatedRecord.rows[0].record_name,
                status: updatedRecord.rows[0].status,
                // THE FIX: Safely format the date object
                date: updatedRecord.rows[0].created_at ? new Date(updatedRecord.rows[0].created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                data: updatedRecord.rows[0].data,
                comment: comment
            });
        } else {
            console.error('⚠ Socket.io instance not available on req.app!');
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
        
        const io = req.app.get('io');
        if (io) {
            console.log('📣 Broadcasting DELETE to all browsers! Record ID:', record.rows[0].id);
            // Broadcast to ALL users including sender
            io.emit('recordDeleted', { 
                id: record.rows[0].id,
                api_id: record.rows[0].id,
                serial: record.rows[0].serial_number
            });
        } else {
            console.error('⚠ Socket.io instance not available on req.app!');
        }
        
        res.json({ message: "Record moved to bin" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete error:', err);
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
             FROM audit_logs l LEFT JOIN users u ON l.user_id = u.id
             WHERE l.record_id = $1 ORDER BY l.created_at ASC`, [req.params.id]
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
        if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

        const recordExists = await client.query('SELECT id FROM audit_records WHERE id = $1', [req.params.id]);
        if (recordExists.rows.length === 0) return res.status(404).json({ error: 'Record not found' });

        const logResult = await client.query(
            `INSERT INTO audit_logs (record_id, user_id, action, comment, created_at) 
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING id, action, comment, created_at`,
            [req.params.id, req.user.id, 'COMMENT', comment]
        );

        const userResult = await client.query('SELECT username FROM users WHERE id = $1', [req.user.id]);
        const username = userResult.rows[0]?.username || 'Unknown User';

        const io = req.app.get('io');
        if (io) {
            io.emit('logAdded', {
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