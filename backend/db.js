const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

function buildConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
  };
}

let pool;
let poolPromise;

async function initPool() {
  if (pool) return pool;

  const baseConfig = buildConfig();

  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    const { Connector } = require('@google-cloud/cloud-sql-connector');
    const connector = new Connector();
    const clientOpts = await connector.getOptions({
      instanceConnectionName: process.env.CLOUD_SQL_CONNECTION_NAME,
      ipType: 'PUBLIC',
    });
    pool = new Pool({
      ...baseConfig,
      ...clientOpts,
      max: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
  } else {
    pool = new Pool({
      ...baseConfig,
      ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : false,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
  }

  pool.on('error', (err) => console.error('Unexpected database pool error:', err));
  return pool;
}

module.exports = {
  query: async (text, params) => {
    if (!poolPromise) poolPromise = initPool();
    const p = await poolPromise;
    return p.query(text, params);
  },
  getClient: async () => {
    if (!poolPromise) poolPromise = initPool();
    const p = await poolPromise;
    return p.connect();
  },
  end: async () => {
    if (poolPromise) {
      const p = await poolPromise;
      return p.end();
    }
  },
};
