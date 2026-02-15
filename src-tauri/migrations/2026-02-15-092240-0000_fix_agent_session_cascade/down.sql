-- Revert to original table structure without ON DELETE CASCADE

CREATE TABLE agent_sessions_old (
    id TEXT PRIMARY KEY NOT NULL,
    agent TEXT NOT NULL,
    acp_session_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    destroyed_at INTEGER,
    session_init_json TEXT,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

INSERT INTO agent_sessions_old SELECT * FROM agent_sessions;
DROP TABLE agent_sessions;
ALTER TABLE agent_sessions_old RENAME TO agent_sessions;

-- Revert agent_session_events (keep cascade since it was already there)
CREATE TABLE agent_session_events_old (
    id TEXT PRIMARY KEY NOT NULL,
    event_index INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    sender TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

INSERT INTO agent_session_events_old SELECT * FROM agent_session_events;
DROP TABLE agent_session_events;
ALTER TABLE agent_session_events_old RENAME TO agent_session_events;

CREATE INDEX idx_agent_events_session ON agent_session_events(session_id, event_index);
