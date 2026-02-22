use std::time::{SystemTime, UNIX_EPOCH};

use diesel::SqliteConnection;

use model::error::AppError;
use model::stats::{HomepageStats, NewSessionStat};

fn now_epoch() -> i32 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_secs() as i32
}

/// Parse a SQLite TIMESTAMP string ("YYYY-MM-DD HH:MM:SS") to unix epoch seconds.
fn parse_timestamp(ts: &str) -> Option<i32> {
	chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S")
		.ok()
		.map(|dt| dt.and_utc().timestamp() as i32)
}

/// Today's date as "YYYY-MM-DD" in local time.
fn today_str() -> String {
	chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Resolve project_id + project_name from a profile_id.
fn resolve_project_info(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<(String, String, String), AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	let project = repo::project::find_by_id(conn, &profile.project_id)?;
	Ok((project.id, project.name, profile.branch_name))
}

/// Capture stats for a PTY session before it is hard-deleted.
pub fn capture_terminal_stats(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<(), AppError> {
	let session = match repo::pty::get_session(conn, session_id) {
		Ok(s) => s,
		Err(_) => return Ok(()), // Session already gone, skip
	};

	let (project_id, project_name, branch_name) =
		match resolve_project_info(conn, &session.profile_id) {
			Ok(info) => info,
			Err(_) => return Ok(()), // Profile/project already gone, skip
		};

	let created_at =
		parse_timestamp(&session.created_at).unwrap_or_else(now_epoch);
	let closed_at = session
		.closed_at
		.as_deref()
		.and_then(parse_timestamp)
		.unwrap_or_else(now_epoch);
	let duration = (closed_at - created_at).max(0);

	let record = NewSessionStat {
		id: &session.id,
		session_type: "terminal",
		profile_id: &session.profile_id,
		project_id: &project_id,
		project_name: &project_name,
		branch_name: Some(&branch_name),
		shell: Some(&session.shell),
		cwd: Some(&session.cwd),
		agent: None,
		event_count: None,
		user_message_count: None,
		agent_message_count: None,
		created_at,
		closed_at: Some(closed_at),
		duration_seconds: Some(duration),
	};

	repo::stats::insert_session_stat(conn, &record)?;
	let _ = repo::stats::upsert_daily_activity(
		conn,
		&today_str(),
		&project_id,
		true,
		duration,
	);

	tracing::info!(
		target: "stats",
		session_id = %session.id,
		duration,
		"captured terminal session stats"
	);
	Ok(())
}

/// Capture stats for an agent session before it is hard-deleted.
pub fn capture_agent_stats(
	conn: &mut SqliteConnection,
	session_id: &str,
) -> Result<(), AppError> {
	let session = match repo::agent::get_session(conn, session_id) {
		Ok(s) => s,
		Err(_) => return Ok(()),
	};

	let (project_id, project_name, branch_name) =
		match resolve_project_info(conn, &session.profile_id) {
			Ok(info) => info,
			Err(_) => return Ok(()),
		};

	let (user_count, agent_count) =
		repo::agent::count_events_by_sender(conn, session_id)
			.unwrap_or((0, 0));
	let total_events = user_count + agent_count;

	let created_at = session.created_at;
	let closed_at = session.destroyed_at.unwrap_or_else(now_epoch);
	let duration = (closed_at - created_at).max(0);

	let record = NewSessionStat {
		id: &session.id,
		session_type: "agent",
		profile_id: &session.profile_id,
		project_id: &project_id,
		project_name: &project_name,
		branch_name: Some(&branch_name),
		shell: None,
		cwd: None,
		agent: Some(&session.agent),
		event_count: Some(total_events as i32),
		user_message_count: Some(user_count as i32),
		agent_message_count: Some(agent_count as i32),
		created_at,
		closed_at: Some(closed_at),
		duration_seconds: Some(duration),
	};

	repo::stats::insert_session_stat(conn, &record)?;
	let _ = repo::stats::upsert_daily_activity(
		conn,
		&today_str(),
		&project_id,
		false,
		duration,
	);

	tracing::info!(
		target: "stats",
		session_id = %session.id,
		duration,
		total_events,
		"captured agent session stats"
	);
	Ok(())
}

/// Capture stats for all sessions belonging to a project (before project deletion).
pub fn capture_project_stats(
	conn: &mut SqliteConnection,
	project_id: &str,
) {
	// Capture PTY sessions
	if let Ok(pty_sessions) = repo::pty::list_by_project(conn, project_id) {
		for session in &pty_sessions {
			let _ = capture_terminal_stats(conn, &session.id);
		}
	}

	// Capture agent sessions
	if let Ok(agent_sessions) = repo::agent::list_by_project(conn, project_id)
	{
		for session in &agent_sessions {
			let _ = capture_agent_stats(conn, &session.id);
		}
	}
}

pub fn get_homepage_stats(
	conn: &mut SqliteConnection,
) -> Result<HomepageStats, AppError> {
	repo::stats::get_homepage_stats(conn)
}
