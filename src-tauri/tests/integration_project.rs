mod common;

use code_lib::service;
use common::{add_commit, cleanup, create_project_with_git_repo, create_temp_git_repo, setup_db};

// ============================================================
// Project Creation (basic)
// ============================================================

#[test]
fn create_temporary_returns_complete_project() {
	let mut conn = setup_db();
	let project = service::project::create_temporary(&mut conn, Some("My App".into())).unwrap();

	assert!(!project.id.is_empty());
	assert_eq!(project.name, "My App");
	assert!(!project.folder.is_empty());
	assert!(!project.created_at.is_empty());
	assert!(std::path::Path::new(&project.folder).exists());

	// git should be initialized
	let branch = service::project::get_branch(&project.folder).unwrap();
	assert!(!branch.is_empty());

	cleanup(std::path::Path::new(&project.folder));
}

#[test]
fn create_temporary_with_none_name_uses_untitled() {
	let mut conn = setup_db();
	let project = service::project::create_temporary(&mut conn, None).unwrap();

	assert_eq!(project.name, "Untitled");
	cleanup(std::path::Path::new(&project.folder));
}

#[test]
fn create_temporary_also_creates_default_profile() {
	let mut conn = setup_db();
	let project = service::project::create_temporary(&mut conn, Some("Test".into())).unwrap();

	let list = service::project::list(&mut conn).unwrap();
	assert_eq!(list.len(), 1);
	assert_eq!(list[0].profiles.len(), 1);
	assert!(list[0].profiles[0].is_default);
	assert_eq!(list[0].profiles[0].project_id, project.id);

	cleanup(std::path::Path::new(&project.folder));
}

#[test]
fn create_from_folder_returns_correct_project() {
	let mut conn = setup_db();
	let dir = create_temp_git_repo();
	add_commit(&dir, "a.txt", "hello", "init");
	let folder = dir.to_string_lossy().to_string();

	let project = service::project::create_from_folder(&mut conn, "FromFolder", &folder).unwrap();

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

	let project = service::project::create_from_folder(&mut conn, "Test", &folder).unwrap();

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
	let p1 = service::project::create_temporary(&mut conn, Some("Same Name".into())).unwrap();
	let p2 = service::project::create_temporary(&mut conn, Some("Same Name".into())).unwrap();

	assert_ne!(p1.id, p2.id);
	assert_eq!(p1.name, p2.name);

	let list = service::project::list(&mut conn).unwrap();
	assert_eq!(list.len(), 2);

	cleanup(std::path::Path::new(&p1.folder));
	cleanup(std::path::Path::new(&p2.folder));
}

#[test]
fn create_duplicate_project_folders_allowed() {
	let mut conn = setup_db();
	let dir = create_temp_git_repo();
	add_commit(&dir, "a.txt", "x", "init");
	let folder = dir.to_string_lossy().to_string();

	let p1 = service::project::create_from_folder(&mut conn, "A", &folder).unwrap();
	let p2 = service::project::create_from_folder(&mut conn, "B", &folder).unwrap();

	assert_ne!(p1.id, p2.id);
	assert_eq!(p1.folder, p2.folder);

	cleanup(&dir);
}

#[test]
fn create_with_whitespace_only_name() {
	let mut conn = setup_db();
	let project = service::project::create_temporary(&mut conn, Some("   ".into())).unwrap();

	// Name preserved as-is, but slug is empty so dir uses UUID
	assert_eq!(project.name, "   ");
	assert!(!project.folder.is_empty());

	cleanup(std::path::Path::new(&project.folder));
}

#[test]
fn create_with_emoji_name() {
	let mut conn = setup_db();
	let project = service::project::create_temporary(&mut conn, Some("🚀🔥".into())).unwrap();

	assert_eq!(project.name, "🚀🔥");

	cleanup(std::path::Path::new(&project.folder));
}

#[test]
fn create_with_very_long_name() {
	let mut conn = setup_db();
	// Use a moderate length that won't exceed filesystem limits (slug + UUID short id)
	let long_name = "a".repeat(100);
	let project =
		service::project::create_temporary(&mut conn, Some(long_name.clone())).unwrap();

	assert_eq!(project.name, long_name);

	cleanup(std::path::Path::new(&project.folder));
}

#[test]
fn create_with_special_chars_name() {
	let mut conn = setup_db();
	let project =
		service::project::create_temporary(&mut conn, Some("!@#$%^&*()".into())).unwrap();

	assert_eq!(project.name, "!@#$%^&*()");

	cleanup(std::path::Path::new(&project.folder));
}

#[test]
fn create_with_cjk_name() {
	let mut conn = setup_db();
	let project =
		service::project::create_temporary(&mut conn, Some("我的项目".into())).unwrap();

	assert_eq!(project.name, "我的项目");
	// Dir name should contain pinyin slug
	let dir_name = std::path::Path::new(&project.folder)
		.file_name()
		.unwrap()
		.to_string_lossy()
		.to_string();
	assert!(dir_name.contains("wo-de-xiang-mu"), "dir_name: {dir_name}");

	cleanup(std::path::Path::new(&project.folder));
}

// ============================================================
// Project List (data shape validation)
// ============================================================

#[test]
fn list_returns_project_with_profiles_shape() {
	let mut conn = setup_db();
	let project = service::project::create_temporary(&mut conn, Some("Shape".into())).unwrap();

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

	cleanup(std::path::Path::new(&project.folder));
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
	let p1 = service::project::create_temporary(&mut conn, Some("A".into())).unwrap();
	let p2 = service::project::create_temporary(&mut conn, Some("B".into())).unwrap();

	let list = service::project::list(&mut conn).unwrap();
	assert_eq!(list.len(), 2);
	for pwp in &list {
		assert!(!pwp.profiles.is_empty());
		assert!(pwp.profiles.iter().any(|p| p.is_default));
	}

	cleanup(std::path::Path::new(&p1.folder));
	cleanup(std::path::Path::new(&p2.folder));
}

// ============================================================
// Project Update
// ============================================================

#[test]
fn update_name_only() {
	let mut conn = setup_db();
	let project = service::project::create_temporary(&mut conn, Some("Old".into())).unwrap();

	let updated =
		service::project::update(&mut conn, &project.id, Some("New".into()), None).unwrap();

	assert_eq!(updated.name, "New");
	assert_eq!(updated.folder, project.folder);

	cleanup(std::path::Path::new(&project.folder));
}

#[test]
fn update_nonexistent_returns_error() {
	let mut conn = setup_db();
	let result =
		service::project::update(&mut conn, "nonexistent-id", Some("X".into()), None);
	assert!(result.is_err());
}

// ============================================================
// Project Delete (cascade)
// ============================================================

#[test]
fn delete_cascades_to_profiles_and_sessions() {
	let mut conn = setup_db();
	let (project, default_profile, dir) = create_project_with_git_repo(&mut conn);

	// Insert a PTY session on the default profile
	let session_record = code_lib::model::pty::NewPtySessionRecord {
		id: "sess-1",
		profile_id: &default_profile.id,
		title: "bash",
		shell: "/bin/bash",
		cwd: &project.folder,
		cols: 80,
		rows: 24,
	};
	code_lib::repo::pty::insert_session(&mut conn, &session_record).unwrap();

	// Verify session exists
	let sessions =
		service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	assert_eq!(sessions.len(), 1);

	// Delete project — should cascade to profiles and sessions
	service::project::delete(&mut conn, &project.id).unwrap();

	let list = service::project::list(&mut conn).unwrap();
	assert!(list.is_empty());

	// Session history should also be gone (FK cascade)
	let history_result = service::pty::get_history(&mut conn, "sess-1");
	assert!(history_result.is_err());

	cleanup(&dir);
}

#[test]
fn delete_nonexistent_returns_error() {
	let mut conn = setup_db();
	let result = service::project::delete(&mut conn, "nonexistent-id");
	assert!(result.is_err());
}

// ============================================================
// Profile Creation (basic)
// ============================================================

#[test]
fn create_profile_returns_correct_shape() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let profile =
		service::profile::create(&mut conn, &project.id, "feature-branch").unwrap();

	assert!(!profile.id.is_empty());
	assert_eq!(profile.project_id, project.id);
	assert_eq!(profile.branch_name, "feature-branch");
	assert!(!profile.worktree_path.is_empty());
	assert!(!profile.created_at.is_empty());
	assert!(!profile.is_default);

	// Cleanup: delete profile first (removes worktree)
	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}

#[test]
fn create_profile_sanitizes_cjk() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let profile = service::profile::create(&mut conn, &project.id, "新功能").unwrap();

	assert_eq!(profile.branch_name, "xin-gong-neng");

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}

#[test]
fn create_profile_shows_in_list_projects() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let profile = service::profile::create(&mut conn, &project.id, "dev").unwrap();

	let list = service::project::list(&mut conn).unwrap();
	let pwp = list.iter().find(|p| p.id == project.id).unwrap();
	assert_eq!(pwp.profiles.len(), 2); // default + dev
	assert!(pwp.profiles.iter().any(|p| p.id == profile.id));

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}

// ============================================================
// Profile Creation (Edge Cases)
// ============================================================

#[test]
fn create_profile_empty_name_after_sanitize_returns_error() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let result = service::profile::create(&mut conn, &project.id, "!!!");

	assert!(result.is_err());
	let err = result.err().unwrap();
	let err_msg = err.to_string();
	assert!(
		err_msg.contains("Invalid branch name"),
		"unexpected error: {err_msg}"
	);

	cleanup(&dir);
}

#[test]
fn create_profile_preserves_namespace() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let profile =
		service::profile::create(&mut conn, &project.id, "feat/用户").unwrap();

	assert_eq!(profile.branch_name, "feat/yong-hu");

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}

#[test]
fn create_profile_duplicate_branch_returns_error() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let p1 = service::profile::create(&mut conn, &project.id, "dup-branch").unwrap();
	let result = service::profile::create(&mut conn, &project.id, "dup-branch");

	assert!(result.is_err());
	let err = result.err().unwrap();
	let err_msg = err.to_string();
	assert!(
		err_msg.contains("already exists"),
		"unexpected error: {err_msg}"
	);

	service::profile::delete(&mut conn, &p1.id).unwrap();
	cleanup(&dir);
}

#[test]
fn create_profile_for_nonexistent_project_returns_error() {
	let mut conn = setup_db();
	let result = service::profile::create(&mut conn, "nonexistent-project-id", "branch");
	assert!(result.is_err());
}

// ============================================================
// Profile Delete
// ============================================================

#[test]
fn delete_default_profile_returns_error() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) = create_project_with_git_repo(&mut conn);

	let result = service::profile::delete(&mut conn, &default_profile.id);

	assert!(result.is_err());
	let err_msg = result.unwrap_err().to_string();
	assert!(
		err_msg.contains("Cannot delete default profile"),
		"unexpected error: {err_msg}"
	);

	cleanup(&dir);
}

#[test]
fn delete_non_default_succeeds() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let profile = service::profile::create(&mut conn, &project.id, "to-delete").unwrap();
	service::profile::delete(&mut conn, &profile.id).unwrap();

	let list = service::project::list(&mut conn).unwrap();
	let pwp = list.iter().find(|p| p.id == project.id).unwrap();
	assert_eq!(pwp.profiles.len(), 1); // only default remains
	assert!(pwp.profiles[0].is_default);

	cleanup(&dir);
}

#[test]
fn delete_profile_cascades_sessions() {
	let mut conn = setup_db();
	let (project, _default, dir) = create_project_with_git_repo(&mut conn);

	let profile =
		service::profile::create(&mut conn, &project.id, "cascade-test").unwrap();

	// Insert session for this profile
	let session_record = code_lib::model::pty::NewPtySessionRecord {
		id: "sess-cascade",
		profile_id: &profile.id,
		title: "bash",
		shell: "/bin/bash",
		cwd: &project.folder,
		cols: 80,
		rows: 24,
	};
	code_lib::repo::pty::insert_session(&mut conn, &session_record).unwrap();

	// Delete profile — should cascade to session
	service::profile::delete(&mut conn, &profile.id).unwrap();

	let sessions = service::pty::list_project_sessions(&mut conn, &project.id).unwrap();
	// Only default profile sessions (none)
	assert!(sessions.is_empty());

	cleanup(&dir);
}

#[test]
fn delete_nonexistent_profile_returns_error() {
	let mut conn = setup_db();
	let result = service::profile::delete(&mut conn, "nonexistent-profile-id");
	assert!(result.is_err());
}
