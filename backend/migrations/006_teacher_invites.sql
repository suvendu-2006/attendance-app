-- Migration: Create teacher_invites table

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS teacher_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  created_by UUID REFERENCES teachers(id) ON DELETE CASCADE,
  is_used BOOLEAN DEFAULT false,
  used_by UUID REFERENCES teachers(id) ON DELETE SET NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teacher_invites_code ON teacher_invites(code);
