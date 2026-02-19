use crate::schema::{daily_activity, session_stats};
use diesel::prelude::*;
use serde::Serialize;

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = session_stats)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SessionStat {
	pub id: String,
	pub session_type: String,
	pub profile_id: String,
	pub project_id: String,
	pub project_name: String,
	pub branch_name: Option<String>,
	pub shell: Option<String>,
	pub cwd: Option<String>,
	pub agent: Option<String>,
	pub event_count: Option<i32>,
	pub user_message_count: Option<i32>,
	pub agent_message_count: Option<i32>,
	pub created_at: i32,
	pub closed_at: Option<i32>,
	pub duration_seconds: Option<i32>,
}

#[derive(Insertable)]
#[diesel(table_name = session_stats)]
pub struct NewSessionStat<'a> {
	pub id: &'a str,
	pub session_type: &'a str,
	pub profile_id: &'a str,
	pub project_id: &'a str,
	pub project_name: &'a str,
	pub branch_name: Option<&'a str>,
	pub shell: Option<&'a str>,
	pub cwd: Option<&'a str>,
	pub agent: Option<&'a str>,
	pub event_count: Option<i32>,
	pub user_message_count: Option<i32>,
	pub agent_message_count: Option<i32>,
	pub created_at: i32,
	pub closed_at: Option<i32>,
	pub duration_seconds: Option<i32>,
}

#[derive(Queryable, Selectable, Serialize)]
#[diesel(table_name = daily_activity)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DailyActivity {
	pub date: String,
	pub project_id: String,
	pub terminal_sessions: i32,
	pub agent_sessions: i32,
	pub terminal_seconds: i32,
	pub agent_seconds: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomepageStats {
	pub total_projects: i64,
	pub sessions_today: i64,
	pub active_time_today_seconds: i64,
	pub current_streak_days: i64,
	pub recent_sessions: Vec<SessionStat>,
	pub daily_activity: Vec<DailyActivity>,
	pub top_projects: Vec<ProjectActivitySummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActivitySummary {
	pub project_id: String,
	pub project_name: String,
	pub session_count: i64,
	pub total_seconds: i64,
	pub last_active_at: i64,
}
