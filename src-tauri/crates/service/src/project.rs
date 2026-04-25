use std::path::Path;

use diesel::SqliteConnection;
use uuid::Uuid;

use infra::git::{Identity, IdentityScope};
use model::error::AppError;
use model::project::{
	GitBinaryPreview, GitCommit, GitDiffStats, IndexStatus, Project,
	ProjectWithProfiles,
};

fn generate_dir_name(name: &Option<String>, uuid: &str) -> String {
	let short_id = &uuid[..4];
	match name {
		Some(n) if !n.trim().is_empty() => {
			let slug = infra::slug::slugify_cjk(n);
			if slug.is_empty() {
				uuid.to_string()
			} else {
				format!("{slug}-{short_id}")
			}
		}
		_ => uuid.to_string(),
	}
}

pub fn create_temporary(
	conn: &mut SqliteConnection,
	name: Option<String>,
) -> Result<Project, AppError> {
	let id = Uuid::new_v4().to_string();
	let dir_name = generate_dir_name(&name, &id);
	let dir = std::env::temp_dir().join(dir_name);

	std::fs::create_dir_all(&dir)?;

	if let Err(e) = infra::git::init(&dir) {
		let _ = std::fs::remove_dir_all(&dir);
		return Err(e);
	}

	let project_name = name.unwrap_or_else(|| "Untitled".to_string());
	let dir_str = dir.to_string_lossy();

	let branch_name = infra::git::branch(&dir_str).unwrap_or_default();

	let project = repo::project::insert(conn, &id, &project_name, &dir_str)?;

	let default_profile_id = format!("default-{id}");
	repo::profile::insert_default(
		conn,
		&default_profile_id,
		&id,
		&branch_name,
		&dir_str,
	)?;

	Ok(project)
}

pub fn create_from_folder(
	conn: &mut SqliteConnection,
	name: &str,
	folder: &str,
) -> Result<Project, AppError> {
	if !Path::new(folder).exists() {
		return Err(AppError::NotFound(format!("Folder: {folder}")));
	}

	let id = Uuid::new_v4().to_string();
	let project = repo::project::insert(conn, &id, name, folder)?;

	let branch_name = infra::git::branch(folder).unwrap_or_default();

	let default_profile_id = format!("default-{id}");
	repo::profile::insert_default(
		conn,
		&default_profile_id,
		&id,
		&branch_name,
		folder,
	)?;

	Ok(project)
}

pub fn list(
	conn: &mut SqliteConnection,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	repo::project::list_all_with_profiles(conn)
}

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	name: Option<String>,
	folder: Option<String>,
) -> Result<Project, AppError> {
	repo::project::update(conn, id, name, folder)
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
	repo::project::delete(conn, id)
}

/// Resolve a profile id to its worktree folder. Brief DB lookup — used by
/// handlers to drop the SQLite mutex before kicking off long-running git work.
pub fn resolve_profile_folder(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<String, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	Ok(profile.worktree_path)
}

pub fn get_branch(folder: &str) -> Result<String, AppError> {
	infra::git::branch(folder)
}

pub fn get_diff(folder: &str) -> Result<String, AppError> {
	infra::git::diff(folder)
}

pub fn get_index_status(folder: &str) -> Result<IndexStatus, AppError> {
	infra::git::index_status(folder)
}

pub fn get_diff_stats(folder: &str) -> Result<GitDiffStats, AppError> {
	infra::git::diff_stats(folder)
}

pub fn get_log(folder: &str, limit: u32) -> Result<Vec<GitCommit>, AppError> {
	infra::git::log(folder, limit)
}

pub fn get_commit_diff(
	folder: &str,
	commit_hash: &str,
) -> Result<String, AppError> {
	infra::git::show(folder, commit_hash)
}

pub fn get_binary_preview(
	folder: &str,
	path: &str,
	source: &str,
	commit_hash: Option<&str>,
) -> Result<Option<GitBinaryPreview>, AppError> {
	let file_path = match source {
		"working_tree" => infra::git::read_worktree_file(folder, path)?,
		"head" => infra::git::read_head_file(folder, path)?,
		"commit" => {
			let commit_hash = commit_hash.ok_or_else(|| {
				AppError::GitError(
					"commit_hash is required for commit previews".into(),
				)
			})?;
			infra::git::read_commit_file(folder, commit_hash, path)?
		}
		"parent_commit" => {
			let commit_hash = commit_hash.ok_or_else(|| {
				AppError::GitError(
					"commit_hash is required for parent commit previews".into(),
				)
			})?;
			infra::git::read_parent_commit_file(folder, commit_hash, path)?
		}
		other => {
			return Err(AppError::GitError(format!(
				"Unsupported preview source: {other}"
			)));
		}
	};

	Ok(file_path.map(|file_path| GitBinaryPreview { file_path }))
}

pub fn commit_changes(
	folder: &str,
	files: &[String],
	message: &str,
	body: Option<&str>,
) -> Result<String, AppError> {
	infra::git::commit(folder, files, message, body)
}

pub fn discard_file_changes(
	folder: &str,
	paths: &[String],
) -> Result<(), AppError> {
	infra::git::discard_changes(folder, paths)
}

pub fn get_ahead_count(folder: &str) -> u32 {
	infra::git::ahead_count(folder)
}

pub fn push(folder: &str) -> Result<(), AppError> {
	infra::git::push(folder)
}

// ── Git identity ──

/// Resolve `(profile_folder, project_folder)` for an identity write or read.
/// For the default profile both paths are the same. For non-default profiles
/// the worktree (profile_folder) is separate from the project's main repo.
pub fn resolve_identity_folders(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<(String, String), AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	let project = repo::project::find_by_id(conn, &profile.project_id)?;
	Ok((profile.worktree_path, project.folder))
}

pub fn set_git_identity(
	profile_folder: &str,
	project_folder: &str,
	identity: &Identity,
	scope: IdentityScope,
) -> Result<(), AppError> {
	let target = match scope {
		IdentityScope::Profile => profile_folder,
		IdentityScope::Project => project_folder,
	};
	infra::git::identity::set_identity(target, identity)
}

pub fn unset_git_identity(
	profile_folder: &str,
	project_folder: &str,
	scope: IdentityScope,
) -> Result<(), AppError> {
	let target = match scope {
		IdentityScope::Profile => profile_folder,
		IdentityScope::Project => project_folder,
	};
	infra::git::identity::unset_identity(target)
}

/// Resolve the effective identity for commits in this profile.
/// Walks profile → project → global.
pub fn resolve_git_identity(
	profile_folder: &str,
	project_folder: &str,
) -> Option<Identity> {
	infra::git::identity::resolve_identity(
		Some(profile_folder),
		Some(project_folder),
	)
}

#[cfg(test)]
mod tests {
	use super::*;

	const FAKE_UUID: &str = "a3f2b1c4-5678-9abc-def0-123456789abc";

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
}
