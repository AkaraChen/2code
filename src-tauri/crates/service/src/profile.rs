use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use diesel::SqliteConnection;
use infra::db::DbPool;
use uuid::Uuid;

use model::error::AppError;
use model::profile::{Profile, ProfileDeleteCheck};
use model::project::GitDiffStats;

const AUTO_BRANCH_PREFIX: &str = "pr/";
const WORKTREE_DIR_NAME_MAX_BYTES: usize = 120;
const WORKTREE_DIR_PROJECT_SLUG_MAX_BYTES: usize = 40;
const WORKTREE_DIR_BRANCH_SLUG_MAX_BYTES: usize = 70;
const AUTO_BRANCH_CITIES: &[&str] = &[
	"tokyo",
	"osaka",
	"kyoto",
	"seoul",
	"busan",
	"taipei",
	"tainan",
	"singapore",
	"bangkok",
	"chiang-mai",
	"hanoi",
	"saigon",
	"delhi",
	"mumbai",
	"istanbul",
	"lisbon",
	"porto",
	"oslo",
	"bergen",
	"helsinki",
	"prague",
	"vienna",
	"zurich",
	"geneva",
	"austin",
	"boston",
	"miami",
	"denver",
	"phoenix",
	"seattle",
];

/// Sanitize user input into a valid git branch name.
/// Splits on `/` to preserve namespace separators (e.g. "feature/auth"),
/// slugifies each segment (handling CJK via pinyin), then rejoins.
fn sanitize_branch_name(input: &str) -> String {
	input
		.split('/')
		.map(infra::slug::slugify_cjk)
		.filter(|s| !s.is_empty())
		.collect::<Vec<_>>()
		.join("/")
}

fn extract_auto_branch_city(branch_name: &str) -> Option<&str> {
	let generated = branch_name.strip_prefix(AUTO_BRANCH_PREFIX)?;
	let (city, suffix) = generated.rsplit_once('-')?;
	if city.is_empty() || suffix.is_empty() {
		return None;
	}
	Some(city)
}

fn build_auto_branch_name(existing_branches: &[String], seed: &Uuid) -> String {
	let used_cities: HashSet<&str> = existing_branches
		.iter()
		.filter_map(|branch| extract_auto_branch_city(branch))
		.collect();
	let available_cities: Vec<&str> = AUTO_BRANCH_CITIES
		.iter()
		.copied()
		.filter(|city| !used_cities.contains(city))
		.collect();
	let city_pool = if available_cities.is_empty() {
		AUTO_BRANCH_CITIES
	} else {
		available_cities.as_slice()
	};
	let city = city_pool[usize::from(seed.as_bytes()[0]) % city_pool.len()];
	let simple = seed.simple().to_string();
	let short_id = &simple[..8];
	format!("{AUTO_BRANCH_PREFIX}{city}-{short_id}")
}

fn generate_auto_branch_name_from(
	existing_branches: &[String],
) -> Result<String, AppError> {
	for _ in 0..5 {
		let seed = Uuid::new_v4();
		let branch_name = build_auto_branch_name(existing_branches, &seed);
		if !existing_branches
			.iter()
			.any(|existing| existing == &branch_name)
		{
			return Ok(branch_name);
		}
	}

	Err(AppError::GitError(
		"Failed to auto-generate a unique branch name".to_string(),
	))
}

fn default_worktree_base() -> Result<PathBuf, AppError> {
	Ok(home_dir()?.join(".2code").join("workspace"))
}

fn normalize_path(path: PathBuf) -> PathBuf {
	let mut normalized = PathBuf::new();
	for component in path.components() {
		match component {
			Component::CurDir => {}
			Component::ParentDir => {
				if !normalized.pop() {
					normalized.push(component.as_os_str());
				}
			}
			Component::Normal(value) => normalized.push(value),
			Component::RootDir => normalized.push(component.as_os_str()),
			Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
		}
	}

	if normalized.as_os_str().is_empty() {
		PathBuf::from(".")
	} else {
		normalized
	}
}

fn non_empty_path(value: Option<&str>) -> Option<&str> {
	value.map(str::trim).filter(|value| !value.is_empty())
}

fn home_dir() -> Result<PathBuf, AppError> {
	dirs::home_dir().ok_or_else(|| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::NotFound,
			"Could not resolve home directory",
		))
	})
}

fn expand_home_path(worktree_dir: &str) -> Result<PathBuf, AppError> {
	if worktree_dir == "~" {
		return home_dir();
	}
	if let Some(rest) = worktree_dir.strip_prefix("~/") {
		return Ok(home_dir()?.join(rest));
	}
	if let Some(rest) = worktree_dir.strip_prefix("~\\") {
		return Ok(home_dir()?.join(rest));
	}

	Ok(PathBuf::from(worktree_dir))
}

fn resolve_configured_worktree_base(
	project_folder: &str,
	worktree_dir: &str,
) -> Result<PathBuf, AppError> {
	let configured = expand_home_path(worktree_dir)?;
	let resolved = if configured.is_absolute() {
		configured
	} else {
		Path::new(project_folder).join(&configured)
	};
	Ok(normalize_path(resolved))
}

fn resolve_worktree_base(
	project_folder: &str,
	project_worktree_dir: Option<&str>,
	default_worktree_dir: Option<&str>,
) -> Result<PathBuf, AppError> {
	if let Some(worktree_dir) = non_empty_path(project_worktree_dir) {
		return resolve_configured_worktree_base(project_folder, worktree_dir);
	}

	if let Some(worktree_dir) = non_empty_path(default_worktree_dir) {
		return resolve_configured_worktree_base(project_folder, worktree_dir);
	}

	default_worktree_base()
}

fn slug_from_path_part(value: &str) -> Option<String> {
	let slug = infra::slug::slugify_cjk(value);
	if slug.is_empty() {
		None
	} else {
		Some(slug)
	}
}

fn project_slug(project_folder: &str) -> String {
	Path::new(project_folder)
		.file_name()
		.and_then(|value| value.to_str())
		.and_then(slug_from_path_part)
		.unwrap_or_else(|| "project".to_string())
}

fn branch_slug(branch_name: &str) -> String {
	let slug = branch_name
		.split('/')
		.filter_map(slug_from_path_part)
		.collect::<Vec<_>>()
		.join("-");
	if slug.is_empty() {
		"profile".to_string()
	} else {
		slug
	}
}

fn truncate_slug_to_bytes(slug: &str, max_bytes: usize) -> String {
	if slug.len() <= max_bytes {
		return slug.to_string();
	}

	let mut end = 0;
	for (index, ch) in slug.char_indices() {
		let next = index + ch.len_utf8();
		if next > max_bytes {
			break;
		}
		end = next;
	}

	slug[..end].trim_end_matches('-').to_string()
}

fn bounded_slug(slug: String, max_bytes: usize, fallback: &str) -> String {
	let bounded = truncate_slug_to_bytes(&slug, max_bytes);
	if bounded.is_empty() {
		fallback.to_string()
	} else {
		bounded
	}
}

fn build_worktree_dir_name(
	project_folder: &str,
	branch_name: &str,
	profile_id: &str,
) -> String {
	let short_id = profile_id.get(..8).unwrap_or(profile_id);
	let name = format!(
		"{}-{}-{}",
		bounded_slug(
			project_slug(project_folder),
			WORKTREE_DIR_PROJECT_SLUG_MAX_BYTES,
			"project",
		),
		bounded_slug(
			branch_slug(branch_name),
			WORKTREE_DIR_BRANCH_SLUG_MAX_BYTES,
			"profile",
		),
		short_id
	);

	debug_assert!(name.len() <= WORKTREE_DIR_NAME_MAX_BYTES);
	name
}

fn build_worktree_path(
	worktree_base: &Path,
	project_folder: &str,
	branch_name: &str,
	profile_id: &str,
) -> PathBuf {
	worktree_base.join(build_worktree_dir_name(
		project_folder,
		branch_name,
		profile_id,
	))
}

struct CreatedWorktree {
	id: String,
	branch_name: String,
	worktree_path: PathBuf,
	worktree_str: String,
}

fn create_worktree(
	project_folder: &str,
	branch_name: &str,
	auto_generated: bool,
	existing_branches: &mut Vec<String>,
	project_worktree_dir: Option<&str>,
	default_worktree_dir: Option<&str>,
) -> Result<CreatedWorktree, AppError> {
	let branch_name = if auto_generated {
		generate_auto_branch_name_from(existing_branches)?
	} else {
		let sanitized = sanitize_branch_name(branch_name);
		if sanitized.is_empty() {
			return Err(AppError::GitError("Invalid branch name".to_string()));
		}
		sanitized
	};

	let id = Uuid::new_v4().to_string();
	let worktree_base = resolve_worktree_base(
		project_folder,
		project_worktree_dir,
		default_worktree_dir,
	)?;
	std::fs::create_dir_all(&worktree_base)?;

	if auto_generated {
		let mut candidate = branch_name;
		for _ in 0..5 {
			let worktree_path = build_worktree_path(
				&worktree_base,
				project_folder,
				&candidate,
				&id,
			);
			let worktree_str = worktree_path.to_string_lossy().to_string();
			match infra::git::worktree_add(
				project_folder,
				&candidate,
				&worktree_str,
			) {
				Ok(()) => {
					return Ok(CreatedWorktree {
						id,
						branch_name: candidate,
						worktree_path,
						worktree_str,
					});
				}
				Err(AppError::GitError(message))
					if message.contains("already exists") =>
				{
					existing_branches.push(candidate);
					candidate =
						generate_auto_branch_name_from(existing_branches)?;
				}
				Err(err) => return Err(err),
			}
		}
		return Err(AppError::GitError(
			"Failed to auto-generate a unique branch name".to_string(),
		));
	} else {
		let worktree_path = build_worktree_path(
			&worktree_base,
			project_folder,
			&branch_name,
			&id,
		);
		let worktree_str = worktree_path.to_string_lossy().to_string();
		infra::git::worktree_add(project_folder, &branch_name, &worktree_str)?;
		return Ok(CreatedWorktree {
			id,
			branch_name,
			worktree_path,
			worktree_str,
		});
	}
}

fn load_project_config(
	project_folder: &str,
) -> Result<infra::config::ProjectConfig, AppError> {
	infra::config::load_project_config(project_folder)
}

pub fn create_with_db(
	db: &DbPool,
	project_id: &str,
	branch_name: &str,
	default_worktree_dir: Option<&str>,
) -> Result<Profile, AppError> {
	let auto_generated = branch_name.trim().is_empty();
	let (project_folder, mut existing_branches) = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let project_folder =
			repo::profile::get_project_folder(conn, project_id)?;
		let existing_branches = if auto_generated {
			repo::profile::list_branch_names_by_project(conn, project_id)?
		} else {
			Vec::new()
		};
		(project_folder, existing_branches)
	};
	let project_config = load_project_config(&project_folder)?;

	let created = create_worktree(
		&project_folder,
		branch_name,
		auto_generated,
		&mut existing_branches,
		project_config.worktree_dir.as_deref(),
		default_worktree_dir,
	)?;

	let profile = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::profile::insert(
			conn,
			&created.id,
			project_id,
			&created.branch_name,
			&created.worktree_str,
		)?
	};

	infra::config::execute_scripts(
		&project_config.setup_script,
		&created.worktree_path,
	);

	Ok(profile)
}

pub fn create_with_default_worktree_dir(
	conn: &mut SqliteConnection,
	project_id: &str,
	branch_name: &str,
	default_worktree_dir: Option<&str>,
) -> Result<Profile, AppError> {
	let auto_generated = branch_name.trim().is_empty();
	let (project_folder, project_config, mut existing_branches) = {
		let project_folder =
			repo::profile::get_project_folder(conn, project_id)?;
		let project_config = load_project_config(&project_folder)?;
		let existing_branches = if auto_generated {
			repo::profile::list_branch_names_by_project(conn, project_id)?
		} else {
			Vec::new()
		};
		(project_folder, project_config, existing_branches)
	};

	let created = create_worktree(
		&project_folder,
		branch_name,
		auto_generated,
		&mut existing_branches,
		project_config.worktree_dir.as_deref(),
		default_worktree_dir,
	)?;

	let profile = {
		repo::profile::insert(
			conn,
			&created.id,
			project_id,
			&created.branch_name,
			&created.worktree_str,
		)?
	};

	infra::config::execute_scripts(
		&project_config.setup_script,
		&created.worktree_path,
	);

	Ok(profile)
}

pub fn create(
	conn: &mut SqliteConnection,
	project_id: &str,
	branch_name: &str,
) -> Result<Profile, AppError> {
	create_with_default_worktree_dir(conn, project_id, branch_name, None)
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
	let (profile, project_folder) = repo::profile::delete(conn, id)?;
	let worktree_path = PathBuf::from(&profile.worktree_path);

	if let Ok(cfg) = infra::config::load_project_config(&project_folder) {
		infra::config::execute_scripts(&cfg.teardown_script, &worktree_path);
	}

	infra::git::worktree_remove(&project_folder, &profile.worktree_path);
	infra::git::branch_delete(&project_folder, &profile.branch_name);

	Ok(())
}

pub fn delete_check(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<ProfileDeleteCheck, AppError> {
	let profile = repo::profile::find_by_id(conn, id)?;
	let working_tree_diff = infra::git::diff_stats(&profile.worktree_path)?;
	let unpushed_commits = infra::git::branch_unique_commits(
		&profile.worktree_path,
		&profile.branch_name,
	)?;
	let unpushed_commit_diff = infra::git::commit_diff_stats(
		&profile.worktree_path,
		&unpushed_commits,
	)?;

	Ok(ProfileDeleteCheck {
		total_diff: add_diff_stats(&working_tree_diff, &unpushed_commit_diff),
		working_tree_diff,
		unpushed_commit_count: unpushed_commits.len() as u32,
		unpushed_commit_diff,
	})
}

fn add_diff_stats(left: &GitDiffStats, right: &GitDiffStats) -> GitDiffStats {
	GitDiffStats {
		files_changed: left.files_changed + right.files_changed,
		insertions: left.insertions + right.insertions,
		deletions: left.deletions + right.deletions,
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use diesel::Connection;
	use diesel::RunQueryDsl;
	use diesel_migrations::MigrationHarness;
	use std::path::Path;
	use tempfile::TempDir;

	fn setup_db() -> SqliteConnection {
		let mut conn =
			SqliteConnection::establish(":memory:").expect("in-memory db");
		diesel::sql_query("PRAGMA foreign_keys=ON;")
			.execute(&mut conn)
			.ok();
		conn.run_pending_migrations(infra::db::MIGRATIONS)
			.expect("run migrations");
		conn
	}

	fn run_git<const N: usize>(dir: &Path, args: [&str; N]) {
		let output = infra::no_window::command_without_windows_console("git")
			.args(args)
			.current_dir(dir)
			.output()
			.expect("run git");
		assert!(
			output.status.success(),
			"git failed: {}",
			String::from_utf8_lossy(&output.stderr)
		);
	}

	fn create_temp_git_repo() -> TempDir {
		let dir = TempDir::new().expect("temp git repo");
		run_git(dir.path(), ["init"]);
		run_git(dir.path(), ["config", "user.email", "test@test.com"]);
		run_git(dir.path(), ["config", "user.name", "Test User"]);
		std::fs::write(dir.path().join("README.md"), "# Test").unwrap();
		run_git(dir.path(), ["add", "README.md"]);
		run_git(dir.path(), ["commit", "-m", "Initial commit"]);
		dir
	}

	fn create_project_with_git_repo(
		conn: &mut SqliteConnection,
	) -> (model::project::Project, TempDir) {
		let dir = create_temp_git_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let project =
			crate::project::create_from_folder(conn, "Test Project", &folder)
				.expect("create project from folder");
		(project, dir)
	}

	// --- worktree base resolution ---

	#[test]
	fn resolve_worktree_base_returns_valid_path() {
		let base = resolve_worktree_base("/tmp/project", None, None).unwrap();
		assert!(base.ends_with(".2code/workspace"));
	}

	#[test]
	fn resolve_worktree_base_uses_project_config_before_default() {
		let project_folder = std::env::temp_dir().join("repo").join("app");
		let project_base = project_folder.parent().unwrap().join(".worktrees");
		let default_base = std::env::temp_dir().join("global-worktrees");

		let base = resolve_worktree_base(
			project_folder.to_str().unwrap(),
			Some("../.worktrees"),
			Some(default_base.to_str().unwrap()),
		)
		.unwrap();

		assert_eq!(base, project_base);
	}

	#[test]
	fn resolve_worktree_base_uses_default_when_project_config_blank() {
		let project_folder = std::env::temp_dir().join("repo").join("app");
		let default_base = project_folder.join("default-worktrees");

		let base = resolve_worktree_base(
			project_folder.to_str().unwrap(),
			Some("  "),
			Some("default-worktrees"),
		)
		.unwrap();

		assert_eq!(base, default_base);
	}

	#[test]
	fn resolve_worktree_base_expands_home_dir() {
		let home = home_dir().unwrap();

		let base = resolve_worktree_base(
			"/tmp/project",
			Some("~/.2code-worktrees"),
			None,
		)
		.unwrap();

		assert_eq!(base, home.join(".2code-worktrees"));
	}

	#[test]
	fn build_worktree_dir_name_includes_project_branch_and_short_id() {
		let name = build_worktree_dir_name(
			"/tmp/My Project",
			"feat/用户 auth",
			"12345678-1234-4000-8000-000000000000",
		);

		assert_eq!(name, "my-project-feat-yong-hu-auth-12345678");
	}

	#[test]
	fn build_worktree_dir_name_caps_readable_segments() {
		let long_branch = std::iter::once("feature".to_string())
			.chain((0..30).map(|index| format!("segment-{index:02}")))
			.collect::<Vec<_>>()
			.join("/");

		let name = build_worktree_dir_name(
			"/tmp/My Extraordinarily Long Project Name That Keeps Going",
			&long_branch,
			"12345678-1234-4000-8000-000000000000",
		);

		assert!(name.len() <= WORKTREE_DIR_NAME_MAX_BYTES);
		assert!(name.ends_with("-12345678"));
	}

	#[test]
	fn create_profile_accepts_long_valid_branch_name_with_bounded_dir_name() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base =
			TempDir::new().expect("global worktree base fallback");
		let long_branch = std::iter::once("feature".to_string())
			.chain((0..30).map(|index| format!("segment-{index:02}")))
			.collect::<Vec<_>>()
			.join("/");

		let profile = create_with_default_worktree_dir(
			&mut conn,
			&project.id,
			&long_branch,
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		let worktree_path = PathBuf::from(&profile.worktree_path);
		let dir_name = worktree_path.file_name().unwrap().to_string_lossy();

		assert_eq!(profile.branch_name, long_branch);
		assert!(worktree_path.exists());
		assert!(dir_name.len() <= WORKTREE_DIR_NAME_MAX_BYTES);
		assert!(dir_name.ends_with(&profile.id[..8]));

		delete(&mut conn, &profile.id).unwrap();
	}

	#[test]
	fn create_profile_returns_invalid_project_config_errors() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		std::fs::write(dir.path().join("2code.json"), "{").unwrap();
		let global_base =
			TempDir::new().expect("global worktree base fallback");

		let result = create_with_default_worktree_dir(
			&mut conn,
			&project.id,
			"feature/broken-config",
			Some(global_base.path().to_str().unwrap()),
		);

		assert!(
			matches!(result, Err(AppError::IoError(error)) if error.kind() == std::io::ErrorKind::InvalidData)
		);
	}

	#[test]
	fn create_profile_uses_project_configured_worktree_dir() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let project_base_name = format!(".worktrees-{}", &project.id[..8]);
		std::fs::write(
			dir.path().join("2code.json"),
			format!(r#"{{"worktree_dir":"../{project_base_name}"}}"#),
		)
		.unwrap();
		let project_base =
			dir.path().parent().unwrap().join(&project_base_name);
		let global_base =
			TempDir::new().expect("global worktree base fallback");

		let profile = create_with_default_worktree_dir(
			&mut conn,
			&project.id,
			"feature/worktree",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		let worktree_path = PathBuf::from(&profile.worktree_path);
		let dir_name = worktree_path.file_name().unwrap().to_string_lossy();

		assert!(worktree_path.starts_with(&project_base));
		assert!(!worktree_path.starts_with(global_base.path()));
		assert!(worktree_path.exists());
		assert_ne!(dir_name.as_ref(), profile.id);
		assert!(dir_name.contains("feature-worktree"));

		delete(&mut conn, &profile.id).unwrap();
		let _ = std::fs::remove_dir_all(project_base);
	}

	#[test]
	fn create_profile_uses_default_worktree_dir_without_project_config() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base =
			TempDir::new().expect("global worktree base fallback");

		let profile = create_with_default_worktree_dir(
			&mut conn,
			&project.id,
			"feature/global",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		let worktree_path = PathBuf::from(&profile.worktree_path);
		let dir_name = worktree_path.file_name().unwrap().to_string_lossy();

		assert!(worktree_path.starts_with(global_base.path()));
		assert!(worktree_path.exists());
		assert_ne!(dir_name.as_ref(), profile.id);
		assert!(dir_name.contains("feature-global"));

		delete(&mut conn, &profile.id).unwrap();
	}

	// --- branch name sanitization ---

	#[test]
	fn sanitize_simple_english() {
		assert_eq!(sanitize_branch_name("feature/auth"), "feature/auth");
	}

	#[test]
	fn sanitize_with_spaces() {
		assert_eq!(sanitize_branch_name("my feature"), "my-feature");
	}

	#[test]
	fn sanitize_chinese() {
		assert_eq!(
			sanitize_branch_name("新功能/登录"),
			"xin-gong-neng/deng-lu"
		);
	}

	#[test]
	fn sanitize_mixed() {
		assert_eq!(
			sanitize_branch_name("feat/用户认证"),
			"feat/yong-hu-ren-zheng"
		);
	}

	#[test]
	fn sanitize_special_chars() {
		assert_eq!(sanitize_branch_name("fix: bug #123"), "fix-bug-123");
	}

	#[test]
	fn sanitize_empty_segments() {
		assert_eq!(sanitize_branch_name("feature//auth"), "feature/auth");
	}

	#[test]
	fn sanitize_empty_input() {
		assert_eq!(sanitize_branch_name(""), "");
	}

	#[test]
	fn extract_auto_branch_city_reads_generated_branch() {
		assert_eq!(
			extract_auto_branch_city("pr/chiang-mai-deadbeef"),
			Some("chiang-mai")
		);
	}

	#[test]
	fn extract_auto_branch_city_ignores_non_generated_branch() {
		assert_eq!(extract_auto_branch_city("feature/auth"), None);
	}

	#[test]
	fn build_auto_branch_name_avoids_used_cities() {
		let existing = vec![
			"pr/tokyo-11111111".to_string(),
			"pr/osaka-22222222".to_string(),
		];
		let seed =
			Uuid::parse_str("00000000-0000-4000-8000-000000000000").unwrap();

		let branch_name = build_auto_branch_name(&existing, &seed);

		assert!(branch_name.starts_with("pr/"));
		assert!(!branch_name.starts_with("pr/tokyo-"));
		assert!(!branch_name.starts_with("pr/osaka-"));
		assert!(branch_name.ends_with("-00000000"));
	}

	#[test]
	fn create_worktree_rejects_blank_manual_branch_before_git_work() {
		let mut existing_branches = Vec::new();

		let result = create_worktree(
			"/missing/project",
			" /// ",
			false,
			&mut existing_branches,
			None,
			None,
		);

		assert!(
			matches!(result, Err(AppError::GitError(message)) if message == "Invalid branch name")
		);
		assert!(existing_branches.is_empty());
	}
}
