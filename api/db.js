require('dotenv').config();
const { Pool } = require('pg');

// PostgreSQL Connection Pool Configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'pad_ipd',
  user: process.env.DB_USER || 'pad_app',
  password: process.env.DB_PASSWORD,
  max: 10,                    // Maximum pool size
  idleTimeoutMillis: 30000,   // 30 seconds idle timeout
  connectionTimeoutMillis: 15000, // 15 seconds connection timeout
});

// Query function with parameterized queries
// Parameters are positional: $1, $2, $3, etc.
// Converts array format [{name, type, value}] → [value1, value2, ...]
async function query(queryStr, inputs = []) {
  try {
    // Extract values from input objects (mssql-style → pg-style conversion)
    const params = inputs.map(input => {
      if (input && input.value !== undefined) {
        return input.value;
      }
      return input;
    });

    const result = await pool.query(queryStr, params);

    // Wrap result to maintain compatibility with mssql interface
    // Routes expect result.recordset instead of result.rows
    return {
      recordset: result.rows,
      rowsAffected: [result.rowCount],
    };
  } catch (err) {
    console.error('Database query error:', err.message);
    throw err;
  }
}

// Health check function
async function healthCheck() {
  try {
    const result = await pool.query('SELECT NOW()');
    return !!result.rows;
  } catch (err) {
    console.error('Health check failed:', err.message);
    return false;
  }
}

// Graceful shutdown
async function closePool() {
  await pool.end();
}

// Mock sql object for compatibility with existing code
// PostgreSQL doesn't use explicit type definitions like mssql
const sql = {
  VarChar: (len) => ({type: 'VARCHAR', len}),
  Int: () => ({type: 'INT'}),
  SmallInt: () => ({type: 'SMALLINT'}),
  Date: () => ({type: 'DATE'}),
  DateTime: () => ({type: 'TIMESTAMP'}),
  Decimal: (precision, scale) => ({type: 'NUMERIC', precision, scale}),
  Bit: () => ({type: 'BOOLEAN'}),
  Char: (len) => ({type: 'CHAR', len}),
  Text: () => ({type: 'TEXT'}),
};

// Log pool events for monitoring
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

pool.on('connect', () => {
  console.log('PostgreSQL pool: client connected');
});

module.exports = { sql, query, pool, healthCheck, closePool };
