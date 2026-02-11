// @generated automatically by Diesel CLI.

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
		id -> Nullable<Integer>,
		session_id -> Text,
		data -> Binary,
	}
}

diesel::table! {
	pty_sessions (id) {
		id -> Text,
		project_id -> Text,
		title -> Text,
		shell -> Text,
		cwd -> Text,
		created_at -> Timestamp,
		closed_at -> Nullable<Timestamp>,
	}
}

diesel::joinable!(pty_output_chunks -> pty_sessions (session_id));
diesel::joinable!(pty_sessions -> projects (project_id));

diesel::allow_tables_to_appear_in_same_query!(
	projects,
	pty_output_chunks,
	pty_sessions,
);
