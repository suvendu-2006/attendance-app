const pool = require('./db');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });



async function runMigrations() {
  const migrationFile = path.join(__dirname, 'migrations_phase0.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');

  try {
    console.log('Running migrations...');
    await pool.query(sql);
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
