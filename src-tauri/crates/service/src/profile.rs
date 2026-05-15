use std::collections::HashSet;
use std::path::PathBuf;

use diesel::SqliteConnection;
use uuid::Uuid;

use model::error::AppError;
use model::profile::{Profile, ProfileDeleteCheck};
use model::project::GitDiffStats;

const AUTO_BRANCH_PREFIX: &str = "pr/";
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
	let available_count = AUTO_BRANCH_CITIES
		.iter()
		.filter(|city| !used_cities.contains(*city))
		.count();
	let city = if available_count == 0 {
		AUTO_BRANCH_CITIES
			[usize::from(seed.as_bytes()[0]) % AUTO_BRANCH_CITIES.len()]
	} else {
		let target_index = usize::from(seed.as_bytes()[0]) % available_count;
		AUTO_BRANCH_CITIES
			.iter()
			.filter(|city| !used_cities.contains(*city))
			.nth(target_index)
			.copied()
			.unwrap_or(AUTO_BRANCH_CITIES[0])
	};
	let simple = seed.simple().to_string();
	let short_id = &simple[..8];
	format!("{AUTO_BRANCH_PREFIX}{city}-{short_id}")
}

fn generate_auto_branch_name(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<String, AppError> {
	let existing_branches =
		repo::profile::list_branch_names_by_project(conn, project_id)?;

	for _ in 0..5 {
		let seed = Uuid::new_v4();
		let branch_name = build_auto_branch_name(&existing_branches, &seed);
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

fn resolve_worktree_base() -> Result<PathBuf, AppError> {
	let home = dirs::home_dir().ok_or_else(|| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::NotFound,
			"Could not resolve home directory",
		))
	})?;
	Ok(home.join(".2code").join("workspace"))
}

pub fn create(
	conn: &mut SqliteConnection,
	project_id: &str,
	branch_name: &str,
) -> Result<Profile, AppError> {
	let project_folder = repo::profile::get_project_folder(conn, project_id)?;

	let auto_generated = branch_name.trim().is_empty();
	let branch_name = if auto_generated {
		generate_auto_branch_name(conn, project_id)?
	} else {
		let sanitized = sanitize_branch_name(branch_name);
		if sanitized.is_empty() {
			return Err(AppError::GitError("Invalid branch name".to_string()));
		}
		sanitized
	};

	let id = Uuid::new_v4().to_string();
	let worktree_base = resolve_worktree_base()?;
	std::fs::create_dir_all(&worktree_base)?;
	let worktree_path = worktree_base.join(&id);
	let worktree_str = worktree_path.to_string_lossy().to_string();

	let branch_name = if auto_generated {
		let mut candidate = branch_name;
		let mut created = false;
		for _ in 0..5 {
			match infra::git::worktree_add(
				&project_folder,
				&candidate,
				&worktree_str,
			) {
				Ok(()) => {
					created = true;
					break;
				}
				Err(AppError::GitError(message))
					if message.contains("already exists") =>
				{
					candidate = generate_auto_branch_name(conn, project_id)?;
				}
				Err(err) => return Err(err),
			}
		}
		if !created {
			return Err(AppError::GitError(
				"Failed to auto-generate a unique branch name".to_string(),
			));
		}
		candidate
	} else {
		infra::git::worktree_add(&project_folder, &branch_name, &worktree_str)?;
		branch_name
	};

	let profile = repo::profile::insert(
		conn,
		&id,
		project_id,
		&branch_name,
		&worktree_str,
	)?;

	if let Ok(cfg) = infra::config::load_project_config(&project_folder) {
		infra::config::execute_scripts(&cfg.setup_script, &worktree_path);
	}

	Ok(profile)
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
	use std::time::Instant;

	use super::*;

	// --- worktree base resolution ---

	#[test]
	fn resolve_worktree_base_returns_valid_path() {
		let base = resolve_worktree_base().unwrap();
		assert!(base.ends_with(".2code/workspace"));
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

	fn build_auto_branch_name_with_vec(
		existing_branches: &[String],
		seed: &Uuid,
	) -> String {
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

	#[test]
	#[ignore]
	fn benchmark_auto_branch_city_selection() {
		let existing: Vec<String> = AUTO_BRANCH_CITIES
			.iter()
			.take(24)
			.enumerate()
			.map(|(index, city)| format!("pr/{city}-{index:08}"))
			.collect();
		let seed =
			Uuid::parse_str("d3000000-0000-4000-8000-000000000000").unwrap();
		let iterations = 200_000;

		let start = Instant::now();
		let mut vec_len = 0;
		for _ in 0..iterations {
			vec_len += build_auto_branch_name_with_vec(&existing, &seed).len();
		}
		let vec_selection = start.elapsed();

		let start = Instant::now();
		let mut scan_len = 0;
		for _ in 0..iterations {
			scan_len += build_auto_branch_name(&existing, &seed).len();
		}
		let scan_selection = start.elapsed();

		assert_eq!(vec_len, scan_len);
		println!(
			"vec_selection={vec_selection:?} scan_selection={scan_selection:?} speedup={:.2}x",
			vec_selection.as_secs_f64() / scan_selection.as_secs_f64()
		);
	}
}
