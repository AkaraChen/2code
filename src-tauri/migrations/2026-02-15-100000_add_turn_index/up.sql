-- Add turn_index column to agent_session_events table
ALTER TABLE agent_session_events
ADD COLUMN turn_index INTEGER NOT NULL DEFAULT 0;

-- Create index for efficient turn-based queries
CREATE INDEX idx_agent_events_turn
ON agent_session_events(session_id, turn_index, event_index);
