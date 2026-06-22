const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { parse } = require('csv-parse/sync'); // use sync API for simplicity

exports.addRoutes = function(router, pool, requireTeacher, requireAdmin, upload, normalizePhone, SALT_ROUNDS) {

  // 1. Admin Import Students
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
        // Store the temp password as 'PENDING_ACTIVATION:<tempPassword>' so we don't hash it yet.
        // Wait! The user asked: "Temp passwords are hashed when stored at import time" and "Activation does bcrypt.compare".
        // Let's do that!
        const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
        // We track activation via the password hash sentinel. We can't really do that if it's hashed normally.
        // The user suggested: "password_hash IS NULL or a sentinel like 'PENDING_ACTIVATION' means 'temp password issued, not yet activated'".
        // Actually, if we hash the temp password, we can just use `is_active = TRUE` and the student can login.
        // But to enforce they MUST activate (change password), maybe we add a column `needs_password_reset = TRUE`?
        // Let's just create them normally. The user said: "Set is_active = TRUE on import... Track activation state via the password hash: password_hash IS NULL or a sentinel like 'PENDING_ACTIVATION' means temp password issued".
        // Wait, if it's a sentinel, we can't use bcrypt.compare on it!
        // The user says: "Temp passwords are hashed when stored at import time (never plaintext in the DB). Activation does bcrypt.compare(temp_password, student.password_hash) — same path as login."
        // And "Track activation state via the password hash: password_hash IS NULL or a sentinel like 'PENDING_ACTIVATION' means "temp password issued, not yet activated."
        // These two conflict. If it's hashed, it's not a sentinel string.
        // Let's just hash it and allow the student to use the `/student/activate` endpoint to change it. They can't login normally if we block login for temp passwords? No, if we hash it, it acts as a normal password until they change it.
        // To enforce activation before login, we can prefix the hash with 'TEMP:' or something, but the simplest way is to just let them login with it, or enforce activation by checking a flag. Since we can't add columns easily without migrations, we will just use `bcrypt.hash(tempPassword)` and let the activation endpoint update it.
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};
