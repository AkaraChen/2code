// @generated automatically by Diesel CLI.

diesel::table! {
	agent_session_events (id) {
		id -> Text,
		event_index -> Integer,
		session_id -> Text,
		created_at -> Integer,
		sender -> Text,
		payload_json -> Text,
		turn_index -> Integer,
	}
}

diesel::table! {
	agent_sessions (id) {
		id -> Text,
		agent -> Text,
		acp_session_id -> Text,
		profile_id -> Text,
		created_at -> Integer,
		destroyed_at -> Nullable<Integer>,
		session_init_json -> Nullable<Text>,
	}
}

diesel::table! {
	daily_activity (date, project_id) {
		date -> Text,
		project_id -> Text,
		terminal_sessions -> Integer,
		agent_sessions -> Integer,
		terminal_seconds -> Integer,
		agent_seconds -> Integer,
	}
}

diesel::table! {
	profiles (id) {
		id -> Text,
		project_id -> Text,
		branch_name -> Text,
		worktree_path -> Text,
		created_at -> Timestamp,
		is_default -> Bool,
	}
}

diesel::table! {
	projects (id) {
		id -> Text,
		name -> Text,
		folder -> Text,
		created_at -> Timestamp,
	}
}

diesel::table! {
	pty_session_output (session_id) {
		session_id -> Text,
		data -> Binary,
	}
}

diesel::table! {
	pty_sessions (id) {
		id -> Text,
		profile_id -> Text,
		title -> Text,
		shell -> Text,
		cwd -> Text,
		created_at -> Timestamp,
		closed_at -> Nullable<Timestamp>,
		cols -> Integer,
		rows -> Integer,
	}
}

diesel::table! {
	session_stats (id) {
		id -> Text,
		session_type -> Text,
		profile_id -> Text,
		project_id -> Text,
		project_name -> Text,
		branch_name -> Nullable<Text>,
		shell -> Nullable<Text>,
		cwd -> Nullable<Text>,
		agent -> Nullable<Text>,
		event_count -> Nullable<Integer>,
		user_message_count -> Nullable<Integer>,
		agent_message_count -> Nullable<Integer>,
		created_at -> Integer,
		closed_at -> Nullable<Integer>,
		duration_seconds -> Nullable<Integer>,
	}
}

diesel::table! {
	snippets (id) {
		id -> Text,
		name -> Text,
		trigger -> Text,
		content -> Text,
		created_at -> Timestamp,
	}
}

diesel::joinable!(agent_session_events -> agent_sessions (session_id));
diesel::joinable!(agent_sessions -> profiles (profile_id));
diesel::joinable!(profiles -> projects (project_id));
diesel::joinable!(pty_session_output -> pty_sessions (session_id));
diesel::joinable!(pty_sessions -> profiles (profile_id));

diesel::allow_tables_to_appear_in_same_query!(
	agent_session_events,
	agent_sessions,
	daily_activity,
	profiles,
	projects,
	pty_session_output,
	pty_sessions,
	session_stats,
	snippets,
);
