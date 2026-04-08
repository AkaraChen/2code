mod common;

use common::{
	add_commit, cleanup, create_project_with_git_repo, create_temp_git_repo,
	setup_db,
};

// ============================================================
// Git Diff (basic)
// ============================================================

#[test]
fn diff_resolves_profile_to_folder() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// Modify a file to create a diff
	std::fs::write(dir.join("README.md"), "# Modified").unwrap();

	let diff =
		service::project::get_diff(&mut conn, &default_profile.id).unwrap();
	assert!(diff.contains("README.md"), "diff should contain filename");
	assert!(diff.contains("Modified"), "diff should contain new content");

	cleanup(&dir);
}

#[test]
fn diff_captures_staged_and_unstaged() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// Staged change
	std::fs::write(dir.join("staged.txt"), "staged content").unwrap();
	std::process::Command::new("git")
		.args(["add", "staged.txt"])
		.current_dir(&dir)
		.output()
		.unwrap();

	// Unstaged change
	std::fs::write(dir.join("README.md"), "# Unstaged change").unwrap();

	let diff =
		service::project::get_diff(&mut conn, &default_profile.id).unwrap();
	assert!(
		diff.contains("staged.txt"),
		"diff should contain staged file"
	);
	assert!(
		diff.contains("README.md"),
		"diff should contain unstaged file"
	);

	cleanup(&dir);
}

#[test]
fn diff_includes_untracked_files() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	std::fs::write(dir.join("new_file.txt"), "new content").unwrap();

	let diff =
		service::project::get_diff(&mut conn, &default_profile.id).unwrap();
	assert!(
		diff.contains("new_file.txt"),
		"diff should include untracked file"
	);

	cleanup(&dir);
}

#[test]
fn diff_nonexistent_profile_returns_error() {
	let mut conn = setup_db();
	let result = service::project::get_diff(&mut conn, "nonexistent-profile");
	assert!(result.is_err());
}

// ============================================================
// Git Diff (Edge Cases)
// ============================================================

#[test]
fn diff_empty_repo_returns_empty_string() {
	let mut conn = setup_db();
	// Create empty repo (no commits) via create_from_folder
	let dir = create_temp_git_repo();
	let folder = dir.to_string_lossy().to_string();
	let project =
		service::project::create_from_folder(&mut conn, "Empty", &folder)
			.unwrap();

	let list = service::project::list(&mut conn).unwrap();
	let pwp = list.iter().find(|p| p.id == project.id).unwrap();
	let profile_id = &pwp.profiles[0].id;

	let diff = service::project::get_diff(&mut conn, profile_id).unwrap();
	assert_eq!(diff, "");

	cleanup(&dir);
}

#[test]
fn diff_no_changes_returns_empty_string() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// No changes after initial commit
	let diff =
		service::project::get_diff(&mut conn, &default_profile.id).unwrap();
	assert_eq!(diff, "");

	cleanup(&dir);
}

#[test]
fn diff_deleted_file() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// Delete the tracked file
	std::fs::remove_file(dir.join("README.md")).unwrap();

	let diff =
		service::project::get_diff(&mut conn, &default_profile.id).unwrap();
	assert!(diff.contains("README.md"), "diff should show deleted file");
	assert!(
		diff.contains("deleted file") || diff.contains("--- a/README.md"),
		"diff should indicate deletion"
	);

	cleanup(&dir);
}

#[test]
fn diff_binary_file_change() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// Create a binary file
	let binary_data: Vec<u8> = (0..=255).collect();
	std::fs::write(dir.join("image.bin"), &binary_data).unwrap();

	let diff =
		service::project::get_diff(&mut conn, &default_profile.id).unwrap();
	assert!(
		diff.contains("image.bin"),
		"diff should mention binary file"
	);

	cleanup(&dir);
}

// ============================================================
// Git Log (basic)
// ============================================================

#[test]
fn log_returns_commit_shape() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	let commits =
		service::project::get_log(&mut conn, &default_profile.id, 10).unwrap();
	assert_eq!(commits.len(), 1);

	let c = &commits[0];
	assert!(!c.hash.is_empty());
	assert!(!c.full_hash.is_empty());
	assert!(c.full_hash.len() >= c.hash.len());
	assert!(!c.author.name.is_empty());
	assert!(!c.author.email.is_empty());
	assert!(!c.date.is_empty());
	assert!(!c.message.is_empty());
	assert!(c.files_changed > 0);

	cleanup(&dir);
}

#[test]
fn log_respects_limit() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	add_commit(&dir, "b.txt", "b", "Second commit");
	add_commit(&dir, "c.txt", "c", "Third commit");

	let commits =
		service::project::get_log(&mut conn, &default_profile.id, 2).unwrap();
	assert_eq!(commits.len(), 2);
	// Most recent first
	assert_eq!(commits[0].message, "Third commit");
	assert_eq!(commits[1].message, "Second commit");

	cleanup(&dir);
}

#[test]
fn log_empty_repo_returns_empty_vec() {
	let mut conn = setup_db();
	let dir = create_temp_git_repo();
	let folder = dir.to_string_lossy().to_string();
	let project =
		service::project::create_from_folder(&mut conn, "Empty", &folder)
			.unwrap();

	let list = service::project::list(&mut conn).unwrap();
	let pwp = list.iter().find(|p| p.id == project.id).unwrap();
	let profile_id = &pwp.profiles[0].id;

	let commits = service::project::get_log(&mut conn, profile_id, 10).unwrap();
	assert!(commits.is_empty());

	cleanup(&dir);
}

// ============================================================
// Git Log (Edge Cases)
// ============================================================

#[test]
fn log_limit_zero() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// git log -0 shows all commits (no limit)
	let commits =
		service::project::get_log(&mut conn, &default_profile.id, 0).unwrap();
	// Either 0 or all commits — just verify it doesn't error
	// git log -0 actually shows nothing on some versions
	assert!(commits.len() <= 1);

	cleanup(&dir);
}

#[test]
fn log_commit_with_cjk_message() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	add_commit(&dir, "cjk.txt", "content", "添加中文文件");

	let commits =
		service::project::get_log(&mut conn, &default_profile.id, 10).unwrap();
	let cjk_commit = commits.iter().find(|c| c.message.contains("中文"));
	assert!(cjk_commit.is_some(), "should find CJK commit message");

	cleanup(&dir);
}

#[test]
fn log_multiple_files_in_commit() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// Add multiple files in one commit
	std::fs::write(dir.join("x.txt"), "x").unwrap();
	std::fs::write(dir.join("y.txt"), "y").unwrap();
	std::fs::write(dir.join("z.txt"), "z").unwrap();
	std::process::Command::new("git")
		.args(["add", "."])
		.current_dir(&dir)
		.output()
		.unwrap();
	std::process::Command::new("git")
		.args(["commit", "-m", "Add three files"])
		.current_dir(&dir)
		.output()
		.unwrap();

	let commits =
		service::project::get_log(&mut conn, &default_profile.id, 1).unwrap();
	assert_eq!(commits[0].files_changed, 3);
	assert!(commits[0].insertions >= 3);

	cleanup(&dir);
}

// ============================================================
// Commit Diff (basic + edge cases)
// ============================================================

#[test]
fn commit_diff_returns_patch() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	let commits =
		service::project::get_log(&mut conn, &default_profile.id, 1).unwrap();
	let hash = &commits[0].full_hash;

	let diff =
		service::project::get_commit_diff(&mut conn, &default_profile.id, hash)
			.unwrap();
	assert!(diff.contains("README.md"));
	assert!(diff.contains("# Test"));

	cleanup(&dir);
}

#[test]
fn commit_diff_invalid_hash_returns_error() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// Non-hex characters (injection attempt)
	let result = service::project::get_commit_diff(
		&mut conn,
		&default_profile.id,
		"--all",
	);
	assert!(result.is_err());

	cleanup(&dir);
}

#[test]
fn commit_diff_too_short_hash_returns_error() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	let result = service::project::get_commit_diff(
		&mut conn,
		&default_profile.id,
		"abc",
	);
	assert!(result.is_err());

	cleanup(&dir);
}

#[test]
fn commit_diff_nonexistent_hash_returns_error() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	let result = service::project::get_commit_diff(
		&mut conn,
		&default_profile.id,
		"deadbeefdeadbeefdeadbeef",
	);
	assert!(result.is_err());

	cleanup(&dir);
}

// ============================================================
// Git Branch
// ============================================================

#[test]
fn get_branch_returns_correct_branch() {
	let dir = create_temp_git_repo();
	add_commit(&dir, "a.txt", "hello", "init");

	let branch = service::project::get_branch(&dir.to_string_lossy()).unwrap();
	assert!(
		branch == "main" || branch == "master",
		"expected main or master, got: {branch}"
	);

	cleanup(&dir);
}

// ============================================================
// Worktree Isolation
// ============================================================

#[test]
fn diff_on_profile_worktree() {
	let mut conn = setup_db();
	let (project, _default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	// Create a non-default profile (creates a worktree)
	let profile =
		service::profile::create(&mut conn, &project.id, "worktree-test")
			.unwrap();

	// Make a change in the worktree, not in the main repo
	let worktree_path = std::path::Path::new(&profile.worktree_path);
	std::fs::write(worktree_path.join("worktree-file.txt"), "worktree content")
		.unwrap();

	// Diff on profile should see the worktree changes
	let diff = service::project::get_diff(&mut conn, &profile.id).unwrap();
	assert!(
		diff.contains("worktree-file.txt"),
		"diff should see worktree file, got: {}",
		&diff[..diff.len().min(200)]
	);

	// Main repo should NOT see the worktree changes
	let main_list = service::project::list(&mut conn).unwrap();
	let pwp = main_list.iter().find(|p| p.id == project.id).unwrap();
	let default_profile = pwp.profiles.iter().find(|p| p.is_default).unwrap();
	let main_diff =
		service::project::get_diff(&mut conn, &default_profile.id).unwrap();
	assert!(
		!main_diff.contains("worktree-file.txt"),
		"main repo should not see worktree file"
	);

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}
