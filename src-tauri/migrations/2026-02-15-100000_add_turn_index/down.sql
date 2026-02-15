-- Drop the turn index
DROP INDEX IF EXISTS idx_agent_events_turn;

-- Remove turn_index column from agent_session_events table
ALTER TABLE agent_session_events DROP COLUMN turn_index;
