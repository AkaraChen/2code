CREATE TABLE pty_session_output (
session_id TEXT PRIMARY KEY NOT NULL
REFERENCES pty_sessions (id) ON DELETE CASCADE,
data BLOB NOT NULL DEFAULT X''
) ;

WITH RECURSIVE chunk_concat(session_id, last_id, data) AS (
	SELECT c.session_id, c.id, c.data
	FROM pty_output_chunks c
	WHERE c.id = (
		SELECT MIN(first_chunk.id)
		FROM pty_output_chunks first_chunk
		WHERE first_chunk.session_id = c.session_id
	)
	UNION ALL
	SELECT chunk_concat.session_id, next_chunk.id,
		CAST(chunk_concat.data || next_chunk.data AS BLOB)
	FROM chunk_concat
	INNER JOIN pty_output_chunks next_chunk
		ON next_chunk.session_id = chunk_concat.session_id
		AND next_chunk.id = (
			SELECT MIN(candidate.id)
			FROM pty_output_chunks candidate
			WHERE candidate.session_id = chunk_concat.session_id
				AND candidate.id > chunk_concat.last_id
		)
)
INSERT INTO pty_session_output (session_id, data)
SELECT
	s.id,
	COALESCE(
		(
			SELECT CAST(data AS BLOB)
			FROM chunk_concat
			WHERE chunk_concat.session_id = s.id
			ORDER BY last_id DESC
			LIMIT 1
		),
		X''
	)
FROM pty_sessions s ;

DROP INDEX IF EXISTS idx_pty_output_session ;
DROP TABLE IF EXISTS pty_output_chunks ;
