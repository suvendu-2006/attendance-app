import re

with open('backend/routes/auth.js', 'r') as f:
    content = f.read()

# 1. Add csv-parse sync
imports = "const { parse } = require('csv-parse/sync');\n"
content = content.replace("const { parse } = require('csv-parse');\n", imports)

# 2. Add /admin/import-students
import_students_code = """
router.post('/admin/import-students', requireTeacher, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

    const records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    let created = 0;
    let skipped = 0;
    const skippedRows = [];
    const generatedPasswords = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const name = row.name || row.Name;
      const roll_number = row.roll_number || row.RollNumber || row.Roll_Number;
      let phone_number = row.phone_number || row.PhoneNumber || row.Phone;
      phone_number = normalizePhone(phone_number);

      if (!name || !roll_number) {
        skipped++;
        skippedRows.push({ row: i + 1, reason: 'Missing name or roll_number' });
        continue;
      }

      const tempPassword = `temp-${crypto.randomBytes(4).toString('hex')}`;
      const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
      const pendingHash = `PENDING:${hash}`;

      const { rowCount } = await pool.query(
        `INSERT INTO students (name, roll_number, phone_number, password_hash, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (roll_number) DO NOTHING`,
        [name, roll_number, phone_number, pendingHash]
      );

      if (rowCount === 0) {
        skipped++;
        skippedRows.push({ row: i + 1, reason: 'Roll number already exists' });
      } else {
        created++;
        generatedPasswords.push({ roll_number, tempPassword });
      }
    }

    res.json({ message: 'Import complete', created, skipped, skippedRows, generatedPasswords });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to process CSV' });
  }
});
"""

# 3. Add teacher invite generation
generate_invite_code = """
router.post('/admin/generate-invite', requireTeacher, requireAdmin, async (req, res) => {
  try {
    const code = crypto.randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await pool.query(
      `INSERT INTO teacher_invites (code, created_by, expires_at) VALUES ($1, $2, $3)`,
      [code, req.user.id, expiresAt]
    );
    res.json({ message: 'Invite code generated', code, expires_at: expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
"""

# 4. Add student activate (public)
student_activate_code = """
router.post('/student/activate', async (req, res) => {
  try {
    const { roll_number, temp_password, new_password } = req.body;
    if (!roll_number || !temp_password || !new_password) {
      return res.status(400).json({ error: 'roll_number, temp_password, and new_password required' });
    }

    const { rows } = await pool.query(
      'SELECT id, password_hash FROM students WHERE roll_number = $1',
      [roll_number]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    
    const student = rows[0];
    if (!student.password_hash.startsWith('PENDING:')) {
      return res.status(400).json({ error: 'Account is already activated' });
    }

    const actualHash = student.password_hash.slice(8); // Remove PENDING:
    const match = await bcrypt.compare(temp_password, actualHash);
    if (!match) return res.status(401).json({ error: 'Invalid temporary password' });

    const newHash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await pool.query('UPDATE students SET password_hash = $1 WHERE id = $2', [newHash, student.id]);

    res.json({ message: 'Account activated successfully. You can now log in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
"""

# 5. Add teacher register (public)
teacher_register_code = """
router.post('/teacher/register', async (req, res) => {
  try {
    let { name, phone_number, password, invite_code } = req.body;
    if (!name || !phone_number || !password || !invite_code) {
      return res.status(400).json({ error: 'name, phone_number, password, and invite_code required' });
    }

    phone_number = normalizePhone(phone_number);

    await pool.query('BEGIN');

    const { rows: inviteRows } = await pool.query(
      `SELECT id FROM teacher_invites 
       WHERE code = $1 AND is_used = false AND expires_at > NOW() FOR UPDATE`,
      [invite_code]
    );

    if (inviteRows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid or expired invite code' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows: teacherRows } = await pool.query(
      `INSERT INTO teachers (name, phone_number, password_hash, is_admin)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (phone_number) DO NOTHING
       RETURNING id, name`,
      [name, phone_number, hash]
    );

    if (teacherRows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(409).json({ error: 'Teacher with that phone number already exists' });
    }

    await pool.query(
      `UPDATE teacher_invites SET is_used = true, used_by = $1 WHERE id = $2`,
      [teacherRows[0].id, inviteRows[0].id]
    );

    await pool.query('COMMIT');
    res.json({ message: 'Teacher account created successfully. You can now log in.' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
"""

# Insert these into the file
if '/admin/import-students' not in content:
    content = content.replace("router.post('/admin/register-student'", import_students_code + "\n" + generate_invite_code + "\n" + "router.post('/admin/register-student'")

if '/student/activate' not in content:
    content = content.replace("router.post('/student/register-device'", student_activate_code + "\n" + teacher_register_code + "\n" + "router.post('/student/register-device'")

# Update student login to block PENDING passwords
student_login_block = """
    if (student.password_hash && student.password_hash.startsWith('PENDING:')) {
      return res.status(403).json({ error: 'Please activate your account first.' });
    }
    const match = await bcrypt.compare(password, student.password_hash);
"""
content = content.replace("const match = await bcrypt.compare(password, student.password_hash);", student_login_block, 1) # Only replace the first one (student login)

with open('backend/routes/auth.js', 'w') as f:
    f.write(content)
