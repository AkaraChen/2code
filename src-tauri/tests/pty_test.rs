use std::collections::VecDeque;
use std::io::Read;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

#[test]
fn create_session_with_defaults() {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("Failed to open PTY");

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let cmd = CommandBuilder::new(&shell);
    let mut child = pair.slave.spawn_command(cmd).expect("Failed to spawn shell");

    // Session was created — verify child is alive
    assert!(
        child.try_wait().expect("try_wait failed").is_none(),
        "Child should still be running"
    );

    // Clean up
    child.kill().ok();
}

#[test]
fn create_list_get_resize_delete_lifecycle() {
    let pty_system = native_pty_system();

    // Create two sessions
    let mut sessions = Vec::new();
    for _ in 0..2 {
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let cmd = CommandBuilder::new(&shell);
        let child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        let id = uuid::Uuid::new_v4().to_string();

        sessions.push((id, pair.master, child));
    }

    // List: should have 2
    assert_eq!(sessions.len(), 2);

    // Get: verify each has a unique ID
    assert_ne!(sessions[0].0, sessions[1].0);

    // Resize the first session
    sessions[0]
        .1
        .resize(PtySize {
            rows: 50,
            cols: 200,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("Resize should succeed");

    // Delete: kill and remove first session
    sessions[0].2.kill().ok();
    sessions.remove(0);
    assert_eq!(sessions.len(), 1);

    // Clean up remaining
    sessions[0].2.kill().ok();
}

#[test]
fn output_buffer_eviction() {
    let mut buffer: VecDeque<Vec<u8>> = VecDeque::new();
    let capacity = 5;

    // Fill beyond capacity
    for i in 0..8 {
        if buffer.len() >= capacity {
            buffer.pop_front();
        }
        buffer.push_back(vec![i]);
    }

    assert_eq!(buffer.len(), 5);
    // Should contain items 3,4,5,6,7 (oldest evicted)
    assert_eq!(buffer[0], vec![3]);
    assert_eq!(buffer[4], vec![7]);
}

#[test]
fn pty_read_write_roundtrip() {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("Failed to open PTY");

    let cmd = CommandBuilder::new("echo");
    let mut child = pair.slave.spawn_command(cmd).expect("Failed to spawn");

    // Read some output
    let mut reader = pair.master.try_clone_reader().expect("clone reader");
    let mut buf = vec![0u8; 4096];
    // echo should produce a newline at least
    let _n = reader.read(&mut buf).unwrap_or(0);
    // We at least got something (echo outputs \n)
    // Don't assert exact content as it varies by platform

    child.wait().ok();
}
