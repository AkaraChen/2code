//! Bounded, backpressured live-output channel between the PTY read thread
//! and the per-session IPC stream task.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

/// Max queued messages between the PTY read thread and IPC stream task.
/// PTY reads are <=4096 bytes, bounding in-flight output to <=4 MiB/session.
pub const OUTPUT_CHANNEL_CAPACITY: usize = 1024;

/// Max bytes coalesced into one IPC message by the stream drain loop.
pub const MAX_BATCH_BYTES: usize = 256 * 1024;

pub struct PtyOutputSink {
	pub stream_id: String,
	pub sender: mpsc::Sender<Vec<u8>>,
}

pub struct PtyOutputReceiver {
	pub stream_id: String,
	pub receiver: mpsc::Receiver<Vec<u8>>,
}

pub type PtyOutputSinks = Arc<Mutex<HashMap<String, PtyOutputSink>>>;
pub type PtyOutputReceivers = Arc<Mutex<HashMap<String, PtyOutputReceiver>>>;

pub fn create_output_sinks() -> PtyOutputSinks {
	Arc::new(Mutex::new(HashMap::new()))
}

pub fn create_output_receivers() -> PtyOutputReceivers {
	Arc::new(Mutex::new(HashMap::new()))
}

pub fn create_output_channel(
) -> (mpsc::Sender<Vec<u8>>, mpsc::Receiver<Vec<u8>>) {
	mpsc::channel(OUTPUT_CHANNEL_CAPACITY)
}

/// Deliver one PTY chunk to the active sink with bounded-channel backpressure.
///
/// This blocks when the frontend falls behind. It must only be called from the
/// PTY reader OS thread, never from inside a Tokio runtime.
pub fn send_output(sinks: &PtyOutputSinks, session_id: &str, bytes: &[u8]) {
	let sender = {
		let Ok(map) = sinks.lock() else {
			return;
		};
		map.get(session_id).map(|sink| sink.sender.clone())
	};
	let Some(sender) = sender else {
		return;
	};

	if sender.blocking_send(bytes.to_vec()).is_err() {
		prune_stale_sink(sinks, session_id, &sender);
	}
}

pub fn prune_stale_sink(
	sinks: &PtyOutputSinks,
	session_id: &str,
	failed: &mpsc::Sender<Vec<u8>>,
) {
	if let Ok(mut map) = sinks.lock() {
		if map
			.get(session_id)
			.is_some_and(|sink| sink.sender.same_channel(failed))
		{
			map.remove(session_id);
		}
	}
}

pub fn coalesce_chunks(
	batch: &mut Vec<u8>,
	first: Vec<u8>,
	receiver: &mut mpsc::Receiver<Vec<u8>>,
	max_bytes: usize,
) {
	batch.clear();
	batch.extend_from_slice(&first);
	while batch.len() < max_bytes {
		match receiver.try_recv() {
			Ok(next) => batch.extend_from_slice(&next),
			Err(_) => break,
		}
	}
}

#[cfg(test)]
mod tests {
	use std::thread;
	use std::time::{Duration, Instant};

	use super::*;

	#[test]
	fn bounded_channel_applies_backpressure_without_loss() {
		let (sender, mut receiver) = mpsc::channel(4);
		let producer = thread::spawn(move || {
			for index in 0..100u8 {
				sender.blocking_send(vec![index]).unwrap();
			}
		});

		thread::sleep(Duration::from_millis(50));
		let mut received = Vec::new();
		while received.len() < 100 {
			let chunk = receiver.blocking_recv().unwrap();
			received.push(chunk[0]);
		}
		producer.join().unwrap();

		assert_eq!(received, (0..100u8).collect::<Vec<_>>());
	}

	#[test]
	fn blocked_producer_unblocks_when_receiver_drops() {
		let (sender, receiver) = mpsc::channel(1);
		sender.blocking_send(vec![1]).unwrap();
		let producer =
			thread::spawn(move || sender.blocking_send(vec![2]).is_err());

		thread::sleep(Duration::from_millis(50));
		drop(receiver);

		assert!(producer.join().unwrap());
	}

	#[test]
	fn send_output_is_noop_without_sink() {
		let sinks = create_output_sinks();

		send_output(&sinks, "missing", b"hello");

		assert!(sinks.lock().unwrap().is_empty());
	}

	#[test]
	fn send_output_prunes_sink_after_receiver_drop() {
		let sinks = create_output_sinks();
		let (sender, receiver) = mpsc::channel(1);
		drop(receiver);
		sinks.lock().unwrap().insert(
			"session".to_string(),
			PtyOutputSink {
				stream_id: "stream".to_string(),
				sender,
			},
		);

		send_output(&sinks, "session", b"hello");

		assert!(!sinks.lock().unwrap().contains_key("session"));
	}

	#[test]
	fn prune_stale_sink_spares_replacement() {
		let sinks = create_output_sinks();
		let (sender_a, _receiver_a) = mpsc::channel(1);
		let sender_a_clone = sender_a.clone();
		let (sender_b, _receiver_b) = mpsc::channel(1);
		sinks.lock().unwrap().insert(
			"session".to_string(),
			PtyOutputSink {
				stream_id: "stream-a".to_string(),
				sender: sender_a,
			},
		);
		sinks.lock().unwrap().insert(
			"session".to_string(),
			PtyOutputSink {
				stream_id: "stream-b".to_string(),
				sender: sender_b,
			},
		);

		prune_stale_sink(&sinks, "session", &sender_a_clone);

		assert_eq!(
			sinks.lock().unwrap().get("session").unwrap().stream_id,
			"stream-b",
		);
	}

	#[test]
	fn send_output_does_not_hold_lock_while_blocked() {
		let sinks = create_output_sinks();
		let (sender, receiver) = mpsc::channel(1);
		sender.blocking_send(vec![0]).unwrap();
		sinks.lock().unwrap().insert(
			"session".to_string(),
			PtyOutputSink {
				stream_id: "stream".to_string(),
				sender,
			},
		);

		let blocked_sinks = sinks.clone();
		let producer = thread::spawn(move || {
			send_output(&blocked_sinks, "session", b"blocked");
		});

		let deadline = Instant::now() + Duration::from_secs(1);
		let mut acquired = false;
		while Instant::now() < deadline {
			if sinks.try_lock().is_ok() {
				acquired = true;
				break;
			}
			thread::sleep(Duration::from_millis(5));
		}
		drop(receiver);
		producer.join().unwrap();

		assert!(acquired);
	}

	#[test]
	fn coalesce_chunks_single_chunk_passthrough() {
		let (_sender, mut receiver) = mpsc::channel(4);
		let mut batch = Vec::new();

		coalesce_chunks(&mut batch, vec![1, 2], &mut receiver, 8);

		assert_eq!(batch, vec![1, 2]);
	}

	#[test]
	fn coalesce_chunks_concatenates_in_order() {
		let (sender, mut receiver) = mpsc::channel(4);
		sender.blocking_send(vec![2]).unwrap();
		sender.blocking_send(vec![3]).unwrap();
		sender.blocking_send(vec![4]).unwrap();
		let mut batch = Vec::new();

		coalesce_chunks(&mut batch, vec![1], &mut receiver, 8);

		assert_eq!(batch, vec![1, 2, 3, 4]);
	}

	#[test]
	fn coalesce_chunks_respects_max_bytes() {
		let (sender, mut receiver) = mpsc::channel(4);
		sender.blocking_send(vec![2, 2, 2, 2]).unwrap();
		sender.blocking_send(vec![3, 3, 3, 3]).unwrap();
		let mut batch = Vec::new();

		coalesce_chunks(&mut batch, vec![1, 1, 1, 1, 1], &mut receiver, 8);

		assert_eq!(batch, vec![1, 1, 1, 1, 1, 2, 2, 2, 2]);
		assert_eq!(receiver.try_recv().unwrap(), vec![3, 3, 3, 3]);
	}

	#[test]
	fn coalesce_chunks_handles_disconnected_sender() {
		let (sender, mut receiver) = mpsc::channel(4);
		sender.blocking_send(vec![2]).unwrap();
		drop(sender);
		let mut batch = Vec::new();

		coalesce_chunks(&mut batch, vec![1], &mut receiver, 8);

		assert_eq!(batch, vec![1, 2]);
	}
}
