CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    agent TEXT NOT NULL,
    acp_session_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    destroyed_at INTEGER,
    session_init_json TEXT,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE agent_session_events (
    id TEXT PRIMARY KEY NOT NULL,
    event_index INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    sender TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_events_session ON agent_session_events(session_id, event_index);
