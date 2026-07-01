-- PTY output moved from SQLite to per-session files ({app_data_dir}/pty_logs/).
-- Terminal scrollback is transient, so dropping the table on upgrade is safe:
-- sessions are marked closed on startup and restore reads from files going forward.
DROP TABLE IF EXISTS pty_session_output;
