mod common;

use common::{
	add_commit, cleanup, create_project_with_git_repo, create_temp_git_repo,
	setup_db, wrap_db,
};
use infra::no_window::command_without_windows_console;

fn git_status_porcelain(dir: &std::path::Path) -> String {
	let output = command_without_windows_console("git")
		.args(["status", "--porcelain", "--untracked-files=all"])
		.current_dir(dir)
		.output()
		.unwrap();
	assert!(output.status.success());
	String::from_utf8_lossy(&output.stdout).to_string()
}

// ============================================================
// Git Diff (basic)
// ============================================================

#[test]
fn diff_resolves_profile_to_folder() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	// Modify a file to create a diff
	std::fs::write(dir.join("README.md"), "# Modified").unwrap();

	let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
	assert!(diff.contains("README.md"), "diff should contain filename");
	assert!(diff.contains("Modified"), "diff should contain new content");

	cleanup(&dir);
}

#[test]
fn diff_captures_staged_and_unstaged() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	// Staged change
	std::fs::write(dir.join("staged.txt"), "staged content").unwrap();
	command_without_windows_console("git")
		.args(["add", "staged.txt"])
		.current_dir(&dir)
		.output()
		.unwrap();

	// Unstaged change
	std::fs::write(dir.join("README.md"), "# Unstaged change").unwrap();

	let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
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
	let db = wrap_db(conn);

	std::fs::write(dir.join("new_file.txt"), "new content").unwrap();

	let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
	assert!(
		diff.contains("new_file.txt"),
		"diff should include untracked file"
	);

	cleanup(&dir);
}

#[test]
fn diff_snapshot_includes_untracked_files() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	std::fs::write(dir.join("untracked.txt"), "untracked content\n").unwrap();

	let snapshot =
		infra::git::diff_snapshot(&default_profile.worktree_path).unwrap();
	assert!(
		snapshot.diff.contains("untracked.txt"),
		"snapshot diff should include untracked file"
	);
	assert!(
		snapshot.diff.contains("untracked content"),
		"snapshot diff should include untracked content"
	);
	assert_eq!(snapshot.stats.files_changed, 1);
	assert_eq!(snapshot.stats.insertions, 1);

	cleanup(&dir);
}

#[test]
fn diff_nonexistent_profile_returns_error() {
	let conn = setup_db();
	let db = wrap_db(conn);
	let result = service::project::get_diff(&db, "nonexistent-profile");
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
	let profile_id = pwp.profiles[0].id.clone();
	let db = wrap_db(conn);

	let diff = service::project::get_diff(&db, &profile_id).unwrap();
	assert_eq!(diff, "");

	cleanup(&dir);
}

#[test]
fn diff_no_changes_returns_empty_string() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	// No changes after initial commit
	let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
	assert_eq!(diff, "");

	cleanup(&dir);
}

#[test]
fn diff_snapshot_clean_repo_returns_empty_snapshot() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	let snapshot =
		infra::git::diff_snapshot(&default_profile.worktree_path).unwrap();
	assert_eq!(snapshot.diff, "");
	assert_eq!(snapshot.stats.files_changed, 0);
	assert_eq!(snapshot.stats.insertions, 0);
	assert_eq!(snapshot.stats.deletions, 0);

	cleanup(&dir);
}

#[test]
fn diff_deleted_file() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	// Delete the tracked file
	std::fs::remove_file(dir.join("README.md")).unwrap();

	let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
	assert!(diff.contains("README.md"), "diff should show deleted file");
	assert!(
		diff.contains("deleted file") || diff.contains("--- a/README.md"),
		"diff should indicate deletion"
	);

	cleanup(&dir);
}

#[test]
fn diff_snapshot_matches_diff_and_stats_wrappers() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	add_commit(&dir, "tracked.txt", "old\n", "Add tracked file");
	std::fs::write(dir.join("README.md"), "# Updated\n").unwrap();
	std::fs::write(dir.join("tracked.txt"), "old\nnew line\n").unwrap();
	std::fs::write(dir.join("new.txt"), "brand new\n").unwrap();
	command_without_windows_console("git")
		.args(["add", "README.md"])
		.current_dir(&dir)
		.output()
		.unwrap();

	let snapshot =
		infra::git::diff_snapshot(&default_profile.worktree_path).unwrap();
	let diff = infra::git::diff(&default_profile.worktree_path).unwrap();
	let stats = infra::git::diff_stats(&default_profile.worktree_path).unwrap();

	assert_eq!(snapshot.diff, diff);
	assert_eq!(snapshot.stats, stats);
	assert!(snapshot.diff.contains("README.md"));
	assert!(snapshot.diff.contains("tracked.txt"));
	assert!(snapshot.diff.contains("new.txt"));
	assert_eq!(snapshot.stats.files_changed, 3);

	cleanup(&dir);
}

#[test]
fn diff_snapshot_does_not_mutate_real_index() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	std::fs::write(dir.join("staged.txt"), "staged content\n").unwrap();
	command_without_windows_console("git")
		.args(["add", "staged.txt"])
		.current_dir(&dir)
		.output()
		.unwrap();
	std::fs::write(dir.join("untracked.txt"), "untracked content\n").unwrap();

	let before = git_status_porcelain(&dir);
	let snapshot =
		infra::git::diff_snapshot(&default_profile.worktree_path).unwrap();
	let after = git_status_porcelain(&dir);

	assert!(snapshot.diff.contains("staged.txt"));
	assert!(snapshot.diff.contains("untracked.txt"));
	assert_eq!(after, before);
	assert!(after.contains("A  staged.txt"));
	assert!(after.contains("?? untracked.txt"));

	cleanup(&dir);
}

#[test]
fn diff_binary_file_change() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	// Create a binary file
	let binary_data: Vec<u8> = (0..=255).collect();
	std::fs::write(dir.join("image.bin"), &binary_data).unwrap();

	let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
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
	let db = wrap_db(conn);

	let commits =
		service::project::get_log(&db, &default_profile.id, 10).unwrap();
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
	let db = wrap_db(conn);

	add_commit(&dir, "b.txt", "b", "Second commit");
	add_commit(&dir, "c.txt", "c", "Third commit");

	let commits =
		service::project::get_log(&db, &default_profile.id, 2).unwrap();
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
	let profile_id = pwp.profiles[0].id.clone();
	let db = wrap_db(conn);

	let commits = service::project::get_log(&db, &profile_id, 10).unwrap();
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
	let db = wrap_db(conn);

	// git log -0 shows all commits (no limit)
	let commits =
		service::project::get_log(&db, &default_profile.id, 0).unwrap();
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
	let db = wrap_db(conn);

	add_commit(&dir, "cjk.txt", "content", "添加中文文件");

	let commits =
		service::project::get_log(&db, &default_profile.id, 10).unwrap();
	let cjk_commit = commits.iter().find(|c| c.message.contains("中文"));
	assert!(cjk_commit.is_some(), "should find CJK commit message");

	cleanup(&dir);
}

#[test]
fn log_multiple_files_in_commit() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	// Add multiple files in one commit
	std::fs::write(dir.join("x.txt"), "x").unwrap();
	std::fs::write(dir.join("y.txt"), "y").unwrap();
	std::fs::write(dir.join("z.txt"), "z").unwrap();
	command_without_windows_console("git")
		.args(["add", "."])
		.current_dir(&dir)
		.output()
		.unwrap();
	command_without_windows_console("git")
		.args(["commit", "-m", "Add three files"])
		.current_dir(&dir)
		.output()
		.unwrap();

	let commits =
		service::project::get_log(&db, &default_profile.id, 1).unwrap();
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
	let db = wrap_db(conn);

	let commits =
		service::project::get_log(&db, &default_profile.id, 1).unwrap();
	let hash = &commits[0].full_hash;

	let diff =
		service::project::get_commit_diff(&db, &default_profile.id, hash)
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
	let db = wrap_db(conn);

	// Non-hex characters (injection attempt)
	let result =
		service::project::get_commit_diff(&db, &default_profile.id, "--all");
	assert!(result.is_err());

	cleanup(&dir);
}

#[test]
fn commit_diff_too_short_hash_returns_error() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	let result =
		service::project::get_commit_diff(&db, &default_profile.id, "abc");
	assert!(result.is_err());

	cleanup(&dir);
}

#[test]
fn commit_diff_nonexistent_hash_returns_error() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	let result = service::project::get_commit_diff(
		&db,
		&default_profile.id,
		"deadbeefdeadbeefdeadbeef",
	);
	assert!(result.is_err());

	cleanup(&dir);
}

// ============================================================
// Git Commit
// ============================================================

#[test]
fn commit_changes_commits_only_selected_files() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	std::fs::write(dir.join("README.md"), "# Updated").unwrap();
	std::fs::write(dir.join("notes.txt"), "keep me for later").unwrap();

	let commit_hash = service::project::commit_changes(
		&db,
		&default_profile.id,
		&["README.md".into()],
		"Commit README only",
		None,
	)
	.unwrap();

	let head = command_without_windows_console("git")
		.args(["rev-parse", "HEAD"])
		.current_dir(&dir)
		.output()
		.unwrap();
	assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), commit_hash);

	let latest_message = command_without_windows_console("git")
		.args(["log", "-1", "--format=%s"])
		.current_dir(&dir)
		.output()
		.unwrap();
	assert_eq!(
		String::from_utf8_lossy(&latest_message.stdout).trim(),
		"Commit README only"
	);

	let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
	assert!(
		diff.contains("notes.txt"),
		"unselected file should stay uncommitted"
	);
	assert!(
		!diff.contains("README.md"),
		"selected file should be removed from diff after commit"
	);

	cleanup(&dir);
}

#[test]
fn commit_changes_supports_body_and_untracked_files() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	std::fs::write(dir.join("new-file.txt"), "new file").unwrap();

	service::project::commit_changes(
		&db,
		&default_profile.id,
		&["new-file.txt".into()],
		"Add new file",
		Some("Body line 1\n\nBody line 2"),
	)
	.unwrap();

	let full_message = command_without_windows_console("git")
		.args(["log", "-1", "--format=%B"])
		.current_dir(&dir)
		.output()
		.unwrap();
	let full_message = String::from_utf8_lossy(&full_message.stdout);
	assert!(full_message.contains("Add new file"));
	assert!(full_message.contains("Body line 1"));
	assert!(full_message.contains("Body line 2"));

	let diff = service::project::get_diff(&db, &default_profile.id).unwrap();
	assert!(!diff.contains("new-file.txt"));

	cleanup(&dir);
}

#[test]
fn commit_changes_empty_message_returns_error() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	std::fs::write(dir.join("README.md"), "# Updated").unwrap();

	let result = service::project::commit_changes(
		&db,
		&default_profile.id,
		&["README.md".into()],
		"   ",
		None,
	);
	assert!(result.is_err());

	cleanup(&dir);
}

#[test]
fn commit_changes_requires_selected_files() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);
	let db = wrap_db(conn);

	std::fs::write(dir.join("README.md"), "# Updated").unwrap();

	let files: Vec<String> = Vec::new();
	let result = service::project::commit_changes(
		&db,
		&default_profile.id,
		&files,
		"Missing files",
		None,
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
	let db = wrap_db(conn);

	// Create a non-default profile (creates a worktree)
	let profile = {
		let conn = &mut *db.lock().unwrap();
		service::profile::create(conn, &project.id, "worktree-test").unwrap()
	};

	// Make a change in the worktree, not in the main repo
	let worktree_path = std::path::Path::new(&profile.worktree_path);
	std::fs::write(worktree_path.join("worktree-file.txt"), "worktree content")
		.unwrap();

	// Diff on profile should see the worktree changes
	let diff = service::project::get_diff(&db, &profile.id).unwrap();
	assert!(
		diff.contains("worktree-file.txt"),
		"diff should see worktree file, got: {}",
		&diff[..diff.len().min(200)]
	);

	// Main repo should NOT see the worktree changes
	let main_list = {
		let conn = &mut *db.lock().unwrap();
		service::project::list(conn).unwrap()
	};
	let pwp = main_list.iter().find(|p| p.id == project.id).unwrap();
	let default_profile = pwp.profiles.iter().find(|p| p.is_default).unwrap();
	let main_diff =
		service::project::get_diff(&db, &default_profile.id).unwrap();
	assert!(
		!main_diff.contains("worktree-file.txt"),
		"main repo should not see worktree file"
	);

	{
		let conn = &mut *db.lock().unwrap();
		service::profile::delete(conn, &profile.id).unwrap();
	}
	cleanup(&dir);
}
