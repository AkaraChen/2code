use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Run a command to completion, returning `Ok(None)` if the deadline expires.
pub fn output_with_timeout(
	command: &mut Command,
	timeout: Duration,
) -> std::io::Result<Option<Output>> {
	let mut child = command
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()?;

	let stdout_reader = spawn_pipe_reader(child.stdout.take());
	let stderr_reader = spawn_pipe_reader(child.stderr.take());
	let deadline = Instant::now() + timeout;

	let status = loop {
		match child.try_wait()? {
			Some(status) => break status,
			None if Instant::now() >= deadline => {
				let _ = child.kill();
				let _ = child.wait();
				drop(stdout_reader);
				drop(stderr_reader);
				return Ok(None);
			}
			None => std::thread::sleep(Duration::from_millis(25)),
		}
	};

	Ok(Some(Output {
		status,
		stdout: join_reader(stdout_reader),
		stderr: join_reader(stderr_reader),
	}))
}

fn spawn_pipe_reader<R: Read + Send + 'static>(
	pipe: Option<R>,
) -> Option<JoinHandle<Vec<u8>>> {
	pipe.map(|mut pipe| {
		std::thread::spawn(move || {
			let mut buf = Vec::new();
			let _ = pipe.read_to_end(&mut buf);
			buf
		})
	})
}

fn join_reader(handle: Option<JoinHandle<Vec<u8>>>) -> Vec<u8> {
	handle
		.and_then(|handle| handle.join().ok())
		.unwrap_or_default()
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::ErrorKind;

	#[cfg(unix)]
	#[test]
	fn completes_within_timeout_returns_output() {
		let output = output_with_timeout(
			Command::new("sh").args(["-c", "printf hello"]),
			Duration::from_secs(10),
		)
		.unwrap()
		.unwrap();

		assert!(output.status.success());
		assert_eq!(output.stdout, b"hello");
	}

	#[cfg(unix)]
	#[test]
	fn captures_stderr() {
		let output = output_with_timeout(
			Command::new("sh").args(["-c", "printf err >&2; exit 3"]),
			Duration::from_secs(10),
		)
		.unwrap()
		.unwrap();

		assert!(!output.status.success());
		assert_eq!(output.stderr, b"err");
	}

	#[cfg(unix)]
	#[test]
	fn kills_process_on_timeout() {
		let started = Instant::now();
		let output = output_with_timeout(
			Command::new("sh").args(["-c", "sleep 30"]),
			Duration::from_millis(250),
		)
		.unwrap();

		assert!(output.is_none());
		assert!(started.elapsed() < Duration::from_secs(5));
	}

	#[cfg(unix)]
	#[test]
	fn large_output_does_not_deadlock() {
		let output = output_with_timeout(
			Command::new("sh").args(["-c", "head -c 1000000 /dev/zero"]),
			Duration::from_secs(10),
		)
		.unwrap()
		.unwrap();

		assert!(output.status.success());
		assert_eq!(output.stdout.len(), 1_000_000);
	}

	#[test]
	fn spawn_error_propagates() {
		let mut command = Command::new("definitely-not-a-real-binary-2code");
		let error = output_with_timeout(&mut command, Duration::from_secs(10))
			.unwrap_err();

		assert_eq!(error.kind(), ErrorKind::NotFound);
	}
}
