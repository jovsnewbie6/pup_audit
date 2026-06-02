require('dotenv').config();
const { Pool } = require('pg');

console.log('Testing database connection...');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✓ Set' : '✗ Not set');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 5000
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('✗ Database connection failed:');
        console.error('Error:', err.message);
        console.error('Code:', err.code);
        process.exit(1);
    } else {
        console.log('✓ Database connected successfully!');
        console.log('Server time:', res.rows[0]);
        process.exit(0);
    }
});
