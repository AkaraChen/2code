use diesel::prelude::*;
use diesel::sql_types::{Integer, Text};

use model::error::AppError;
use model::schema::{daily_activity, projects, session_stats};
use model::stats::{
	DailyActivity, HomepageStats, NewSessionStat, ProjectActivitySummary,
	SessionStat,
};

pub fn insert_session_stat(
	conn: &mut SqliteConnection,
	record: &NewSessionStat,
) -> Result<(), AppError> {
	diesel::insert_into(session_stats::table)
		.values(record)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	Ok(())
}

pub fn upsert_daily_activity(
	conn: &mut SqliteConnection,
	date: &str,
	project_id: &str,
	is_terminal: bool,
	duration_seconds: i32,
) -> Result<(), AppError> {
	if is_terminal {
		diesel::sql_query(
			"INSERT INTO daily_activity (date, project_id, terminal_sessions, terminal_seconds) \
			 VALUES (?, ?, 1, ?) \
			 ON CONFLICT(date, project_id) DO UPDATE SET \
			 terminal_sessions = terminal_sessions + 1, \
			 terminal_seconds = terminal_seconds + excluded.terminal_seconds",
		)
		.bind::<Text, _>(date)
		.bind::<Text, _>(project_id)
		.bind::<Integer, _>(duration_seconds)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	} else {
		diesel::sql_query(
			"INSERT INTO daily_activity (date, project_id, agent_sessions, agent_seconds) \
			 VALUES (?, ?, 1, ?) \
			 ON CONFLICT(date, project_id) DO UPDATE SET \
			 agent_sessions = agent_sessions + 1, \
			 agent_seconds = agent_seconds + excluded.agent_seconds",
		)
		.bind::<Text, _>(date)
		.bind::<Text, _>(project_id)
		.bind::<Integer, _>(duration_seconds)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	}
	Ok(())
}

pub fn get_recent_sessions(
	conn: &mut SqliteConnection,
	limit: i64,
) -> Result<Vec<SessionStat>, AppError> {
	session_stats::table
		.order(session_stats::created_at.desc())
		.limit(limit)
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn get_daily_activity(
	conn: &mut SqliteConnection,
	since_date: &str,
) -> Result<Vec<DailyActivity>, AppError> {
	daily_activity::table
		.filter(daily_activity::date.ge(since_date))
		.order(daily_activity::date.asc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn get_sessions_today_count(
	conn: &mut SqliteConnection,
	today: &str,
) -> Result<i64, AppError> {
	use diesel::dsl::count;

	session_stats::table
		.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
			"date(created_at, 'unixepoch', 'localtime') = '{today}'"
		)))
		.select(count(session_stats::id))
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn get_active_time_today(
	conn: &mut SqliteConnection,
	today: &str,
) -> Result<i64, AppError> {
	use diesel::dsl::sum;

	let total: Option<i64> = session_stats::table
		.filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
			"date(created_at, 'unixepoch', 'localtime') = '{today}'"
		)))
		.select(sum(session_stats::duration_seconds))
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(total.unwrap_or(0))
}

pub fn get_current_streak(
	conn: &mut SqliteConnection,
	today: &str,
) -> Result<i64, AppError> {
	// Get distinct active dates in descending order
	let dates: Vec<String> = daily_activity::table
		.select(daily_activity::date)
		.distinct()
		.order(daily_activity::date.desc())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	if dates.is_empty() {
		return Ok(0);
	}

	// Parse today and count consecutive days backwards
	let today_date = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d")
		.unwrap_or_else(|_| chrono::Local::now().date_naive());

	let mut streak = 0i64;
	let mut expected = today_date;

	for date_str in &dates {
		if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
		{
			if date == expected {
				streak += 1;
				expected -= chrono::Duration::days(1);
			} else if date < expected {
				// Gap found
				break;
			}
		}
	}

	Ok(streak)
}

pub fn get_top_projects(
	conn: &mut SqliteConnection,
	since_date: &str,
	limit: i64,
) -> Result<Vec<ProjectActivitySummary>, AppError> {
	#[derive(QueryableByName)]
	struct RawProjectSummary {
		#[diesel(sql_type = Text)]
		project_id: String,
		#[diesel(sql_type = Text)]
		project_name: String,
		#[diesel(sql_type = diesel::sql_types::BigInt)]
		session_count: i64,
		#[diesel(sql_type = diesel::sql_types::BigInt)]
		total_seconds: i64,
		#[diesel(sql_type = diesel::sql_types::BigInt)]
		last_active_at: i64,
	}

	let results: Vec<RawProjectSummary> = diesel::sql_query(
		"SELECT project_id, project_name, \
		 COUNT(*) as session_count, \
		 COALESCE(SUM(duration_seconds), 0) as total_seconds, \
		 MAX(created_at) as last_active_at \
		 FROM session_stats \
		 WHERE date(created_at, 'unixepoch', 'localtime') >= ? \
		 GROUP BY project_id \
		 ORDER BY session_count DESC \
		 LIMIT ?",
	)
	.bind::<Text, _>(since_date)
	.bind::<diesel::sql_types::BigInt, _>(limit)
	.load(conn)
	.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(results
		.into_iter()
		.map(|r| ProjectActivitySummary {
			project_id: r.project_id,
			project_name: r.project_name,
			session_count: r.session_count,
			total_seconds: r.total_seconds,
			last_active_at: r.last_active_at,
		})
		.collect())
}

pub fn get_total_projects(
	conn: &mut SqliteConnection,
) -> Result<i64, AppError> {
	use diesel::dsl::count;

	projects::table
		.select(count(projects::id))
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn get_homepage_stats(
	conn: &mut SqliteConnection,
) -> Result<HomepageStats, AppError> {
	let today = chrono::Local::now().format("%Y-%m-%d").to_string();
	let ninety_days_ago = (chrono::Local::now() - chrono::Duration::days(90))
		.format("%Y-%m-%d")
		.to_string();
	let thirty_days_ago = (chrono::Local::now() - chrono::Duration::days(30))
		.format("%Y-%m-%d")
		.to_string();

	let total_projects = get_total_projects(conn)?;
	let sessions_today = get_sessions_today_count(conn, &today)?;
	let active_time_today_seconds = get_active_time_today(conn, &today)?;
	let current_streak_days = get_current_streak(conn, &today)?;
	let recent_sessions = get_recent_sessions(conn, 10)?;
	let daily_activity = get_daily_activity(conn, &ninety_days_ago)?;
	let top_projects = get_top_projects(conn, &thirty_days_ago, 5)?;

	Ok(HomepageStats {
		total_projects,
		sessions_today,
		active_time_today_seconds,
		current_streak_days,
		recent_sessions,
		daily_activity,
		top_projects,
	})
}
