### Requirement: Resume an output stream
The system SHALL provide a `resume_stream` command that accepts a session ID and a Tauri `Channel<PtyOutput>`. Upon invocation, the system SHALL first replay all buffered output chunks through the channel, then continuously stream live PTY output. Each message SHALL contain the raw bytes produced by the PTY read.

#### Scenario: Resume stream on a session with buffered output
- **WHEN** a session has accumulated output while no stream was attached, and the frontend invokes `resume_stream` with that session's ID and a channel
- **THEN** the system sends all buffered output chunks through the channel in order, followed by live output as it arrives

#### Scenario: Resume stream on a fresh session
- **WHEN** a session was just created (no output yet) and the frontend invokes `resume_stream`
- **THEN** the system begins streaming live output as the PTY produces it

#### Scenario: Resume stream on a non-existent session
- **WHEN** the frontend invokes `resume_stream` with an unknown session ID
- **THEN** the system SHALL return an error indicating the session was not found

### Requirement: Re-attach replaces the previous stream
The system SHALL support only one active stream consumer per session. If `resume_stream` is called while a previous stream is active, the system SHALL abort the previous stream task before starting the new one. The new consumer receives buffered output from the beginning of the buffer.

#### Scenario: Re-attach to an already-streaming session
- **WHEN** a session has an active stream and the frontend invokes `resume_stream` again with a new channel
- **THEN** the previous stream task is aborted, and the new channel receives buffered output followed by live output

### Requirement: Write input to a PTY session
The system SHALL provide a `write_to_pty` command that accepts a session ID and a byte payload, and writes the payload to the PTY master's input. The command SHALL return success or an error.

#### Scenario: Write input to an active session
- **WHEN** the frontend invokes `write_to_pty` with a valid session ID and data `"ls\n"`
- **THEN** the system writes the bytes to the PTY master and returns success

#### Scenario: Write input to a non-existent session
- **WHEN** the frontend invokes `write_to_pty` with an unknown session ID
- **THEN** the system SHALL return an error indicating the session was not found

### Requirement: Output buffering
The system SHALL maintain a ring buffer of recent output chunks per session, with a configurable maximum capacity (default: 1000 chunks). When the buffer is full, the oldest chunk SHALL be evicted. Buffering SHALL occur regardless of whether a stream consumer is attached.

#### Scenario: Buffer accumulates while no stream is attached
- **WHEN** a session produces output and no stream consumer is attached
- **THEN** the output chunks are stored in the session's ring buffer

#### Scenario: Buffer evicts oldest chunks when full
- **WHEN** the buffer has reached its maximum capacity and new output arrives
- **THEN** the oldest chunk is removed and the new chunk is appended

### Requirement: Stream stops on channel disconnect
When the frontend's channel is dropped (e.g., component unmount or navigation), the stream read loop SHALL detect the send failure and terminate. The PTY session SHALL remain alive and continue buffering output.

#### Scenario: Frontend disconnects from stream
- **WHEN** the frontend drops the channel while the stream is active
- **THEN** the stream task terminates, the session remains active, and output continues to be buffered

### Requirement: Stream stops on process exit
When the PTY child process exits, the stream read loop SHALL detect EOF on the PTY master, send any remaining data, and terminate. The session SHALL remain in the registry until explicitly deleted.

#### Scenario: Shell process exits normally
- **WHEN** the user types `exit` in the terminal and the shell process terminates
- **THEN** the stream sends any remaining output, then terminates. The session remains in the registry with no active stream.
