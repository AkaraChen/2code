use diesel::prelude::*;
use std::path::Path;
use std::process::Command;
use tauri::State;
use uuid::Uuid;

use super::models::{GitAuthor, GitCommit, NewProject, Project, UpdateProject};
use crate::db::DbPool;
use crate::error::{AppError, AppResult};
use crate::schema::{profiles, projects};

fn resolve_context_folder(
	conn: &mut SqliteConnection,
	context_id: &str,
) -> AppResult<String> {
	profiles::table
		.find(context_id)
		.select(profiles::worktree_path)
		.first::<String>(conn)
		.or_else(|_| {
			projects::table
				.find(context_id)
				.select(projects::folder)
				.first::<String>(conn)
		})
		.map_err(|_| AppError::NotFound(format!("Context: {context_id}")))
}

pub fn validate_commit_hash(hash: &str) -> AppResult<()> {
	if hash.len() < 4 || hash.len() > 40 {
		return Err(AppError::GitError(format!(
			"Invalid commit hash length: {}",
			hash.len()
		)));
	}
	if !hash.chars().all(|c| c.is_ascii_hexdigit()) {
		return Err(AppError::GitError(
			"Invalid commit hash: non-hex characters".into(),
		));
	}
	Ok(())
}

pub fn parse_shortstat(line: &str) -> (u32, u32, u32) {
	let mut files = 0u32;
	let mut insertions = 0u32;
	let mut deletions = 0u32;

	for part in line.split(',') {
		let part = part.trim();
		if let Some(n) = part.split_whitespace().next().and_then(|s| s.parse::<u32>().ok()) {
			if part.contains("file") {
				files = n;
			} else if part.contains("insertion") {
				insertions = n;
			} else if part.contains("deletion") {
				deletions = n;
			}
		}
	}

	(files, insertions, deletions)
}

pub fn parse_git_log(output: &str) -> Vec<GitCommit> {
	if output.trim().is_empty() {
		return Vec::new();
	}

	let mut commits = Vec::new();
	let mut lines = output.lines().peekable();

	while let Some(line) = lines.next() {
		let line = line.trim();
		if line.is_empty() {
			continue;
		}

		// Try to parse as a commit format line (contains \x1f separators)
		let parts: Vec<&str> = line.split('\x1f').collect();
		if parts.len() == 6 {
			let full_hash = parts[0].to_string();
			let hash = parts[1].to_string();
			let author_name = parts[2].to_string();
			let author_email = parts[3].to_string();
			let date = parts[4].to_string();
			let message = parts[5].to_string();

			// Check if the next non-empty line is a shortstat
			let mut files_changed = 0;
			let mut insertions = 0;
			let mut deletions = 0;

			// Skip empty lines and look for shortstat
			while let Some(next) = lines.peek() {
				let next = next.trim();
				if next.is_empty() {
					lines.next();
					continue;
				}
				if next.contains("file") && next.contains("changed") {
					let (f, i, d) = parse_shortstat(next);
					files_changed = f;
					insertions = i;
					deletions = d;
					lines.next();
				}
				break;
			}

			commits.push(GitCommit {
				hash,
				full_hash,
				author: GitAuthor {
					name: author_name,
					email: author_email,
				},
				date,
				message,
				files_changed,
				insertions,
				deletions,
			});
		}
	}

	commits
}

fn generate_dir_name(name: &Option<String>, uuid: &str) -> String {
	let short_id = &uuid[..4];
	match name {
		Some(n) if !n.trim().is_empty() => {
			let slug = crate::slug::slugify_cjk(n);
			if slug.is_empty() {
				uuid.to_string()
			} else {
				format!("{slug}-{short_id}")
			}
		}
		_ => uuid.to_string(),
	}
}

fn insert_and_fetch(
	conn: &mut SqliteConnection,
	id: &str,
	name: &str,
	folder: &str,
) -> AppResult<Project> {
	diesel::insert_into(projects::table)
		.values(&NewProject { id, name, folder })
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	projects::table
		.find(id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

#[tauri::command]
pub fn create_project_temporary(
	name: Option<String>,
	state: State<'_, DbPool>,
) -> AppResult<Project> {
	let id = Uuid::new_v4().to_string();
	let dir_name = generate_dir_name(&name, &id);
	let dir = std::env::temp_dir().join(dir_name);

	std::fs::create_dir_all(&dir)?;

	let output = Command::new("git").arg("init").current_dir(&dir).output()?;

	if !output.status.success() {
		let _ = std::fs::remove_dir_all(&dir);
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(AppError::PtyError(format!("git init failed: {stderr}")));
	}

	let project_name = name.unwrap_or_else(|| "Untitled".to_string());
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let dir_str = dir.to_string_lossy();

	insert_and_fetch(conn, &id, &project_name, &dir_str)
}

#[tauri::command]
pub fn create_project_from_folder(
	name: String,
	folder: String,
	state: State<'_, DbPool>,
) -> AppResult<Project> {
	if !Path::new(&folder).exists() {
		return Err(AppError::NotFound(format!("Folder: {folder}")));
	}

	let id = Uuid::new_v4().to_string();
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;

	insert_and_fetch(conn, &id, &name, &folder)
}

#[tauri::command]
pub fn list_projects(state: State<'_, DbPool>) -> AppResult<Vec<Project>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	projects::table
		.select(Project::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

#[tauri::command]
pub fn get_project(id: String, state: State<'_, DbPool>) -> AppResult<Project> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	projects::table
		.find(&id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|_| AppError::NotFound(format!("Project: {id}")))
}

#[tauri::command]
pub fn update_project(
	id: String,
	name: Option<String>,
	folder: Option<String>,
	state: State<'_, DbPool>,
) -> AppResult<Project> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let target = projects::table.find(&id);

	if name.is_none() && folder.is_none() {
		return target
			.select(Project::as_select())
			.first(conn)
			.map_err(|_| AppError::NotFound(format!("Project: {id}")));
	}

	let changeset = UpdateProject { name, folder };
	let rows = diesel::update(target)
		.set(&changeset)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	if rows == 0 {
		return Err(AppError::NotFound(format!("Project: {id}")));
	}

	target
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

#[tauri::command]
pub fn get_git_branch(folder: String) -> AppResult<String> {
	let output = Command::new("git")
		.args(["rev-parse", "--abbrev-ref", "HEAD"])
		.current_dir(&folder)
		.output()?;
	if !output.status.success() {
		return Err(AppError::GitError(
			String::from_utf8_lossy(&output.stderr).trim().to_string(),
		));
	}
	Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub fn get_git_diff(
	context_id: String,
	state: State<'_, DbPool>,
) -> AppResult<String> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let folder = resolve_context_folder(conn, &context_id)?;

	let output = Command::new("git")
		.args(["diff"])
		.current_dir(&folder)
		.output()?;

	Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn get_git_log(
	context_id: String,
	limit: Option<u32>,
	state: State<'_, DbPool>,
) -> AppResult<Vec<GitCommit>> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let folder = resolve_context_folder(conn, &context_id)?;
	let limit = limit.unwrap_or(50);

	let output = Command::new("git")
		.args([
			"log",
			&format!("-{limit}"),
			"--format=%H\x1f%h\x1f%an\x1f%ae\x1f%aI\x1f%s",
			"--shortstat",
		])
		.current_dir(&folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		// Empty repo (no commits) — not an error
		if stderr.contains("does not have any commits") {
			return Ok(Vec::new());
		}
		return Err(AppError::GitError(stderr));
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	Ok(parse_git_log(&stdout))
}

#[tauri::command]
pub fn get_commit_diff(
	context_id: String,
	commit_hash: String,
	state: State<'_, DbPool>,
) -> AppResult<String> {
	validate_commit_hash(&commit_hash)?;

	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let folder = resolve_context_folder(conn, &context_id)?;

	let output = Command::new("git")
		.args(["show", "--format=", &commit_hash])
		.current_dir(&folder)
		.output()?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(AppError::GitError(stderr));
	}

	Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn delete_project(id: String, state: State<'_, DbPool>) -> AppResult<()> {
	let conn = &mut *state.lock().map_err(|_| AppError::LockError)?;
	let rows = diesel::delete(projects::table.find(&id))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	if rows == 0 {
		return Err(AppError::NotFound(format!("Project: {id}")));
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::db::MIGRATIONS;
	use crate::schema::pty_sessions;
	use diesel::SqliteConnection;
	use diesel_migrations::MigrationHarness;

	const FAKE_UUID: &str = "a3f2b1c4-5678-9abc-def0-123456789abc";

	fn setup_db() -> SqliteConnection {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		conn.run_pending_migrations(MIGRATIONS)
			.expect("run migrations");
		conn
	}

	#[test]
	fn dir_name_none() {
		let result = generate_dir_name(&None, FAKE_UUID);
		assert_eq!(result, FAKE_UUID);
	}

	#[test]
	fn dir_name_empty() {
		let result = generate_dir_name(&Some("".into()), FAKE_UUID);
		assert_eq!(result, FAKE_UUID);
	}

	#[test]
	fn dir_name_whitespace_only() {
		let result = generate_dir_name(&Some("   ".into()), FAKE_UUID);
		assert_eq!(result, FAKE_UUID);
	}

	#[test]
	fn dir_name_english() {
		let result = generate_dir_name(&Some("My Project".into()), FAKE_UUID);
		assert_eq!(result, "my-project-a3f2");
	}

	#[test]
	fn dir_name_chinese() {
		let result = generate_dir_name(&Some("我的项目".into()), FAKE_UUID);
		assert_eq!(result, "wo-de-xiang-mu-a3f2");
	}

	#[test]
	fn dir_name_japanese() {
		let result = generate_dir_name(&Some("プロジェクト".into()), FAKE_UUID);
		assert_eq!(result, "puroziekuto-a3f2");
	}

	#[test]
	fn dir_name_korean() {
		let result = generate_dir_name(&Some("프로젝트".into()), FAKE_UUID);
		assert_eq!(result, "peurojegteu-a3f2");
	}

	#[test]
	fn dir_name_cyrillic() {
		let result = generate_dir_name(&Some("Проект".into()), FAKE_UUID);
		assert_eq!(result, "proekt-a3f2");
	}

	#[test]
	fn dir_name_hebrew() {
		let result = generate_dir_name(&Some("פרויקט".into()), FAKE_UUID);
		assert_eq!(result, "prvyqt-a3f2");
	}

	#[test]
	fn dir_name_arabic() {
		let result = generate_dir_name(&Some("مشروع".into()), FAKE_UUID);
		assert_eq!(result, "mshrw-a3f2");
	}

	#[test]
	fn dir_name_mixed_chinese_english() {
		let result = generate_dir_name(&Some("我的Project".into()), FAKE_UUID);
		assert_eq!(result, "wo-de-project-a3f2");
	}

	// --- DB tests ---

	#[test]
	fn db_insert_and_fetch() {
		let mut conn = setup_db();
		let project = insert_and_fetch(&mut conn, "p1", "Test", "/tmp/test")
			.expect("insert");
		assert_eq!(project.id, "p1");
		assert_eq!(project.name, "Test");
		assert_eq!(project.folder, "/tmp/test");
	}

	#[test]
	fn db_insert_duplicate_id() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "A", "/a").unwrap();
		let err = insert_and_fetch(&mut conn, "p1", "B", "/b");
		assert!(err.is_err());
	}

	#[test]
	fn db_list_empty() {
		let mut conn = setup_db();
		let list: Vec<Project> = projects::table
			.select(Project::as_select())
			.load(&mut conn)
			.unwrap();
		assert!(list.is_empty());
	}

	#[test]
	fn db_list_multiple() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "A", "/a").unwrap();
		insert_and_fetch(&mut conn, "p2", "B", "/b").unwrap();
		let list: Vec<Project> = projects::table
			.select(Project::as_select())
			.load(&mut conn)
			.unwrap();
		assert_eq!(list.len(), 2);
	}

	#[test]
	fn db_get_found() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "Found", "/f").unwrap();
		let result: Result<Project, _> = projects::table
			.find("p1")
			.select(Project::as_select())
			.first(&mut conn);
		assert!(result.is_ok());
		assert_eq!(result.unwrap().name, "Found");
	}

	#[test]
	fn db_get_not_found() {
		let mut conn = setup_db();
		let result: Result<Project, _> = projects::table
			.find("nonexistent")
			.select(Project::as_select())
			.first(&mut conn);
		assert!(result.is_err());
	}

	#[test]
	fn db_update_name() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "Old", "/f").unwrap();
		let changeset = UpdateProject {
			name: Some("New".into()),
			folder: None,
		};
		diesel::update(projects::table.find("p1"))
			.set(&changeset)
			.execute(&mut conn)
			.unwrap();
		let project: Project = projects::table
			.find("p1")
			.select(Project::as_select())
			.first(&mut conn)
			.unwrap();
		assert_eq!(project.name, "New");
		assert_eq!(project.folder, "/f");
	}

	#[test]
	fn db_update_folder() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "Name", "/old").unwrap();
		let changeset = UpdateProject {
			name: None,
			folder: Some("/new".into()),
		};
		diesel::update(projects::table.find("p1"))
			.set(&changeset)
			.execute(&mut conn)
			.unwrap();
		let project: Project = projects::table
			.find("p1")
			.select(Project::as_select())
			.first(&mut conn)
			.unwrap();
		assert_eq!(project.folder, "/new");
	}

	#[test]
	fn db_update_nonexistent() {
		let mut conn = setup_db();
		let changeset = UpdateProject {
			name: Some("X".into()),
			folder: None,
		};
		let rows = diesel::update(projects::table.find("nope"))
			.set(&changeset)
			.execute(&mut conn)
			.unwrap();
		assert_eq!(rows, 0);
	}

	#[test]
	fn db_delete_success() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "Del", "/d").unwrap();
		let rows = diesel::delete(projects::table.find("p1"))
			.execute(&mut conn)
			.unwrap();
		assert_eq!(rows, 1);
		let list: Vec<Project> = projects::table
			.select(Project::as_select())
			.load(&mut conn)
			.unwrap();
		assert!(list.is_empty());
	}

	#[test]
	fn db_delete_nonexistent() {
		let mut conn = setup_db();
		let rows = diesel::delete(projects::table.find("nope"))
			.execute(&mut conn)
			.unwrap();
		assert_eq!(rows, 0);
	}

	#[test]
	fn get_branch_in_git_repo() {
		let dir = std::env::temp_dir()
			.join(format!("git-branch-test-{}", uuid::Uuid::new_v4()));
		std::fs::create_dir_all(&dir).unwrap();
		Command::new("git")
			.args(["init"])
			.current_dir(&dir)
			.output()
			.unwrap();
		// Need at least one commit for rev-parse HEAD to work
		Command::new("git")
			.args(["commit", "--allow-empty", "-m", "init"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let result = get_git_branch(dir.to_string_lossy().to_string());
		let _ = std::fs::remove_dir_all(&dir);
		let branch = result.unwrap();
		assert!(
			branch == "main" || branch == "master",
			"expected main or master, got: {branch}"
		);
	}

	#[test]
	fn get_branch_non_git_dir() {
		let dir = std::env::temp_dir()
			.join(format!("no-git-test-{}", uuid::Uuid::new_v4()));
		std::fs::create_dir_all(&dir).unwrap();
		let result = get_git_branch(dir.to_string_lossy().to_string());
		let _ = std::fs::remove_dir_all(&dir);
		assert!(result.is_err());
	}

	#[test]
	fn get_branch_nonexistent_dir() {
		let result =
			get_git_branch("/tmp/nonexistent-dir-xyz-12345".to_string());
		assert!(result.is_err());
	}

	#[test]
	fn db_cascade_delete_removes_sessions() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "Cascade", "/c").unwrap();

		// Insert a pty session referencing the project
		use crate::pty::models::NewPtySessionRecord;
		diesel::insert_into(pty_sessions::table)
			.values(&NewPtySessionRecord {
				id: "s1",
				project_id: "p1",
				title: "bash",
				shell: "/bin/bash",
				cwd: "/c",
			})
			.execute(&mut conn)
			.unwrap();

		// Delete the project — should cascade to pty_sessions
		diesel::delete(projects::table.find("p1"))
			.execute(&mut conn)
			.unwrap();

		let sessions: Vec<String> = pty_sessions::table
			.select(pty_sessions::id)
			.load(&mut conn)
			.unwrap();
		assert!(sessions.is_empty());
	}

	// --- validate_commit_hash ---

	#[test]
	fn validate_hash_valid_short() {
		assert!(validate_commit_hash("abcd").is_ok());
	}

	#[test]
	fn validate_hash_valid_full() {
		assert!(validate_commit_hash("abc123def456abc123def456abc123def456abc1").is_ok());
	}

	#[test]
	fn validate_hash_too_short() {
		assert!(validate_commit_hash("abc").is_err());
	}

	#[test]
	fn validate_hash_non_hex() {
		assert!(validate_commit_hash("ghijklmn").is_err());
	}

	#[test]
	fn validate_hash_flag_injection() {
		assert!(validate_commit_hash("--all").is_err());
	}

	#[test]
	fn validate_hash_empty() {
		assert!(validate_commit_hash("").is_err());
	}

	// --- parse_shortstat ---

	#[test]
	fn shortstat_all_fields() {
		let (f, i, d) = parse_shortstat(" 3 files changed, 10 insertions(+), 5 deletions(-)");
		assert_eq!((f, i, d), (3, 10, 5));
	}

	#[test]
	fn shortstat_insertions_only() {
		let (f, i, d) = parse_shortstat(" 1 file changed, 4 insertions(+)");
		assert_eq!((f, i, d), (1, 4, 0));
	}

	#[test]
	fn shortstat_deletions_only() {
		let (f, i, d) = parse_shortstat(" 2 files changed, 7 deletions(-)");
		assert_eq!((f, i, d), (2, 0, 7));
	}

	#[test]
	fn shortstat_empty() {
		let (f, i, d) = parse_shortstat("");
		assert_eq!((f, i, d), (0, 0, 0));
	}

	#[test]
	fn shortstat_singular_file() {
		let (f, i, d) = parse_shortstat(" 1 file changed, 1 insertion(+), 1 deletion(-)");
		assert_eq!((f, i, d), (1, 1, 1));
	}

	// --- parse_git_log ---

	#[test]
	fn parse_log_multiple_commits() {
		let output = "abc123def456abc123def456abc123def456abc1\x1fabc123d\x1fJohn\x1fjohn@example.com\x1f2024-01-01T00:00:00+00:00\x1fFirst commit\n 1 file changed, 3 insertions(+)\n\ndef456abc123def456abc123def456abc123def4\x1fdef456a\x1fJane\x1fjane@example.com\x1f2024-01-02T00:00:00+00:00\x1fSecond commit\n 2 files changed, 5 insertions(+), 2 deletions(-)\n";
		let commits = parse_git_log(output);
		assert_eq!(commits.len(), 2);
		assert_eq!(commits[0].message, "First commit");
		assert_eq!(commits[0].hash, "abc123d");
		assert_eq!(commits[0].author.name, "John");
		assert_eq!(commits[0].author.email, "john@example.com");
		assert_eq!(commits[0].files_changed, 1);
		assert_eq!(commits[0].insertions, 3);
		assert_eq!(commits[0].deletions, 0);
		assert_eq!(commits[1].message, "Second commit");
		assert_eq!(commits[1].files_changed, 2);
		assert_eq!(commits[1].insertions, 5);
		assert_eq!(commits[1].deletions, 2);
	}

	#[test]
	fn parse_log_empty_output() {
		let commits = parse_git_log("");
		assert!(commits.is_empty());
	}

	#[test]
	fn parse_log_commit_without_stat() {
		// merge commits or empty commits may lack shortstat
		let output = "abc123def456abc123def456abc123def456abc1\x1fabc123d\x1fJohn\x1fjohn@example.com\x1f2024-01-01T00:00:00+00:00\x1fEmpty commit\n";
		let commits = parse_git_log(output);
		assert_eq!(commits.len(), 1);
		assert_eq!(commits[0].files_changed, 0);
		assert_eq!(commits[0].insertions, 0);
		assert_eq!(commits[0].deletions, 0);
	}

	// --- resolve_context_folder ---

	#[test]
	fn resolve_context_folder_project_fallback() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "Test", "/tmp/project").unwrap();
		let folder = resolve_context_folder(&mut conn, "p1").unwrap();
		assert_eq!(folder, "/tmp/project");
	}

	#[test]
	fn resolve_context_folder_profile() {
		let mut conn = setup_db();
		insert_and_fetch(&mut conn, "p1", "Test", "/tmp/project").unwrap();

		use crate::profile::models::NewProfile;
		diesel::insert_into(profiles::table)
			.values(&NewProfile {
				id: "prof1",
				project_id: "p1",
				branch_name: "feature",
				worktree_path: "/tmp/worktree",
			})
			.execute(&mut conn)
			.unwrap();

		let folder = resolve_context_folder(&mut conn, "prof1").unwrap();
		assert_eq!(folder, "/tmp/worktree");
	}

	#[test]
	fn resolve_context_folder_not_found() {
		let mut conn = setup_db();
		let result = resolve_context_folder(&mut conn, "nonexistent");
		assert!(result.is_err());
		let err = result.unwrap_err();
		assert!(matches!(err, AppError::NotFound(_)));
	}

	// --- Integration tests (temp git repos) ---

	fn create_temp_git_repo() -> std::path::PathBuf {
		let dir = std::env::temp_dir()
			.join(format!("git-log-test-{}", uuid::Uuid::new_v4()));
		std::fs::create_dir_all(&dir).unwrap();
		Command::new("git")
			.args(["init"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["config", "user.email", "test@test.com"])
			.current_dir(&dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["config", "user.name", "Test"])
			.current_dir(&dir)
			.output()
			.unwrap();
		dir
	}

	fn add_commit(dir: &std::path::Path, filename: &str, content: &str, msg: &str) {
		std::fs::write(dir.join(filename), content).unwrap();
		Command::new("git")
			.args(["add", filename])
			.current_dir(dir)
			.output()
			.unwrap();
		Command::new("git")
			.args(["commit", "-m", msg])
			.current_dir(dir)
			.output()
			.unwrap();
	}

	#[test]
	fn git_log_basic() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "hello", "First");
		add_commit(&dir, "b.txt", "world", "Second");

		let mut conn = setup_db();
		let folder = dir.to_string_lossy().to_string();
		insert_and_fetch(&mut conn, "p1", "Test", &folder).unwrap();

		let output = Command::new("git")
			.args([
				"log",
				"-50",
				"--format=%H\x1f%h\x1f%an\x1f%ae\x1f%aI\x1f%s",
				"--shortstat",
			])
			.current_dir(&dir)
			.output()
			.unwrap();
		let stdout = String::from_utf8_lossy(&output.stdout);
		let commits = parse_git_log(&stdout);
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(commits.len(), 2);
		// Reverse chronological: Second first, then First
		assert_eq!(commits[0].message, "Second");
		assert_eq!(commits[1].message, "First");
	}

	#[test]
	fn git_log_limit() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "a", "First");
		add_commit(&dir, "b.txt", "b", "Second");
		add_commit(&dir, "c.txt", "c", "Third");

		let output = Command::new("git")
			.args([
				"log",
				"-2",
				"--format=%H\x1f%h\x1f%an\x1f%ae\x1f%aI\x1f%s",
				"--shortstat",
			])
			.current_dir(&dir)
			.output()
			.unwrap();
		let stdout = String::from_utf8_lossy(&output.stdout);
		let commits = parse_git_log(&stdout);
		let _ = std::fs::remove_dir_all(&dir);

		assert_eq!(commits.len(), 2);
	}

	#[test]
	fn git_log_empty_repo() {
		let dir = create_temp_git_repo();
		// No commits made

		let output = Command::new("git")
			.args([
				"log",
				"-50",
				"--format=%H\x1f%h\x1f%an\x1f%ae\x1f%aI\x1f%s",
				"--shortstat",
			])
			.current_dir(&dir)
			.output()
			.unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		// git log on empty repo exits with non-zero
		assert!(!output.status.success());
		let stderr = String::from_utf8_lossy(&output.stderr);
		assert!(stderr.contains("does not have any commits"));
	}

	#[test]
	fn git_log_non_git_dir() {
		let dir = std::env::temp_dir()
			.join(format!("non-git-log-{}", uuid::Uuid::new_v4()));
		std::fs::create_dir_all(&dir).unwrap();

		let output = Command::new("git")
			.args(["log", "-1"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(!output.status.success());
	}

	#[test]
	fn commit_diff_returns_patch() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "hello.txt", "hello world", "Add hello");

		let log_output = Command::new("git")
			.args(["log", "-1", "--format=%H"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let hash = String::from_utf8_lossy(&log_output.stdout).trim().to_string();

		let output = Command::new("git")
			.args(["show", "--format=", &hash])
			.current_dir(&dir)
			.output()
			.unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		let diff = String::from_utf8_lossy(&output.stdout);
		assert!(diff.contains("hello.txt"));
		assert!(diff.contains("+hello world"));
	}

	#[test]
	fn commit_diff_nonexistent_hash() {
		let dir = create_temp_git_repo();
		add_commit(&dir, "a.txt", "a", "Init");

		let output = Command::new("git")
			.args(["show", "--format=", "deadbeefdeadbeef"])
			.current_dir(&dir)
			.output()
			.unwrap();
		let _ = std::fs::remove_dir_all(&dir);

		assert!(!output.status.success());
	}

	#[test]
	fn commit_diff_invalid_hash_rejected() {
		let result = validate_commit_hash("--all");
		assert!(result.is_err());
	}
}
