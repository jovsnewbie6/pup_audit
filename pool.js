const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
        mode: 'require'
    },
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    max: 20,
    min: 2,
    maxUses: 7200
});

module.exports = pool;
