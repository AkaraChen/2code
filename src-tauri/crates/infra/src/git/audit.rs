//! Git command audit log.
//!
//! Mirrors Fork's "show the git command being executed" transparency. Every
//! git operation routed through the `default_backend()` dispatcher emits a
//! `tracing::info!` event with target `git.audit`. The frontend's existing
//! debug panel (Cmd+Shift+D) picks these up via the tracing channel layer
//! in `infra::logger` and surfaces them in the "Git" filter.
//!
//! Direct callers of `infra::git::cli::*` free functions don't get audit
//! events for now — adding them requires touching ~20 call sites in cli.rs.
//! Phase 2 commit panel and beyond will go through the dispatcher and get
//! audit for free.

use std::time::Instant;

/// Wrap a git operation with audit logging. The closure is the actual work;
/// timing + result classification happens here.
pub fn audited<T, E>(
	op: &str,
	folder: &str,
	mut work: impl FnMut() -> Result<T, E>,
) -> Result<T, E>
where
	E: std::fmt::Display,
{
	let start = Instant::now();
	let result = work();
	let duration_ms = start.elapsed().as_millis() as u64;

	match &result {
		Ok(_) => {
			tracing::info!(
				target: "git.audit",
				op = op,
				folder = folder,
				duration_ms = duration_ms,
				ok = true,
				"git op",
			);
		}
		Err(e) => {
			tracing::info!(
				target: "git.audit",
				op = op,
				folder = folder,
				duration_ms = duration_ms,
				ok = false,
				error = %e,
				"git op",
			);
		}
	}

	result
}

/// Audit a void op (no Result).
pub fn audited_unit<T>(op: &str, folder: &str, mut work: impl FnMut() -> T) -> T {
	let start = Instant::now();
	let value = work();
	let duration_ms = start.elapsed().as_millis() as u64;
	tracing::info!(
		target: "git.audit",
		op = op,
		folder = folder,
		duration_ms = duration_ms,
		"git op",
	);
	value
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::mpsc;
	use std::time::Duration;
	use tracing_subscriber::prelude::*;

	use crate::logger::ChannelLayer;

	#[test]
	fn audited_emits_event_on_success() {
		let (layer, handle) = ChannelLayer::new();
		let (tx, rx) = mpsc::channel();
		handle.attach(move |entry| {
			tx.send(entry).ok();
			true
		});

		let subscriber = tracing_subscriber::registry().with(layer);
		tracing::subscriber::with_default(subscriber, || {
			let _: Result<i32, &str> = audited("test_op", "/tmp/foo", || Ok(42));
		});

		let entry = rx
			.recv_timeout(Duration::from_secs(1))
			.expect("receive entry");
		assert_eq!(entry.source, "git.audit");
		assert!(entry.message.contains("test_op"));
		assert!(entry.message.contains("/tmp/foo"));
		assert!(entry.message.contains("ok=true"));
	}

	#[test]
	fn audited_emits_event_on_error() {
		let (layer, handle) = ChannelLayer::new();
		let (tx, rx) = mpsc::channel();
		handle.attach(move |entry| {
			tx.send(entry).ok();
			true
		});

		let subscriber = tracing_subscriber::registry().with(layer);
		tracing::subscriber::with_default(subscriber, || {
			let _: Result<i32, &str> =
				audited("test_op", "/tmp/foo", || Err("boom"));
		});

		let entry = rx
			.recv_timeout(Duration::from_secs(1))
			.expect("receive entry");
		assert!(entry.message.contains("ok=false"));
		assert!(entry.message.contains("boom"));
	}
}
