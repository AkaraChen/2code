// @generated automatically by Diesel CLI.

diesel::table! {
	profiles (id) {
		id -> Text,
		project_id -> Text,
		branch_name -> Text,
		worktree_path -> Text,
		created_at -> Timestamp,
		is_default -> Bool,
		notes -> Text,
	}
}

diesel::table! {
	project_groups (id) {
		id -> Text,
		name -> Text,
		created_at -> Timestamp,
		sort_order -> Integer,
	}
}

diesel::table! {
	projects (id) {
		id -> Text,
		name -> Text,
		folder -> Text,
		created_at -> Timestamp,
		group_id -> Nullable<Text>,
		sort_order -> Integer,
		pinned_at -> Nullable<Timestamp>,
		pinned_order -> Nullable<Integer>,
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
diesel::joinable!(projects -> project_groups (group_id));
diesel::joinable!(pty_sessions -> profiles (profile_id));

diesel::allow_tables_to_appear_in_same_query!(
	profiles,
	project_groups,
	projects,
	pty_sessions,
);
