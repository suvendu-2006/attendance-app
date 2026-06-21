const pool = require('./db');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Ordered list of all migration files to run
const MIGRATION_FILES = [
  'migrations_phase0.sql',
  'migrations_fixes.sql',
  'migrations_remaining.sql',
  'migrations_drop_old_nonce_constraints.sql',
];

async function runMigrations() {
  try {
    for (const file of MIGRATION_FILES) {
      const filePath = path.join(__dirname, file);
      if (!fs.existsSync(filePath)) {
        console.log(`⏭️  Skipping ${file} (not found)`);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`Running ${file}...`);
      await pool.query(sql);
      console.log(`✅ ${file} completed.`);
    }
    console.log('\n✅ All migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
