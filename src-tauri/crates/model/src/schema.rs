// @generated automatically by Diesel CLI.

diesel::table! {
	checkout_notes (project_id, checkout_path) {
		project_id -> Text,
		checkout_path -> Text,
		notes -> Text,
		created_at -> Timestamp,
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

diesel::joinable!(checkout_notes -> projects (project_id));
diesel::joinable!(projects -> project_groups (group_id));

diesel::allow_tables_to_appear_in_same_query!(
	checkout_notes,
	project_groups,
	projects,
);
