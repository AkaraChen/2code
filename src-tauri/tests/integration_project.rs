mod common;

use diesel::prelude::*;
use infra::no_window::command_without_windows_console;

use common::{
	add_commit, cleanup, create_project_with_git_repo, create_temp_git_repo,
	setup_db,
};

fn create_project_named(
	conn: &mut SqliteConnection,
	name: &str,
) -> (model::project::Project, std::path::PathBuf) {
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "Initial commit");
	let folder = dir.to_string_lossy().to_string();
	let project = service::project::create_from_folder(conn, name, &folder)
		.expect("create project from folder");

	(project, dir)
}

// ============================================================
// Project Creation (basic)
// ============================================================

#[test]
fn create_from_folder_returns_correct_project() {
	let mut conn = setup_db();
	let dir = create_temp_git_repo();
	add_commit(&dir, "a.txt", "hello", "init");
	let folder = dir.to_string_lossy().to_string();

	let project =
		service::project::create_from_folder(&mut conn, "FromFolder", &folder)
			.unwrap();

	assert_eq!(project.name, "FromFolder");
	assert_eq!(project.folder, folder);
	assert!(!project.id.is_empty());

	cleanup(&dir);
}

#[test]
fn create_from_folder_nonexistent_returns_error() {
	let mut conn = setup_db();
	let result = service::project::create_from_folder(
		&mut conn,
		"NoFolder",
		"/nonexistent/path/that/does/not/exist",
	);
	assert!(result.is_err());
}

#[test]
fn create_from_folder_creates_default_profile() {
	let mut conn = setup_db();
	let dir = create_temp_git_repo();
	add_commit(&dir, "a.txt", "hi", "init");
	let folder = dir.to_string_lossy().to_string();

	let project =
		service::project::create_from_folder(&mut conn, "Test", &folder)
			.unwrap();

	let list = service::project::list(&mut conn).unwrap();
	let pwp = list.iter().find(|p| p.id == project.id).unwrap();
	assert_eq!(pwp.profiles.len(), 1);
	assert!(pwp.profiles[0].is_default);

	cleanup(&dir);
}

// ============================================================
// Project Creation (Edge Cases)
// ============================================================

#[test]
fn create_duplicate_project_names_allowed() {
	let mut conn = setup_db();
	let (p1, dir1) = create_project_named(&mut conn, "Same Name");
	let (p2, dir2) = create_project_named(&mut conn, "Same Name");

	assert_ne!(p1.id, p2.id);
	assert_eq!(p1.name, p2.name);

	let list = service::project::list(&mut conn).unwrap();
	assert_eq!(list.len(), 2);

	cleanup(&dir1);
	cleanup(&dir2);
}

#[test]
fn create_duplicate_project_folders_allowed() {
	let mut conn = setup_db();
	let dir = create_temp_git_repo();
	add_commit(&dir, "a.txt", "x", "init");
	let folder = dir.to_string_lossy().to_string();

	let p1 =
		service::project::create_from_folder(&mut conn, "A", &folder).unwrap();
	let p2 =
		service::project::create_from_folder(&mut conn, "B", &folder).unwrap();

	assert_ne!(p1.id, p2.id);
	assert_eq!(p1.folder, p2.folder);

	cleanup(&dir);
}

#[test]
fn create_with_whitespace_only_name() {
	let mut conn = setup_db();
	let (project, dir) = create_project_named(&mut conn, "   ");

	assert_eq!(project.name, "   ");
	assert!(!project.folder.is_empty());

	cleanup(&dir);
}

#[test]
fn create_with_emoji_name() {
	let mut conn = setup_db();
	let (project, dir) = create_project_named(&mut conn, "🚀🔥");

	assert_eq!(project.name, "🚀🔥");

	cleanup(&dir);
}

#[test]
fn create_with_very_long_name() {
	let mut conn = setup_db();
	let long_name = "a".repeat(100);
	let (project, dir) = create_project_named(&mut conn, &long_name);

	assert_eq!(project.name, long_name);

	cleanup(&dir);
}

#[test]
fn create_with_special_chars_name() {
	let mut conn = setup_db();
	let (project, dir) = create_project_named(&mut conn, "!@#$%^&*()");

	assert_eq!(project.name, "!@#$%^&*()");

	cleanup(&dir);
}

#[test]
fn create_with_cjk_name() {
	let mut conn = setup_db();
	let (project, dir) = create_project_named(&mut conn, "我的项目");

	assert_eq!(project.name, "我的项目");

	cleanup(&dir);
}

// ============================================================
// Project List (data shape validation)
// ============================================================

#[test]
fn list_returns_project_with_profiles_shape() {
	let mut conn = setup_db();
	let (project, _default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	let list = service::project::list(&mut conn).unwrap();
	assert_eq!(list.len(), 1);

	let pwp = &list[0];
	assert_eq!(pwp.id, project.id);
	assert_eq!(pwp.name, project.name);
	assert_eq!(pwp.folder, project.folder);
	assert!(!pwp.created_at.is_empty());
	assert!(!pwp.profiles.is_empty());

	let profile = &pwp.profiles[0];
	assert!(!profile.id.is_empty());
	assert_eq!(profile.project_id, project.id);
	assert!(!profile.branch_name.is_empty());
	assert!(!profile.worktree_path.is_empty());
	assert!(!profile.created_at.is_empty());
	assert!(profile.is_default);

	cleanup(&dir);
}

#[test]
fn list_empty_database() {
	let mut conn = setup_db();
	let list = service::project::list(&mut conn).unwrap();
	assert!(list.is_empty());
}

#[test]
fn list_multiple_projects_each_with_profiles() {
	let mut conn = setup_db();
	let (_p1, _profile1, dir1) = create_project_with_git_repo(&mut conn);
	let (_p2, _profile2, dir2) = create_project_with_git_repo(&mut conn);

	let list = service::project::list(&mut conn).unwrap();
	assert_eq!(list.len(), 2);
	for pwp in &list {
		assert!(!pwp.profiles.is_empty());
		assert!(pwp.profiles.iter().any(|p| p.is_default));
	}

	cleanup(&dir1);
	cleanup(&dir2);
}

// ============================================================
// Project Update
// ============================================================

#[test]
fn update_name_only() {
	let mut conn = setup_db();
	let (project, dir) = create_project_named(&mut conn, "Old");

	let updated = service::project::update(
		&mut conn,
		&project.id,
		Some("New".into()),
		None,
	)
	.unwrap();

	assert_eq!(updated.name, "New");
	assert_eq!(updated.folder, project.folder);

	cleanup(&dir);
}

#[test]
fn update_nonexistent_returns_error() {
	let mut conn = setup_db();
	let result = service::project::update(
		&mut conn,
		"nonexistent-id",
		Some("X".into()),
		None,
	);
	assert!(result.is_err());
}

// ============================================================
// Project Delete (cascade)
// ============================================================

#[test]
fn delete_cascades_to_profiles_and_sessions() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// Insert a PTY session on the default profile
	let session_record = model::pty::NewPtySessionRecord {
		id: "sess-1",
		project_id: &project.id,
		profile_id: &default_profile.id,
		title: "bash",
		shell: "/bin/bash",
		cwd: &project.folder,
		cols: 80,
		rows: 24,
	};
	repo::pty::insert_session(&mut conn, &session_record).unwrap();

	// Verify session exists
	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	assert_eq!(sessions.len(), 1);

	// Delete project — should cascade to profiles and sessions
	service::project::delete(&mut conn, &project.id).unwrap();

	let list = service::project::list(&mut conn).unwrap();
	assert!(list.is_empty());

	// Session row should be gone via FK cascade. (Its output log file, if any,
	// is a separate concern reaped by the startup orphan-log GC.)
	let remaining = repo::pty::all_session_ids(&mut conn).unwrap();
	assert!(!remaining.contains(&"sess-1".to_string()));

	cleanup(&dir);
}

#[test]
fn delete_nonexistent_returns_error() {
	let mut conn = setup_db();
	let result = service::project::delete(&mut conn, "nonexistent-id");
	assert!(result.is_err());
}

// ============================================================
// Project Groups (automatic cleanup)
// ============================================================

#[test]
fn moving_last_project_out_of_group_deletes_group() {
	let mut conn = setup_db();
	let (project, _default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let group = service::project::create_group(&mut conn, "Work").unwrap();

	service::project::assign_to_group(
		&mut conn,
		&project.id,
		Some(group.id.clone()),
	)
	.unwrap();
	assert_eq!(service::project::list_groups(&mut conn).unwrap().len(), 1);

	let updated =
		service::project::assign_to_group(&mut conn, &project.id, None)
			.unwrap();
	assert_eq!(updated.group_id, None);
	assert!(service::project::list_groups(&mut conn).unwrap().is_empty());

	cleanup(&dir);
}

#[test]
fn moving_project_between_groups_deletes_empty_previous_group() {
	let mut conn = setup_db();
	let (project, _default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let work = service::project::create_group(&mut conn, "Work").unwrap();
	let personal =
		service::project::create_group(&mut conn, "Personal").unwrap();

	service::project::assign_to_group(
		&mut conn,
		&project.id,
		Some(work.id.clone()),
	)
	.unwrap();
	let updated = service::project::assign_to_group(
		&mut conn,
		&project.id,
		Some(personal.id.clone()),
	)
	.unwrap();

	assert_eq!(updated.group_id.as_deref(), Some(personal.id.as_str()));
	let groups = service::project::list_groups(&mut conn).unwrap();
	assert_eq!(groups.len(), 1);
	assert_eq!(groups[0].id, personal.id);

	cleanup(&dir);
}

#[test]
fn deleting_last_project_in_group_deletes_group() {
	let mut conn = setup_db();
	let (project, _default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let group = service::project::create_group(&mut conn, "Work").unwrap();

	service::project::assign_to_group(
		&mut conn,
		&project.id,
		Some(group.id.clone()),
	)
	.unwrap();
	service::project::delete(&mut conn, &project.id).unwrap();

	assert!(service::project::list_groups(&mut conn).unwrap().is_empty());

	cleanup(&dir);
}

#[test]
fn moving_project_out_keeps_group_when_other_projects_remain() {
	let mut conn = setup_db();
	let (first, _first_default_profile, first_dir) =
		create_project_with_git_repo(&mut conn);
	let (second, _second_default_profile, second_dir) =
		create_project_with_git_repo(&mut conn);
	let group = service::project::create_group(&mut conn, "Work").unwrap();

	service::project::assign_to_group(
		&mut conn,
		&first.id,
		Some(group.id.clone()),
	)
	.unwrap();
	service::project::assign_to_group(
		&mut conn,
		&second.id,
		Some(group.id.clone()),
	)
	.unwrap();
	service::project::assign_to_group(&mut conn, &first.id, None).unwrap();

	let groups = service::project::list_groups(&mut conn).unwrap();
	assert_eq!(groups.len(), 1);
	assert_eq!(groups[0].id, group.id);

	cleanup(&first_dir);
	cleanup(&second_dir);
}

#[test]
fn startup_cleanup_deletes_existing_empty_groups() {
	let mut conn = setup_db();
	let (project, _default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let empty = service::project::create_group(&mut conn, "Empty").unwrap();
	let used = service::project::create_group(&mut conn, "Used").unwrap();

	service::project::assign_to_group(
		&mut conn,
		&project.id,
		Some(used.id.clone()),
	)
	.unwrap();
	let deleted_count = service::project::cleanup_empty_groups(&mut conn)
		.expect("cleanup empty groups");

	assert_eq!(deleted_count, 1);
	let groups = service::project::list_groups(&mut conn).unwrap();
	assert_eq!(groups.len(), 1);
	assert_ne!(groups[0].id, empty.id);
	assert_eq!(groups[0].id, used.id);

	cleanup(&dir);
}

// ============================================================
// Local extras fail closed after sqlite profiles DROP
// ============================================================

#[test]
fn local_extras_create_fails_closed_without_git_worktree() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let before = command_without_windows_console("git")
		.args(["worktree", "list", "--porcelain"])
		.current_dir(&dir)
		.output()
		.unwrap();

	let err =
		service::profile::create(&mut conn, &project.id, "feature-branch")
			.unwrap_err();
	assert!(err.to_string().contains("no longer creates extra"), "{err}");

	let after = command_without_windows_console("git")
		.args(["worktree", "list", "--porcelain"])
		.current_dir(&dir)
		.output()
		.unwrap();
	assert_eq!(after.stdout, before.stdout);

	let list = service::project::list(&mut conn).unwrap();
	let pwp = list.iter().find(|p| p.id == project.id).unwrap();
	assert_eq!(pwp.profiles.len(), 1);
	assert_eq!(pwp.profiles[0].id, default_profile.id);
	assert!(pwp.profiles[0].is_default);

	cleanup(&dir);
}

#[test]
fn local_extras_delete_fails_closed_without_git_worktree_remove() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let before = command_without_windows_console("git")
		.args(["worktree", "list", "--porcelain"])
		.current_dir(&dir)
		.output()
		.unwrap();

	let err = service::profile::delete(&mut conn, "extra-id").unwrap_err();
	assert!(err.to_string().contains("no longer deletes extra"), "{err}");
	let err =
		service::profile::delete(&mut conn, &default_profile.id).unwrap_err();
	assert!(err.to_string().contains("Cannot delete default"), "{err}");

	let after = command_without_windows_console("git")
		.args(["worktree", "list", "--porcelain"])
		.current_dir(&dir)
		.output()
		.unwrap();
	assert_eq!(after.stdout, before.stdout);
	let _ = project;
	cleanup(&dir);
}

#[test]
fn local_list_is_only_the_folder_default() {
	let mut conn = setup_db();
	let (project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let list = service::project::list(&mut conn).unwrap();
	let pwp = list.iter().find(|p| p.id == project.id).unwrap();
	assert_eq!(pwp.profiles.len(), 1);
	assert_eq!(pwp.profiles[0].id, default_profile.id);
	assert_eq!(pwp.profiles[0].worktree_path, project.folder);
	cleanup(&dir);
}
