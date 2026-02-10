// @generated automatically by Diesel CLI.

diesel::table! {
    projects (id) {
        id -> Text,
        name -> Text,
        folder -> Text,
        created_at -> Timestamp,
    }
}
