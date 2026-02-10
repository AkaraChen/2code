use std::collections::VecDeque;
use std::io::Write;
use std::time::SystemTime;

use portable_pty::{native_pty_system, CommandBuilder};
use tauri::ipc::Channel;
use tauri::State;

use super::session::{PtyConfig, PtySession, PtySessionInfo, PtySessionRegistry};
use super::stream::PtyOutput;

#[tauri::command]
pub fn create_pty(
    config: Option<PtyConfig>,
    state: State<'_, PtySessionRegistry>,
) -> Result<PtySessionInfo, String> {
    let config = config.unwrap_or_default();
    let shell = config.shell_or_default();
    let cwd = config.cwd_or_default();
    let pty_size = config.pty_size();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size)
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);

    if let Some(ref env) = config.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {e}"))?;

    let id = uuid::Uuid::new_v4().to_string();

    let session = PtySession {
        id: id.clone(),
        master: pair.master,
        child,
        writer,
        shell: shell.clone(),
        cwd: cwd.clone(),
        rows: config.rows(),
        cols: config.cols(),
        created_at: SystemTime::now(),
        output_buffer: VecDeque::new(),
        stream_abort: None,
    };

    let info = session.info();

    state
        .lock()
        .map_err(|e| format!("Registry lock poisoned: {e}"))?
        .insert(id, session);

    Ok(info)
}

#[tauri::command]
pub fn get_pty(
    session_id: String,
    state: State<'_, PtySessionRegistry>,
) -> Result<PtySessionInfo, String> {
    let sessions = state
        .lock()
        .map_err(|e| format!("Registry lock poisoned: {e}"))?;

    sessions
        .get(&session_id)
        .map(|s| s.info())
        .ok_or_else(|| format!("Session not found: {session_id}"))
}

#[tauri::command]
pub fn list_pty(state: State<'_, PtySessionRegistry>) -> Result<Vec<PtySessionInfo>, String> {
    let sessions = state
        .lock()
        .map_err(|e| format!("Registry lock poisoned: {e}"))?;

    Ok(sessions.values().map(|s| s.info()).collect())
}

#[tauri::command]
pub fn resize_pty(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, PtySessionRegistry>,
) -> Result<PtySessionInfo, String> {
    let mut sessions = state
        .lock()
        .map_err(|e| format!("Registry lock poisoned: {e}"))?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    session
        .master
        .resize(portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {e}"))?;

    session.rows = rows;
    session.cols = cols;

    Ok(session.info())
}

#[tauri::command]
pub fn delete_pty(
    session_id: String,
    state: State<'_, PtySessionRegistry>,
) -> Result<(), String> {
    let mut sessions = state
        .lock()
        .map_err(|e| format!("Registry lock poisoned: {e}"))?;

    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    // Abort the stream task if active
    if let Some(abort) = session.stream_abort.take() {
        abort.abort();
    }

    // Kill the child process
    let _ = session.child.kill();

    Ok(())
}

#[tauri::command]
pub fn resume_stream(
    session_id: String,
    channel: Channel<PtyOutput>,
    state: State<'_, PtySessionRegistry>,
) -> Result<(), String> {
    let mut sessions = state
        .lock()
        .map_err(|e| format!("Registry lock poisoned: {e}"))?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    // Abort previous stream if any
    if let Some(abort) = session.stream_abort.take() {
        abort.abort();
    }

    // Replay buffered output
    for chunk in &session.output_buffer {
        if channel
            .send(PtyOutput {
                data: chunk.clone(),
            })
            .is_err()
        {
            return Ok(()); // Frontend already disconnected
        }
    }

    // Clone a reader from the master for the background loop
    let reader = session
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let registry = state.inner().clone();
    let sid = session_id.clone();

    // Start the reader loop and track its abort handle
    let handle = tokio::task::spawn_blocking(move || {
        // We need to run the reader inline here so we can track the task
        let mut reader = reader;
        let mut buf = vec![0u8; 4096];

        loop {
            match std::io::Read::read(&mut reader, &mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = buf[..n].to_vec();

                    if let Ok(mut sessions) = registry.lock() {
                        if let Some(session) = sessions.get_mut(&sid) {
                            session.push_output(chunk.clone());
                        }
                    }

                    if channel.send(PtyOutput { data: chunk }).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    session.stream_abort = Some(handle.abort_handle());

    Ok(())
}

#[tauri::command]
pub fn write_to_pty(
    session_id: String,
    data: Vec<u8>,
    state: State<'_, PtySessionRegistry>,
) -> Result<(), String> {
    let mut sessions = state
        .lock()
        .map_err(|e| format!("Registry lock poisoned: {e}"))?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    session
        .writer
        .write_all(&data)
        .map_err(|e| format!("Failed to write to PTY: {e}"))?;

    Ok(())
}
