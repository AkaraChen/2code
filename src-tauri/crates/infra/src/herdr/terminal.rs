//! Pinned CLI `herdr terminal session` helper for live frames.
//!
//! Production attach is `control` without `--takeover` on the resolved
//! shared socket. GUI detach writes `terminal.release` and reaps the
//! child; it does not `pane.close`. Windows attach is fail-closed (#396).

use std::collections::VecDeque;
use std::fmt;
use std::io::{self, Read, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use model::error::AppError;
use model::runtime::HerdrTerminalFrame;
use serde::Deserialize;
use serde_json::Value;

use super::process::HerdrProcessEnv;
use super::transport::endpoint_not_allowed;
use crate::no_window::command_without_windows_console;

/// Default cap for one NDJSON stdout line.
pub const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
/// Default pending frame count between the CLI reader and the sink.
pub const MAX_PENDING_FRAMES: usize = 32;
/// Default pending decoded-byte cap between the CLI reader and the sink.
pub const MAX_PENDING_BYTES: usize = 1024 * 1024;

const CONTROLLER_CONFLICT: &str =
	"already has an attached client; retry with --takeover";

/// Application frame. CLI wire fields stay out of this type.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalFrame {
	pub seq: u64,
	pub full: bool,
	pub width: u16,
	pub height: u16,
	pub bytes: Vec<u8>,
}

impl From<TerminalFrame> for HerdrTerminalFrame {
	fn from(frame: TerminalFrame) -> Self {
		Self {
			seq: frame.seq,
			full: frame.full,
			width: frame.width,
			height: frame.height,
			bytes: frame.bytes,
		}
	}
}

/// How the helper attaches. Production GUI attach is [`Self::Control`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalSessionMode {
	Control,
	Observe,
}

impl TerminalSessionMode {
	fn as_arg(self) -> &'static str {
		match self {
			Self::Control => "control",
			Self::Observe => "observe",
		}
	}
}

/// Caps for one helper's stdout reader.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BufferLimits {
	pub max_line_bytes: usize,
	pub max_pending_frames: usize,
	pub max_pending_bytes: usize,
}

impl Default for BufferLimits {
	fn default() -> Self {
		Self {
			max_line_bytes: MAX_LINE_BYTES,
			max_pending_frames: MAX_PENDING_FRAMES,
			max_pending_bytes: MAX_PENDING_BYTES,
		}
	}
}

/// Inputs for spawning one CLI helper.
pub struct TerminalAttachRequest<'a> {
	pub env: &'a HerdrProcessEnv<'a>,
	pub pane_id: &'a str,
	pub mode: TerminalSessionMode,
	pub cols: Option<u16>,
	pub rows: Option<u16>,
	pub takeover: bool,
	pub limits: BufferLimits,
}

#[derive(Debug)]
pub enum HerdrTerminalError {
	Io(io::Error),
	UnsupportedPlatform {
		message: String,
	},
	ControllerConflict {
		reason: String,
	},
	MessageTooLarge {
		size: usize,
		limit: usize,
	},
	SlowConsumer {
		pending_bytes: usize,
		pending_frames: usize,
	},
	InvalidJson(String),
	Closed {
		reason: String,
	},
	NotAttached,
	Refused {
		reason: String,
	},
	InvalidInput(String),
}

impl fmt::Display for HerdrTerminalError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Io(err) => write!(f, "Herdr terminal I/O: {err}"),
			Self::UnsupportedPlatform { message } => {
				write!(f, "{message}")
			}
			Self::ControllerConflict { reason } => {
				write!(f, "{reason}")
			}
			Self::MessageTooLarge { size, limit } => {
				write!(f, "Herdr terminal message too large ({size} > {limit})")
			}
			Self::SlowConsumer {
				pending_bytes,
				pending_frames,
			} => write!(
				f,
				"Herdr terminal consumer too slow ({pending_frames} frames, {pending_bytes} bytes)"
			),
			Self::InvalidJson(err) => write!(f, "Herdr terminal JSON: {err}"),
			Self::Closed { reason } => {
				write!(f, "Herdr terminal closed: {reason}")
			}
			Self::NotAttached => {
				write!(f, "Herdr terminal helper is not attached")
			}
			Self::Refused { reason } => {
				write!(f, "Herdr terminal request refused: {reason}")
			}
			Self::InvalidInput(reason) => {
				write!(f, "Herdr terminal input refused: {reason}")
			}
		}
	}
}

impl std::error::Error for HerdrTerminalError {}

impl From<io::Error> for HerdrTerminalError {
	fn from(err: io::Error) -> Self {
		Self::Io(err)
	}
}

impl From<HerdrTerminalError> for AppError {
	fn from(err: HerdrTerminalError) -> Self {
		match err {
			HerdrTerminalError::UnsupportedPlatform { message } => {
				AppError::HerdrUnsupportedPlatform(message)
			}
			HerdrTerminalError::ControllerConflict { reason } => {
				AppError::HerdrControllerConflict(reason)
			}
			HerdrTerminalError::MessageTooLarge { size, limit } => {
				AppError::HerdrTerminalMessageTooLarge(format!(
					"{size} > {limit}"
				))
			}
			HerdrTerminalError::SlowConsumer {
				pending_bytes,
				pending_frames,
			} => AppError::HerdrTerminalSlowConsumer(format!(
				"{pending_frames} frames, {pending_bytes} bytes"
			)),
			HerdrTerminalError::NotAttached => {
				AppError::TerminalError(err.to_string())
			}
			other => AppError::TerminalError(other.to_string()),
		}
	}
}

/// One CLI helper process. Drop kills and reaps the child.
pub struct TerminalSessionHelper {
	child: Mutex<Child>,
	stdin: Mutex<Option<ChildStdin>>,
	events: Mutex<Receiver<Result<TerminalFrame, HerdrTerminalError>>>,
	pending_bytes: Arc<AtomicUsize>,
	pending_frames: Arc<AtomicUsize>,
	released: AtomicBool,
	reader: Mutex<Option<JoinHandle<()>>>,
}

impl TerminalSessionHelper {
	/// Production attach: `control` without `--takeover`.
	pub fn attach_control(
		req: TerminalAttachRequest<'_>,
	) -> Result<Self, HerdrTerminalError> {
		if req.takeover {
			return Err(HerdrTerminalError::Refused {
				reason: "refusing silent --takeover".into(),
			});
		}
		spawn_helper(TerminalAttachRequest {
			mode: TerminalSessionMode::Control,
			takeover: false,
			..req
		})
	}

	/// Test/helper observe path. Production GUI attach must not use this
	/// together with control on the same pane.
	pub fn attach_observe(
		req: TerminalAttachRequest<'_>,
	) -> Result<Self, HerdrTerminalError> {
		let req = TerminalAttachRequest {
			mode: TerminalSessionMode::Observe,
			takeover: false,
			..req
		};
		spawn_helper(req)
	}

	pub fn child_id(&self) -> Result<u32, HerdrTerminalError> {
		self.child
			.lock()
			.map(|child| child.id())
			.map_err(|_| HerdrTerminalError::NotAttached)
	}

	pub fn recv_frame(
		&self,
		timeout: Duration,
	) -> Result<TerminalFrame, HerdrTerminalError> {
		let rx = self.events.lock().map_err(|_| {
			HerdrTerminalError::Io(io::Error::other("frame lock poisoned"))
		})?;
		match rx.recv_timeout(timeout) {
			Ok(Ok(frame)) => {
				let size = frame.bytes.len();
				let pending = self.pending_bytes.load(Ordering::SeqCst);
				self.pending_bytes
					.store(pending.saturating_sub(size), Ordering::SeqCst);
				self.pending_frames.fetch_sub(1, Ordering::SeqCst);
				Ok(frame)
			}
			Ok(Err(err)) => Err(err),
			Err(RecvTimeoutError::Timeout) => Err(HerdrTerminalError::Io(
				io::Error::new(io::ErrorKind::TimedOut, "frame wait timed out"),
			)),
			Err(RecvTimeoutError::Disconnected) => {
				Err(HerdrTerminalError::Closed {
					reason: "helper exited".into(),
				})
			}
		}
	}

	pub fn recv_frame_blocking(
		&self,
	) -> Result<TerminalFrame, HerdrTerminalError> {
		loop {
			match self.recv_frame(Duration::from_millis(200)) {
				Ok(frame) => return Ok(frame),
				Err(HerdrTerminalError::Io(err))
					if err.kind() == io::ErrorKind::TimedOut =>
				{
					continue;
				}
				Err(err) => return Err(err),
			}
		}
	}

	pub fn write_input_text(
		&self,
		text: &str,
	) -> Result<(), HerdrTerminalError> {
		self.write_stdin(&serde_json::json!({
			"type": "terminal.input",
			"text": text,
		}))
	}

	pub fn write_input_bytes(
		&self,
		data: &[u8],
	) -> Result<(), HerdrTerminalError> {
		self.write_stdin(&serde_json::json!({
			"type": "terminal.input",
			"bytes": STANDARD.encode(data),
		}))
	}

	pub fn write_input(&self, data: &[u8]) -> Result<(), HerdrTerminalError> {
		match std::str::from_utf8(data) {
			Ok(text) => self.write_input_text(text),
			Err(_) => self.write_input_bytes(data),
		}
	}

	pub fn resize(
		&self,
		cols: u16,
		rows: u16,
	) -> Result<(), HerdrTerminalError> {
		if cols == 0 || rows == 0 {
			return Err(HerdrTerminalError::InvalidInput(
				"cols and rows must be > 0".into(),
			));
		}
		self.write_stdin(&serde_json::json!({
			"type": "terminal.resize",
			"cols": cols,
			"rows": rows,
		}))
	}

	pub fn scroll(
		&self,
		direction: model::runtime::TerminalScrollDirection,
		lines: u16,
		source: model::runtime::TerminalScrollSource,
	) -> Result<(), HerdrTerminalError> {
		if lines == 0 {
			return Err(HerdrTerminalError::InvalidInput(
				"scroll lines must be > 0".into(),
			));
		}
		let direction = match direction {
			model::runtime::TerminalScrollDirection::Up => "up",
			model::runtime::TerminalScrollDirection::Down => "down",
		};
		let source = match source {
			model::runtime::TerminalScrollSource::Wheel => "wheel",
			model::runtime::TerminalScrollSource::PageKey => "page_key",
		};
		self.write_stdin(&serde_json::json!({
			"type": "terminal.scroll",
			"direction": direction,
			"lines": lines,
			"source": source,
		}))
	}

	pub fn release(&self) -> Result<(), HerdrTerminalError> {
		if self.released.swap(true, Ordering::SeqCst) {
			return Ok(());
		}
		let _ = self.write_stdin(&serde_json::json!({
			"type": "terminal.release",
		}));
		self.kill_and_reap()
	}

	fn write_stdin(&self, value: &Value) -> Result<(), HerdrTerminalError> {
		let mut line = serde_json::to_vec(value)
			.map_err(|err| HerdrTerminalError::InvalidJson(err.to_string()))?;
		line.push(b'\n');
		let mut slot = self.stdin.lock().map_err(|_| {
			HerdrTerminalError::Io(io::Error::other("stdin lock poisoned"))
		})?;
		let stdin = slot.as_mut().ok_or(HerdrTerminalError::NotAttached)?;
		stdin.write_all(&line)?;
		stdin.flush()?;
		Ok(())
	}

	fn kill_and_reap(&self) -> Result<(), HerdrTerminalError> {
		if let Ok(mut slot) = self.stdin.lock() {
			*slot = None;
		}
		let mut child = self.child.lock().map_err(|_| {
			HerdrTerminalError::Io(io::Error::other("child lock poisoned"))
		})?;
		let deadline = std::time::Instant::now() + Duration::from_millis(150);
		loop {
			match child.try_wait() {
				Ok(Some(_)) => break,
				Ok(None) if std::time::Instant::now() < deadline => {
					thread::sleep(Duration::from_millis(10));
				}
				_ => {
					let _ = child.kill();
					let _ = child.wait();
					break;
				}
			}
		}
		if let Ok(mut reader) = self.reader.lock() {
			if let Some(handle) = reader.take() {
				let _ = handle.join();
			}
		}
		Ok(())
	}
}

impl Drop for TerminalSessionHelper {
	fn drop(&mut self) {
		let _ = self.release();
	}
}

fn spawn_helper(
	req: TerminalAttachRequest<'_>,
) -> Result<TerminalSessionHelper, HerdrTerminalError> {
	#[cfg(windows)]
	{
		let _ = req;
		return Err(HerdrTerminalError::UnsupportedPlatform {
			message: "Windows live terminal attach is unsupported (#396)"
				.into(),
		});
	}
	#[cfg(not(windows))]
	{
		spawn_unix(req)
	}
}

#[cfg(not(windows))]
fn spawn_unix(
	req: TerminalAttachRequest<'_>,
) -> Result<TerminalSessionHelper, HerdrTerminalError> {
	if req.pane_id.is_empty() {
		return Err(HerdrTerminalError::Refused {
			reason: "pane_id is required".into(),
		});
	}
	endpoint_not_allowed(&req.env.namespace.socket_path).map_err(|err| {
		HerdrTerminalError::Refused {
			reason: err.to_string(),
		}
	})?;
	if req.takeover {
		return Err(HerdrTerminalError::Refused {
			reason: "refusing silent --takeover".into(),
		});
	}

	let mut cmd = command_without_windows_console(req.env.executable);
	req.env.apply_to(&mut cmd);
	cmd.args(["terminal", "session", req.mode.as_arg(), req.pane_id]);
	if let Some(cols) = req.cols.filter(|cols| *cols > 0) {
		cmd.args(["--cols", &cols.to_string()]);
	}
	if let Some(rows) = req.rows.filter(|rows| *rows > 0) {
		cmd.args(["--rows", &rows.to_string()]);
	}
	cmd.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());
	let mut child = cmd.spawn()?;
	let stdin = child.stdin.take().ok_or_else(|| {
		HerdrTerminalError::Io(io::Error::other("helper stdin missing"))
	})?;
	let stdout = child.stdout.take().ok_or_else(|| {
		HerdrTerminalError::Io(io::Error::other("helper stdout missing"))
	})?;

	let pending_bytes = Arc::new(AtomicUsize::new(0));
	let pending_frames = Arc::new(AtomicUsize::new(0));
	let (tx, rx) = mpsc::sync_channel(req.limits.max_pending_frames.max(1) + 1);
	let limits = req.limits;
	let pending = Arc::clone(&pending_bytes);
	let queued = Arc::clone(&pending_frames);
	let handle = thread::Builder::new()
		.name("herdr-term".into())
		.spawn(move || {
			read_stdout(stdout, tx, pending, queued, limits);
		})
		.map_err(HerdrTerminalError::from)?;

	Ok(TerminalSessionHelper {
		child: Mutex::new(child),
		stdin: Mutex::new(Some(stdin)),
		events: Mutex::new(rx),
		pending_bytes,
		pending_frames,
		released: AtomicBool::new(false),
		reader: Mutex::new(Some(handle)),
	})
}

fn read_stdout(
	mut stdout: impl Read,
	tx: mpsc::SyncSender<Result<TerminalFrame, HerdrTerminalError>>,
	pending_bytes: Arc<AtomicUsize>,
	pending_frames: Arc<AtomicUsize>,
	limits: BufferLimits,
) {
	let mut framer = NdjsonFramer::new(limits.max_line_bytes);
	let mut leftover = VecDeque::new();
	let mut buf = [0_u8; 4096];
	loop {
		match stdout.read(&mut buf) {
			Ok(0) => {
				let _ = tx.try_send(Err(HerdrTerminalError::Closed {
					reason: "helper exited".into(),
				}));
				break;
			}
			Ok(n) => match framer.push(&buf[..n]) {
				Ok(lines) => {
					leftover.extend(lines);
					while let Some(line) = leftover.pop_front() {
						if !dispatch_line(
							&line,
							&tx,
							&pending_bytes,
							&pending_frames,
							limits,
						) {
							return;
						}
					}
				}
				Err(err) => {
					let _ = tx.try_send(Err(err));
					break;
				}
			},
			Err(err) if is_timeout(&err) => continue,
			Err(err) => {
				let _ = tx.try_send(Err(err.into()));
				break;
			}
		}
	}
}

fn dispatch_line(
	line: &[u8],
	tx: &mpsc::SyncSender<Result<TerminalFrame, HerdrTerminalError>>,
	pending_bytes: &AtomicUsize,
	pending_frames: &AtomicUsize,
	limits: BufferLimits,
) -> bool {
	match decode_line(line) {
		Ok(Decoded::Frame(frame)) => {
			let size = frame.bytes.len();
			let pending = pending_bytes.load(Ordering::SeqCst);
			let queued = pending_frames.load(Ordering::SeqCst);
			if queued >= limits.max_pending_frames
				|| pending + size > limits.max_pending_bytes
			{
				let _ = tx.try_send(Err(HerdrTerminalError::SlowConsumer {
					pending_bytes: pending,
					pending_frames: queued,
				}));
				return false;
			}
			pending_bytes.fetch_add(size, Ordering::SeqCst);
			pending_frames.fetch_add(1, Ordering::SeqCst);
			match tx.try_send(Ok(frame)) {
				Ok(()) => true,
				Err(TrySendError::Full(_)) => {
					pending_bytes.fetch_sub(size, Ordering::SeqCst);
					pending_frames.fetch_sub(1, Ordering::SeqCst);
					let _ =
						tx.try_send(Err(HerdrTerminalError::SlowConsumer {
							pending_bytes: pending,
							pending_frames: queued,
						}));
					false
				}
				Err(TrySendError::Disconnected(_)) => false,
			}
		}
		Ok(Decoded::Closed { reason }) => {
			let err = if is_controller_conflict(&reason) {
				HerdrTerminalError::ControllerConflict { reason }
			} else {
				HerdrTerminalError::Closed { reason }
			};
			let _ = tx.try_send(Err(err));
			false
		}
		Err(err) => {
			let _ = tx.try_send(Err(err));
			false
		}
	}
}

fn is_controller_conflict(reason: &str) -> bool {
	reason.contains(CONTROLLER_CONFLICT)
}

fn is_timeout(err: &io::Error) -> bool {
	err.kind() == io::ErrorKind::TimedOut
		|| err.kind() == io::ErrorKind::WouldBlock
		|| err.kind() == io::ErrorKind::Interrupted
}

struct NdjsonFramer {
	buf: Vec<u8>,
	max: usize,
}

impl NdjsonFramer {
	fn new(max: usize) -> Self {
		Self {
			buf: Vec::new(),
			max,
		}
	}

	fn push(
		&mut self,
		data: &[u8],
	) -> Result<Vec<Vec<u8>>, HerdrTerminalError> {
		self.buf.extend_from_slice(data);
		let mut lines = Vec::new();
		loop {
			let Some(end) = self.buf.iter().position(|&byte| byte == b'\n')
			else {
				if self.buf.len() > self.max {
					return Err(HerdrTerminalError::MessageTooLarge {
						size: self.buf.len(),
						limit: self.max,
					});
				}
				break;
			};
			if end > self.max {
				return Err(HerdrTerminalError::MessageTooLarge {
					size: end,
					limit: self.max,
				});
			}
			let mut line: Vec<u8> = self.buf.drain(..=end).collect();
			line.pop();
			if line.last() == Some(&b'\r') {
				line.pop();
			}
			if !line.is_empty() {
				lines.push(line);
			}
		}
		Ok(lines)
	}
}

#[derive(Deserialize)]
struct WireLine {
	#[serde(rename = "type")]
	kind: String,
	#[serde(default)]
	seq: Option<u64>,
	#[serde(default)]
	encoding: Option<String>,
	#[serde(default)]
	width: Option<u16>,
	#[serde(default)]
	height: Option<u16>,
	#[serde(default)]
	full: Option<bool>,
	#[serde(default)]
	bytes: Option<String>,
	#[serde(default)]
	reason: Option<String>,
}

enum Decoded {
	Frame(TerminalFrame),
	Closed { reason: String },
}

fn decode_line(line: &[u8]) -> Result<Decoded, HerdrTerminalError> {
	let text = std::str::from_utf8(line)
		.map_err(|err| HerdrTerminalError::InvalidJson(err.to_string()))?;
	let parsed: WireLine = serde_json::from_str(text).map_err(|err| {
		HerdrTerminalError::InvalidJson(format!("{err}: {text}"))
	})?;
	match parsed.kind.as_str() {
		"terminal.frame" => {
			if parsed.encoding.as_deref().unwrap_or("ansi") != "ansi" {
				return Err(HerdrTerminalError::InvalidJson(format!(
					"unsupported encoding {:?}",
					parsed.encoding
				)));
			}
			let raw = parsed.bytes.ok_or_else(|| {
				HerdrTerminalError::InvalidJson("frame missing bytes".into())
			})?;
			let bytes =
				STANDARD.decode(raw.trim().as_bytes()).map_err(|err| {
					HerdrTerminalError::InvalidJson(err.to_string())
				})?;
			Ok(Decoded::Frame(TerminalFrame {
				seq: parsed.seq.unwrap_or(0),
				full: parsed.full.unwrap_or(false),
				width: parsed.width.unwrap_or(0),
				height: parsed.height.unwrap_or(0),
				bytes,
			}))
		}
		"terminal.closed" => Ok(Decoded::Closed {
			reason: parsed.reason.unwrap_or_default(),
		}),
		other => Err(HerdrTerminalError::InvalidJson(format!(
			"unexpected type {other}"
		))),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::Value;
	use std::fs;
	use std::path::Path;

	fn fixture(name: &str) -> Value {
		let path = Path::new(env!("CARGO_MANIFEST_DIR"))
			.join("tests/fixtures/herdr/frames")
			.join(name);
		serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
	}

	fn record_line(name: &str) -> Vec<u8> {
		let mut line = serde_json::to_vec(&fixture(name)["record"]).unwrap();
		line.push(b'\n');
		line
	}

	fn contains_bytes(hay: &[u8], needle: &[u8]) -> bool {
		hay.windows(needle.len()).any(|window| window == needle)
	}

	#[test]
	fn decode_full_and_incremental_fixtures() {
		let full = decode_line(&record_line("full-redraw.json")).unwrap();
		let Decoded::Frame(full) = full else {
			panic!("expected frame");
		};
		assert!(full.full);
		assert_eq!(full.seq, 1);
		assert_eq!(full.width, 80);
		assert_eq!(full.height, 24);
		assert!(contains_bytes(&full.bytes, b"\x1b[?2026h"));
		assert!(contains_bytes(&full.bytes, b"\x1b[2J"));
		assert!(contains_bytes(&full.bytes, b"\x1b[1;1H"));

		let incr = decode_line(&record_line("incremental.json")).unwrap();
		let Decoded::Frame(incr) = incr else {
			panic!("expected frame");
		};
		assert!(!incr.full);
		assert_eq!(incr.seq, 2);
		assert!(incr.seq > 1);
		assert!(contains_bytes(&incr.bytes, b"INCR_LINE_XYZ"));
		assert!(!contains_bytes(&incr.bytes, b"\x1b[2J"));

		let uni = decode_line(&record_line("unicode-ansi.json")).unwrap();
		let Decoded::Frame(uni) = uni else {
			panic!("expected frame");
		};
		assert!(contains_bytes(&uni.bytes, "αβγ".as_bytes()));
		assert!(contains_bytes(&uni.bytes, b"\x1b[31m"));
	}

	#[test]
	fn decode_conflict_is_structured_and_not_takeover() {
		let closed = decode_line(&record_line("closed-conflict.json")).unwrap();
		let Decoded::Closed { reason } = closed else {
			panic!("expected closed");
		};
		assert!(is_controller_conflict(&reason));
		assert!(reason.contains(CONTROLLER_CONFLICT));
		let err = HerdrTerminalError::ControllerConflict { reason };
		let app = AppError::from(err);
		assert!(app.to_string().contains("controller conflict"));
		assert!(app.to_string().contains(CONTROLLER_CONFLICT));
	}

	#[test]
	fn framer_reassembles_split_lines_and_rejects_oversize() {
		let mut framer = NdjsonFramer::new(256);
		assert!(framer.push(b"{\"type\":\"terminal.fr").unwrap().is_empty());
		let lines = framer
			.push(br#"ame","seq":1,"encoding":"ansi","width":1,"height":1,"full":false,"bytes":"YQ=="}
"#)
			.unwrap();
		assert_eq!(lines.len(), 1);
		let Decoded::Frame(frame) = decode_line(&lines[0]).unwrap() else {
			panic!("expected frame");
		};
		assert_eq!(frame.bytes, b"a");
		let err = NdjsonFramer::new(8).push(&[b'x'; 40]).unwrap_err();
		assert!(matches!(
			err,
			HerdrTerminalError::MessageTooLarge { limit: 8, .. }
		));
	}

	#[test]
	fn dsr_da_is_not_answered_from_frames() {
		let src = include_str!("terminal.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(!src.contains("6n"));
		assert!(!src.contains("?62;22c"));
		assert!(!src.contains("CSI c"));
		let _ = fixture("dsr-da.json");
	}

	#[test]
	fn windows_attach_is_fail_closed() {
		let src = include_str!("terminal.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(src.contains("cfg(windows)"));
		assert!(src.contains("UnsupportedPlatform"));
		assert!(src.contains("#396"));
		#[cfg(windows)]
		{
			let ns = super::super::process::resolve_namespace_with(
				PathBuf::from("/tmp/xdg"),
				None,
				None,
			)
			.unwrap();
			let env = HerdrProcessEnv::new(Path::new("herdr"), &ns);
			let err =
				TerminalSessionHelper::attach_control(TerminalAttachRequest {
					env: &env,
					pane_id: "w1:p1",
					mode: TerminalSessionMode::Control,
					cols: None,
					rows: None,
					takeover: false,
					limits: BufferLimits::default(),
				})
				.unwrap_err();
			assert!(matches!(
				err,
				HerdrTerminalError::UnsupportedPlatform { .. }
			));
			assert!(AppError::from(err).to_string().contains("unsupported"));
		}
	}

	#[test]
	fn production_attach_is_control_without_takeover_or_binary_socket() {
		let src = include_str!("terminal.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(src.contains("attach_control"));
		assert!(src.contains("terminal session"));
		assert!(!src.contains("SESSION_NAME"));
		assert!(!src.contains("--session"));
		assert!(src.contains("takeover: false"));
		assert!(!src.contains("pane.send_text"));
		assert!(!src.contains("pane.send_input"));
		assert!(!src.contains("pane.send_keys"));
		assert!(!src.contains("tab.create"));
		assert!(!src.contains("pane.split"));
		assert!(!src.contains("workspace.create"));
		assert!(!src.contains("worktree."));
		assert!(!src.contains("server.stop"));
		assert!(!src.contains("pane.close("));
		assert!(!src.contains("herdr-client.sock"));
	}

	#[test]
	fn frame_converts_to_ipc_type_without_wire_fields() {
		let frame = TerminalFrame {
			seq: 3,
			full: false,
			width: 90,
			height: 28,
			bytes: b"x".to_vec(),
		};
		let ipc = HerdrTerminalFrame::from(frame);
		let json = serde_json::to_value(&ipc).unwrap();
		assert_eq!(json["seq"], 3);
		assert!(json.get("type").is_none());
		assert!(json.get("encoding").is_none());
	}
}

#[cfg(all(test, unix))]
mod unix_tests {
	use super::super::process::{resolve_namespace_with, HerdrNamespace};
	use super::*;
	use std::ffi::OsString;
	use std::fs;
	use std::os::unix::fs::PermissionsExt;
	use std::path::{Path, PathBuf};

	struct Fixture {
		_root: tempfile::TempDir,
		executable: PathBuf,
		namespace: HerdrNamespace,
		extra_env: Vec<(OsString, OsString)>,
		fake_dir: PathBuf,
	}

	impl Fixture {
		fn new() -> Self {
			let root = tempfile::tempdir().unwrap();
			let xdg = root.path().join("xdg-config");
			fs::create_dir_all(xdg.join("herdr")).unwrap();
			let fake_dir = root.path().join("fake");
			fs::create_dir_all(&fake_dir).unwrap();
			let executable = write_fake_cli(&fake_dir);
			let namespace = resolve_namespace_with(xdg, None, None).unwrap();
			let extra_env = vec![
				(OsString::from("HOME"), root.path().join("home").into()),
				(
					OsString::from("HERDR_FAKE_DIR"),
					fake_dir.as_os_str().to_os_string(),
				),
			];
			Self {
				_root: root,
				executable,
				namespace,
				extra_env,
				fake_dir,
			}
		}

		fn env(&self) -> HerdrProcessEnv<'_> {
			HerdrProcessEnv {
				executable: &self.executable,
				namespace: &self.namespace,
				extra_env: &self.extra_env,
				ready_timeout: Duration::from_secs(3),
				cli_timeout: Duration::from_secs(3),
			}
		}

		fn args(&self) -> String {
			fs::read_to_string(self.fake_dir.join("args.log"))
				.unwrap_or_default()
		}

		fn env_log(&self) -> String {
			fs::read_to_string(self.fake_dir.join("env.log"))
				.unwrap_or_default()
		}

		fn stdin_log(&self) -> String {
			fs::read_to_string(self.fake_dir.join("stdin.log"))
				.unwrap_or_default()
		}

		fn write_frames(&self, body: &str) {
			fs::write(self.fake_dir.join("frames.ndjson"), body).unwrap();
		}

		fn set_flag(&self, name: &str) {
			fs::write(self.fake_dir.join(name), b"1").unwrap();
		}
	}

	fn write_fake_cli(fake_dir: &Path) -> PathBuf {
		let path = fake_dir.join("herdr");
		fs::write(
			&path,
			r#"#!/usr/bin/env python3
import os, sys, time, threading
from pathlib import Path

fake = Path(os.environ["HERDR_FAKE_DIR"])
fake.mkdir(parents=True, exist_ok=True)
(fake / "args.log").open("a").write(" ".join(sys.argv[1:]) + "\n")
(fake / "env.log").open("a").write(
    "HERDR_SESSION=%s HERDR_SOCKET_PATH=%s\n"
    % (os.environ.get("HERDR_SESSION", ""), os.environ.get("HERDR_SOCKET_PATH", ""))
)

def pump_stdin():
    with (fake / "stdin.log").open("ab") as out:
        while True:
            try:
                chunk = os.read(0, 4096)
            except OSError:
                break
            if not chunk:
                break
            out.write(chunk)
            out.flush()

threading.Thread(target=pump_stdin, daemon=True).start()

if (fake / "conflict").exists():
    sys.stdout.write(
        '{"type":"terminal.closed","reason":"terminal attach failed: terminal term_abc already has an attached client; retry with --takeover"}\n'
    )
    sys.stdout.flush()
    sys.exit(0)

if (fake / "flood").exists():
    for n in range(40):
        sys.stdout.write(
            '{"type":"terminal.frame","seq":%d,"encoding":"ansi","width":80,"height":24,"full":false,"bytes":"YQ=="}\n'
            % n
        )
        sys.stdout.flush()
elif (fake / "frames.ndjson").exists():
    data = (fake / "frames.ndjson").read_bytes()
    if (fake / "split").exists():
        mid = max(1, len(data) // 2)
        sys.stdout.buffer.write(data[:mid])
        sys.stdout.buffer.flush()
        time.sleep(0.05)
        sys.stdout.buffer.write(data[mid:])
        sys.stdout.buffer.flush()
    else:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()

if (fake / "stay").exists():
    time.sleep(30)
"#,
		)
		.unwrap();
		fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
		path
	}

	fn attach<'a>(
		_fx: &'a Fixture,
		env: &'a HerdrProcessEnv<'a>,
		limits: BufferLimits,
	) -> TerminalSessionHelper {
		TerminalSessionHelper::attach_control(TerminalAttachRequest {
			env,
			pane_id: "w1:p1",
			mode: TerminalSessionMode::Control,
			cols: Some(80),
			rows: Some(24),
			takeover: false,
			limits,
		})
		.unwrap()
	}

	#[test]
	fn control_spawn_uses_shared_socket_without_takeover() {
		let fx = Fixture::new();
		fx.write_frames(
			r#"{"type":"terminal.frame","seq":1,"encoding":"ansi","width":80,"height":24,"full":true,"bytes":"YQ=="}
"#,
		);
		let env = fx.env();
		let helper = attach(&fx, &env, BufferLimits::default());
		let frame = helper.recv_frame(Duration::from_secs(2)).unwrap();
		assert!(frame.full);
		assert_eq!(frame.seq, 1);
		assert_eq!(frame.bytes, b"a");
		drop(helper);
		let args = fx.args();
		assert!(!args.contains("--session"), "{args}");
		assert!(!args.contains("2code"), "{args}");
		assert!(args.contains("terminal session control w1:p1"), "{args}");
		assert!(!args.contains("--takeover"), "{args}");
		assert!(!args.contains("observe"), "{args}");
		assert!(!args.contains("pane.close"), "{args}");
		let env_log = fx.env_log();
		assert!(!env_log.contains("HERDR_SESSION=2code"), "{env_log}");
		assert!(
			env_log.contains(&format!(
				"HERDR_SOCKET_PATH={}",
				fx.namespace.socket_path.display()
			)),
			"{env_log}"
		);
		assert!(
			env_log.contains("/herdr/herdr.sock"),
			"attach must target the default socket: {env_log}"
		);
	}

	#[test]
	fn split_ndjson_and_input_resize_release_stdin() {
		let fx = Fixture::new();
		let full =
			serde_json::to_string(&fixture_record("full-redraw.json")).unwrap();
		let incr =
			serde_json::to_string(&fixture_record("incremental.json")).unwrap();
		fx.write_frames(&format!("{full}\n{incr}\n"));
		fx.set_flag("split");
		fx.set_flag("stay");
		let env = fx.env();
		let helper = attach(&fx, &env, BufferLimits::default());
		let first = helper.recv_frame(Duration::from_secs(2)).unwrap();
		let second = helper.recv_frame(Duration::from_secs(2)).unwrap();
		assert!(first.full);
		assert!(!second.full);
		assert!(first.seq < second.seq);
		helper.write_input(b"echo hi\n").unwrap();
		helper.resize(90, 28).unwrap();
		thread::sleep(Duration::from_millis(150));
		helper.release().unwrap();
		thread::sleep(Duration::from_millis(150));
		let stdin = fx.stdin_log();
		assert!(stdin.contains(r#""type":"terminal.input""#), "{stdin}");
		assert!(stdin.contains("echo hi"), "{stdin}");
		assert!(stdin.contains(r#""text""#), "{stdin}");
		assert!(!stdin.contains(r#""bytes""#), "{stdin}");
		assert!(stdin.contains(r#""type":"terminal.resize""#), "{stdin}");
		assert!(stdin.contains(r#""cols":90"#), "{stdin}");
		assert!(stdin.contains(r#""rows":28"#), "{stdin}");
		assert!(stdin.contains(r#""type":"terminal.release""#), "{stdin}");
		assert!(!stdin.contains("pane.close"), "{stdin}");
		assert!(!fx.args().contains("pane.close"));
	}

	#[test]
	fn scroll_writes_cli_terminal_scroll_not_pane_read() {
		let fx = Fixture::new();
		fx.set_flag("stay");
		fx.write_frames(
			r#"{"type":"terminal.frame","seq":1,"encoding":"ansi","width":80,"height":24,"full":true,"bytes":"YQ=="}
"#,
		);
		let env = fx.env();
		let helper = attach(&fx, &env, BufferLimits::default());
		helper
			.scroll(
				model::runtime::TerminalScrollDirection::Up,
				2,
				model::runtime::TerminalScrollSource::Wheel,
			)
			.unwrap();
		helper
			.scroll(
				model::runtime::TerminalScrollDirection::Down,
				24,
				model::runtime::TerminalScrollSource::PageKey,
			)
			.unwrap();
		let zero = helper
			.scroll(
				model::runtime::TerminalScrollDirection::Up,
				0,
				model::runtime::TerminalScrollSource::Wheel,
			)
			.unwrap_err();
		assert!(zero.to_string().contains("> 0"), "{zero}");
		thread::sleep(Duration::from_millis(150));
		helper.release().unwrap();
		thread::sleep(Duration::from_millis(150));
		let stdin = fx.stdin_log();
		assert!(stdin.contains(r#""type":"terminal.scroll""#), "{stdin}");
		assert!(stdin.contains(r#""direction":"up""#), "{stdin}");
		assert!(stdin.contains(r#""lines":2"#), "{stdin}");
		assert!(stdin.contains(r#""source":"wheel""#), "{stdin}");
		assert!(stdin.contains(r#""source":"page_key""#), "{stdin}");
		assert!(!stdin.contains("pageKey"), "{stdin}");
		assert!(!stdin.contains("pane.read"), "{stdin}");
		assert!(!stdin.contains("pane.scroll"), "{stdin}");
	}

	fn fixture_record(name: &str) -> Value {
		let path = Path::new(env!("CARGO_MANIFEST_DIR"))
			.join("tests/fixtures/herdr/frames")
			.join(name);
		let json: Value =
			serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
		json["record"].clone()
	}

	#[test]
	fn slow_consumer_hits_buffer_bound() {
		let fx = Fixture::new();
		fx.set_flag("flood");
		fx.set_flag("stay");
		let env = fx.env();
		let helper = attach(
			&fx,
			&env,
			BufferLimits {
				max_line_bytes: MAX_LINE_BYTES,
				max_pending_frames: 2,
				max_pending_bytes: 32,
			},
		);
		thread::sleep(Duration::from_millis(200));
		let err = loop {
			match helper.recv_frame(Duration::from_secs(2)) {
				Ok(_) => continue,
				Err(err) => break err,
			}
		};
		assert!(
			matches!(err, HerdrTerminalError::SlowConsumer { .. }),
			"expected slow consumer, got {err}"
		);
	}

	#[test]
	fn controller_conflict_does_not_pass_takeover() {
		let fx = Fixture::new();
		fx.set_flag("conflict");
		let env = fx.env();
		let helper = attach(&fx, &env, BufferLimits::default());
		let err = helper.recv_frame(Duration::from_secs(2)).unwrap_err();
		match err {
			HerdrTerminalError::ControllerConflict { reason } => {
				assert!(reason.contains(CONTROLLER_CONFLICT), "{reason}");
			}
			other => panic!("expected conflict, got {other}"),
		}
		assert!(!fx.args().contains("--takeover"), "{}", fx.args());
	}

	#[test]
	fn drop_kills_child_and_does_not_pane_close() {
		let fx = Fixture::new();
		fx.set_flag("stay");
		let env = fx.env();
		let helper = attach(&fx, &env, BufferLimits::default());
		let pid = helper.child_id().unwrap();
		drop(helper);
		thread::sleep(Duration::from_millis(80));
		unsafe {
			assert_eq!(libc::kill(pid as i32, 0), -1, "helper must be gone");
		}
		assert!(!fx.args().contains("pane.close"));
		assert!(!fx.stdin_log().contains("pane.close"));
	}

	#[test]
	fn takeover_flag_is_refused() {
		let fx = Fixture::new();
		let env = fx.env();
		let err =
			match TerminalSessionHelper::attach_control(TerminalAttachRequest {
				env: &env,
				pane_id: "w1:p1",
				mode: TerminalSessionMode::Control,
				cols: None,
				rows: None,
				takeover: true,
				limits: BufferLimits::default(),
			}) {
				Err(err) => err,
				Ok(_) => panic!("expected takeover to be refused"),
			};
		assert!(matches!(err, HerdrTerminalError::Refused { .. }));
		assert!(fx.args().is_empty());
	}

	#[test]
	fn default_json_socket_is_allowed_client_socket_is_refused() {
		let fx = Fixture::new();
		assert!(fx
			.namespace
			.socket_path
			.to_string_lossy()
			.ends_with("herdr/herdr.sock"));
		fx.write_frames(
			r#"{"type":"terminal.frame","seq":1,"encoding":"ansi","width":80,"height":24,"full":true,"bytes":"YQ=="}
"#,
		);
		let env = fx.env();
		let helper =
			TerminalSessionHelper::attach_control(TerminalAttachRequest {
				env: &env,
				pane_id: "w1:p1",
				mode: TerminalSessionMode::Control,
				cols: None,
				rows: None,
				takeover: false,
				limits: BufferLimits::default(),
			})
			.unwrap();
		drop(helper);

		let mut namespace = fx.namespace.clone();
		namespace.socket_path =
			fx.namespace.xdg_config_home.join("herdr/herdr-client.sock");
		let env = HerdrProcessEnv {
			executable: &fx.executable,
			namespace: &namespace,
			extra_env: &fx.extra_env,
			ready_timeout: Duration::from_secs(1),
			cli_timeout: Duration::from_secs(1),
		};
		let err =
			TerminalSessionHelper::attach_control(TerminalAttachRequest {
				env: &env,
				pane_id: "w1:p1",
				mode: TerminalSessionMode::Control,
				cols: None,
				rows: None,
				takeover: false,
				limits: BufferLimits::default(),
			});
		assert!(err.is_err());
	}

	#[test]
	fn live_control_input_resize_release_keeps_pane() {
		let Some(live) = require_live() else {
			return;
		};
		let created = live.create_workspace();
		let pane_id = created["result"]["root_pane"]["pane_id"]
			.as_str()
			.unwrap()
			.to_string();
		assert!(!pane_id.is_empty());
		let env = live.env();
		let helper =
			TerminalSessionHelper::attach_control(TerminalAttachRequest {
				env: &env,
				pane_id: &pane_id,
				mode: TerminalSessionMode::Control,
				cols: Some(80),
				rows: Some(24),
				takeover: false,
				limits: BufferLimits::default(),
			})
			.unwrap();
		let first = helper.recv_frame(Duration::from_secs(5)).unwrap();
		assert!(first.full);
		helper.write_input(b"true\n").unwrap();
		helper.resize(80, 24).unwrap();
		helper.release().unwrap();
		thread::sleep(Duration::from_millis(100));
		let still = live.pane_get(&pane_id);
		assert!(still.is_some(), "pane must stay alive after release");
	}

	struct Live {
		bin: PathBuf,
		root: tempfile::TempDir,
		namespace: HerdrNamespace,
		extra_env: Vec<(OsString, OsString)>,
		_lock: std::sync::MutexGuard<'static, ()>,
		_lease: super::super::process::HerdrServerLease,
	}

	impl Live {
		fn start() -> Option<Self> {
			let lock = crate::herdr::lock_live_herdr_tests();
			let bin = live_binary()?;
			let root = tempfile::tempdir().unwrap();
			let xdg = root.path().join("xdg-config");
			fs::create_dir_all(xdg.join("herdr")).unwrap();
			fs::write(
				xdg.join("herdr/config.toml"),
				"onboarding = false\n\n[ui.sound]\nenabled = false\n",
			)
			.unwrap();
			let namespace = resolve_namespace_with(xdg, None, None).unwrap();
			let extra_env = vec![
				(
					OsString::from("HOME"),
					root.path().join("home").into_os_string(),
				),
				(
					OsString::from("XDG_STATE_HOME"),
					root.path().join("xdg-state").into_os_string(),
				),
				(
					OsString::from("XDG_CACHE_HOME"),
					root.path().join("xdg-cache").into_os_string(),
				),
			];
			let repo = root.path().join("repo");
			fs::create_dir_all(&repo).unwrap();
			init_git_repo(&repo);
			let env = HerdrProcessEnv {
				executable: &bin,
				namespace: &namespace,
				extra_env: &extra_env,
				ready_timeout: Duration::from_secs(10),
				cli_timeout: Duration::from_secs(5),
			};
			let lease = match super::super::process::ensure_server(&env) {
				Ok(lease) => lease,
				Err(_) => return None,
			};
			Some(Self {
				bin,
				root,
				namespace,
				extra_env,
				_lock: lock,
				_lease: lease,
			})
		}

		fn env(&self) -> HerdrProcessEnv<'_> {
			HerdrProcessEnv {
				executable: &self.bin,
				namespace: &self.namespace,
				extra_env: &self.extra_env,
				ready_timeout: Duration::from_secs(10),
				cli_timeout: Duration::from_secs(5),
			}
		}

		fn create_workspace(&self) -> Value {
			let client = crate::herdr::transport::HerdrClient::connect_path(
				&self.namespace.socket_path,
			)
			.unwrap();
			let repo = self.root.path().join("repo");
			let success = client
				.request(
					"ws1",
					"workspace.create",
					serde_json::json!({
						"cwd": repo.to_string_lossy(),
						"label": "live-term",
						"trust_repository": true,
						"focus": false,
					}),
				)
				.unwrap();
			serde_json::json!({ "result": success.result })
		}

		fn pane_get(&self, pane_id: &str) -> Option<Value> {
			let client = crate::herdr::transport::HerdrClient::connect_path(
				&self.namespace.socket_path,
			)
			.unwrap();
			client
				.pane_get(pane_id)
				.ok()
				.flatten()
				.map(|pane| serde_json::json!({ "pane_id": pane.pane_id }))
		}
	}

	impl Drop for Live {
		fn drop(&mut self) {
			let mut cmd = std::process::Command::new(&self.bin);
			cmd.env_remove("HERDR_SESSION")
				.env("HERDR_SOCKET_PATH", &self.namespace.socket_path)
				.env("XDG_CONFIG_HOME", &self.namespace.xdg_config_home)
				.env("HOME", self.root.path().join("home"))
				.args(["server", "stop"]);
			let _ = cmd.status();
		}
	}

	fn live_binary() -> Option<PathBuf> {
		if let Ok(Some(path)) = crate::herdr::locate_cached_host_binary() {
			return Some(path);
		}
		let triple = crate::herdr::host_triple().ok()?;
		crate::herdr::try_resolve_sidecar(&crate::herdr::ResolveOptions {
			triple,
			exe_dir: None,
			binaries_dir: Some(&crate::herdr::default_binaries_dir()),
		})
		.ok()
		.flatten()
	}

	fn init_git_repo(repo: &Path) {
		assert!(std::process::Command::new("git")
			.args(["init", "-b", "main"])
			.current_dir(repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.status()
			.unwrap()
			.success());
		for (key, value) in
			[("user.email", "term@example.test"), ("user.name", "Term")]
		{
			assert!(std::process::Command::new("git")
				.args(["config", key, value])
				.current_dir(repo)
				.env("GIT_CONFIG_GLOBAL", "/dev/null")
				.env("GIT_CONFIG_SYSTEM", "/dev/null")
				.status()
				.unwrap()
				.success());
		}
		fs::write(repo.join("README.md"), "# fixture\n").unwrap();
		assert!(std::process::Command::new("git")
			.args(["add", "README.md"])
			.current_dir(repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.status()
			.unwrap()
			.success());
		assert!(std::process::Command::new("git")
			.args(["commit", "-m", "init"])
			.current_dir(repo)
			.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.status()
			.unwrap()
			.success());
	}

	fn require_live() -> Option<Live> {
		match Live::start() {
			Some(live) => Some(live),
			None if crate::herdr::sidecar_required()
				|| std::env::var_os("HERDR_CONTRACT_REQUIRED").is_some() =>
			{
				panic!(
					"pinned Herdr binary missing; see docs/herdr-integration.md"
				);
			}
			None => {
				eprintln!(
					"skipping live Herdr terminal attach (set HERDR_SIDECAR_REQUIRED=1 to fail)"
				);
				None
			}
		}
	}
}
