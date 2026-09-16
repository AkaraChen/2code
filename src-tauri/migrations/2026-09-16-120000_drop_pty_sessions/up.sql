-- Local PTY session metadata is gone. Tabs/panes restore from live
-- Herdr session.snapshot / pane_id. projects, project_groups, and
-- checkout_notes stay.
DROP INDEX IF EXISTS idx_pty_sessions_profile_id;
DROP INDEX IF EXISTS idx_pty_sessions_project_id;
DROP TABLE IF EXISTS pty_sessions;
