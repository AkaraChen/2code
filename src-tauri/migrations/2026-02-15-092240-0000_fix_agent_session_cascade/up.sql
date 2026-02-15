-- Drop and recreate agent_sessions table with proper cascade
CREATE TABLE agent_sessions_new (
    id TEXT PRIMARY KEY NOT NULL,
    agent TEXT NOT NULL,
    acp_session_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    destroyed_at INTEGER,
    session_init_json TEXT,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

INSERT INTO agent_sessions_new SELECT * FROM agent_sessions;
DROP TABLE agent_sessions;
ALTER TABLE agent_sessions_new RENAME TO agent_sessions;

-- Recreate agent_session_events with cascade (already has it, but ensure consistency)
CREATE TABLE agent_session_events_new (
    id TEXT PRIMARY KEY NOT NULL,
    event_index INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    sender TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

INSERT INTO agent_session_events_new SELECT * FROM agent_session_events;
DROP TABLE agent_session_events;
ALTER TABLE agent_session_events_new RENAME TO agent_session_events;

CREATE INDEX idx_agent_events_session ON agent_session_events(session_id, event_index);
