// @generated automatically by Diesel CLI.

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
	pty_output_chunks (id) {
		id -> Integer,
		session_id -> Text,
		data -> Binary,
		byte_len -> Integer,
	}
}

diesel::table! {
	pty_output_state (session_id) {
		session_id -> Text,
		total_bytes -> Integer,
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

diesel::joinable!(profiles -> projects (project_id));
diesel::joinable!(pty_output_chunks -> pty_sessions (session_id));
diesel::joinable!(pty_output_state -> pty_sessions (session_id));
diesel::joinable!(pty_sessions -> profiles (profile_id));

diesel::allow_tables_to_appear_in_same_query!(
	profiles,
	projects,
	pty_output_chunks,
	pty_output_state,
	pty_sessions,
);
