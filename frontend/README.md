# Fraud-Resistant Digital Attendance System

This repository contains the code for the attendance system. It uses React + Vite for the frontend and an Express + Postgres backend.

## Security model & limitations

While this system employs multiple layers of verification (HMAC, nonces, GPS, and device tokens) to ensure students are present in class, there are inherent limitations:

- **GPS Spoofing:** GPS can be spoofed by a determined user. The system implements an anomaly detection layer to flag physically impossible location jumps, but it cannot absolutely guarantee physical presence.
- **Token Storage:** Authentication tokens are currently stored in localStorage, which presents an XSS risk. A migration to HTTP-only cookies is planned for a future release to mitigate this.
- **Replay Protection:** Replay protection is enforced on a per-student per-session basis. A link can only be consumed once by any individual student.

**Conclusion:** State that the system *reduces* proxy attendance, it does not *eliminate* it. This system is designed as a strong deterrent and a highly reliable mechanism for attendance, but should be considered "fraud-resistant" rather than "proxy-proof".
