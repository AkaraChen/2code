//! Map projected Herdr pane agent state onto 2code sessions.
//!
//! Session id is live `pane_id`. Missing panes hydrate as `None`
//! (no Local fallback). The live Channel fail-closes by sending
//! `unknown` and stopping.

use model::error::AppError;
use model::runtime::SessionAgentStatus;

use crate::runtime_sync::ProjectedPane;

pub fn session_agent_from_pane(
	session_id: &str,
	pane: &ProjectedPane,
) -> SessionAgentStatus {
	SessionAgentStatus {
		session_id: session_id.to_string(),
		status: pane.agent_status.clone(),
		agent_name: pane
			.agent_identity
			.as_ref()
			.and_then(|identity| identity.display_name().map(str::to_string)),
	}
}

/// Synthesized DTO when a Herdr-owned session has no Bound pane.
/// `unknown` maps to idle in the GUI (no badge, no detector fallback).
pub fn fail_closed_session_agent(session_id: &str) -> SessionAgentStatus {
	SessionAgentStatus {
		session_id: session_id.to_string(),
		status: "unknown".into(),
		agent_name: None,
	}
}

pub const SESSION_AGENT_POLL: std::time::Duration =
	std::time::Duration::from_millis(200);

/// Poll projected agent status onto a Channel until the pane is
/// missing/replaced or `send` reports the Channel dropped.
///
/// Every Bound snapshot is sent, including unchanged `working` /
/// `blocked` / `unknown`, so a dropped Channel unblocks the loop.
/// `None` fail-closes with [`fail_closed_session_agent`] and stops
/// instead of spinning.
pub fn pump_session_agent_status<F, S>(
	session_id: &str,
	fetch: F,
	send: S,
) -> Result<(), AppError>
where
	F: FnMut() -> Result<Option<SessionAgentStatus>, AppError>,
	S: FnMut(SessionAgentStatus) -> bool,
{
	pump_session_agent_status_with(session_id, fetch, send, || {
		std::thread::sleep(SESSION_AGENT_POLL)
	})
}

pub fn pump_session_agent_status_with<F, S, W>(
	session_id: &str,
	mut fetch: F,
	mut send: S,
	mut wait: W,
) -> Result<(), AppError>
where
	F: FnMut() -> Result<Option<SessionAgentStatus>, AppError>,
	S: FnMut(SessionAgentStatus) -> bool,
	W: FnMut(),
{
	loop {
		match fetch()? {
			Some(status) => {
				if !send(status) {
					break;
				}
			}
			None => {
				let _ = send(fail_closed_session_agent(session_id));
				break;
			}
		}
		wait();
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn working_dto() -> SessionAgentStatus {
		SessionAgentStatus {
			session_id: "sess-1".into(),
			status: "working".into(),
			agent_name: Some("Claude Code".into()),
		}
	}

	#[test]
	fn first_tick_none_fail_closes_and_does_not_poll_again() {
		let fetches = std::cell::Cell::new(0);
		let waits = std::cell::Cell::new(0);
		let sent = std::cell::RefCell::new(Vec::new());
		pump_session_agent_status_with(
			"sess-1",
			|| {
				fetches.set(fetches.get() + 1);
				Ok(None)
			},
			|dto| {
				sent.borrow_mut().push(dto);
				true
			},
			|| waits.set(waits.get() + 1),
		)
		.unwrap();
		assert_eq!(fetches.get(), 1);
		assert_eq!(waits.get(), 0);
		assert_eq!(
			sent.borrow().as_slice(),
			&[fail_closed_session_agent("sess-1")]
		);
	}

	#[test]
	fn missing_pane_after_working_sends_unknown_then_stops() {
		let fetches = std::cell::Cell::new(0);
		let waits = std::cell::Cell::new(0);
		let sent = std::cell::RefCell::new(Vec::new());
		pump_session_agent_status_with(
			"sess-1",
			|| {
				let n = fetches.get();
				fetches.set(n + 1);
				if n == 0 {
					Ok(Some(working_dto()))
				} else {
					Ok(None)
				}
			},
			|dto| {
				sent.borrow_mut().push(dto);
				true
			},
			|| waits.set(waits.get() + 1),
		)
		.unwrap();
		assert_eq!(fetches.get(), 2);
		assert_eq!(waits.get(), 1);
		assert_eq!(
			sent.borrow().as_slice(),
			&[working_dto(), fail_closed_session_agent("sess-1")]
		);
	}

	#[test]
	fn dropped_channel_stops_even_when_status_is_unchanged() {
		let fetches = std::cell::Cell::new(0);
		let waits = std::cell::Cell::new(0);
		let sends = std::cell::Cell::new(0);
		pump_session_agent_status_with(
			"sess-1",
			|| {
				fetches.set(fetches.get() + 1);
				Ok(Some(working_dto()))
			},
			|_dto| {
				sends.set(sends.get() + 1);
				false
			},
			|| waits.set(waits.get() + 1),
		)
		.unwrap();
		assert_eq!(fetches.get(), 1);
		assert_eq!(sends.get(), 1);
		assert_eq!(waits.get(), 0);
	}
}
