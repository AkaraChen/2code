CREATE INDEX IF NOT EXISTS idx_profiles_project_id ON profiles (project_id);
CREATE INDEX IF NOT EXISTS idx_pty_sessions_profile_id ON pty_sessions (profile_id);
