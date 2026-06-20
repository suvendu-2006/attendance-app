const bcrypt = require('bcrypt');
const pool = require('./db');

(async () => {
  try {
    const teacherHash = await bcrypt.hash('demo', 12);
    const studentHash = await bcrypt.hash('demo', 12);

    await pool.query(
      `INSERT INTO teachers (name, phone_number, password_hash, is_admin)
       VALUES ('Demo Teacher', 'demo-teacher', $1, TRUE)
       ON CONFLICT (phone_number) DO UPDATE SET is_admin = TRUE`,
      [teacherHash]
    );

    await pool.query(
      `INSERT INTO students (name, roll_number, phone_number, password_hash, is_active)
       VALUES ('Demo Student', 'DEMO001', '0000000000', $1, TRUE)
       ON CONFLICT (roll_number) DO NOTHING`,
      [studentHash]
    );

    console.log('✅ Seed complete. Admin teacher phone=demo-teacher pass=demo; student roll=DEMO001 pass=demo.');
  } catch (e) {
    console.error('Seed failed:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
