CREATE TABLE session_stats (
    id TEXT PRIMARY KEY NOT NULL,
    session_type TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    branch_name TEXT,
    shell TEXT,
    cwd TEXT,
    agent TEXT,
    event_count INTEGER,
    user_message_count INTEGER,
    agent_message_count INTEGER,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    duration_seconds INTEGER
);

CREATE INDEX idx_session_stats_project ON session_stats(project_id);
CREATE INDEX idx_session_stats_created ON session_stats(created_at);

CREATE TABLE daily_activity (
    date TEXT NOT NULL,
    project_id TEXT NOT NULL,
    terminal_sessions INTEGER NOT NULL DEFAULT 0,
    agent_sessions INTEGER NOT NULL DEFAULT 0,
    terminal_seconds INTEGER NOT NULL DEFAULT 0,
    agent_seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, project_id)
);
