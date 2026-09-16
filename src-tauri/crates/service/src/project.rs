use std::collections::HashMap;
use std::path::{Path, PathBuf};

use diesel::{Connection, SqliteConnection};
use serde_json::Value;
use uuid::Uuid;

use infra::db::DbPool;
use infra::herdr::transport::WorktreeListEntry;
use model::error::AppError;
use model::profile::Profile;
use model::project::{
	GitBinaryPreview, GitCommit, GitDiffStats, GitPullRequestStatus, Project,
	ProjectSidebarLayoutUpdate, ProjectWithProfiles,
};
use model::project_group::ProjectGroup;
use model::runtime::RuntimeBackend;

use crate::runtime::{HerdrWorktreeClient, RuntimeRouter, TerminalRuntime};

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

/// Return the project catalog with nested profiles.
///
/// Local keeps sqlite `profiles`. Herdr replaces each project's profile
/// array from live `worktree.list` / `session.snapshot` — sqlite rows are
/// not merged and are not written back. A missing Herdr client yields
/// empty profiles, not a sqlite fallback.
pub fn list_with_runtime(
	runtime: &RuntimeRouter,
	db: &DbPool,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	if runtime.selected_backend() == RuntimeBackend::Local {
		return list_sqlite_profiles(db);
	}
	list_herdr_derived(runtime, db)
}

fn list_sqlite_profiles(
	db: &DbPool,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	repo::project::list_all_with_profiles(conn)
}

fn list_herdr_derived(
	runtime: &RuntimeRouter,
	db: &DbPool,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	let (mut projects, notes) = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let projects = repo::project::list_all(conn)?
			.into_iter()
			.map(project_without_profiles)
			.collect::<Vec<_>>();
		(projects, notes_overlay(conn)?)
	};

	let Some(worktrees) = runtime.herdr_worktrees_optional() else {
		return Ok(projects);
	};

	let mut snapshot: Option<Value> = None;
	for project in &mut projects {
		project.profiles =
			derive_project_profiles(worktrees, project, &notes, &mut snapshot)?;
	}

	Ok(projects)
}

fn project_without_profiles(project: Project) -> ProjectWithProfiles {
	ProjectWithProfiles {
		id: project.id,
		name: project.name,
		folder: project.folder,
		created_at: project.created_at,
		group_id: project.group_id,
		sort_order: project.sort_order,
		pinned_at: project.pinned_at,
		pinned_order: project.pinned_order,
		profiles: Vec::new(),
	}
}

struct LeftoverNotes {
	rows: Vec<(String, String, String)>,
}

impl LeftoverNotes {
	fn for_checkout(&self, checkout: &str) -> (String, String) {
		self.rows
			.iter()
			.find(|(path, _, _)| same_checkout_path(path, checkout))
			.map(|(_, notes, created_at)| (notes.clone(), created_at.clone()))
			.unwrap_or_else(|| (String::new(), String::new()))
	}
}

/// Leftover sqlite notes keyed by checkout path. Mapping rows are ignored.
fn notes_overlay(
	conn: &mut SqliteConnection,
) -> Result<LeftoverNotes, AppError> {
	let projects = repo::project::list_all_with_profiles(conn)?;
	let mut rows = Vec::new();
	for project in projects {
		for profile in project.profiles {
			if profile.worktree_path.is_empty() {
				continue;
			}
			rows.push((
				profile.worktree_path,
				profile.notes,
				profile.created_at,
			));
		}
	}
	Ok(LeftoverNotes { rows })
}

fn derive_project_profiles(
	worktrees: &dyn HerdrWorktreeClient,
	project: &ProjectWithProfiles,
	notes: &LeftoverNotes,
	snapshot: &mut Option<Value>,
) -> Result<Vec<Profile>, AppError> {
	let cwd = project_cwd(&project.folder);
	match worktrees.worktree_list(Some(&cwd), None) {
		Ok(listed) => Ok(profiles_from_worktree_list(project, &listed, notes)),
		Err(err) if is_not_git_worktree(&err) => {
			let snap = ensure_session_snapshot(worktrees, snapshot)?;
			Ok(profiles_from_snapshot(project, snap, notes))
		}
		Err(_) => Ok(Vec::new()),
	}
}

fn ensure_session_snapshot<'a>(
	worktrees: &dyn HerdrWorktreeClient,
	snapshot: &'a mut Option<Value>,
) -> Result<&'a Value, AppError> {
	if snapshot.is_none() {
		match worktrees.session_snapshot() {
			Ok(value) => *snapshot = Some(value),
			Err(_) => *snapshot = Some(empty_session_snapshot()),
		}
	}
	Ok(snapshot.as_ref().expect("snapshot populated"))
}

fn empty_session_snapshot() -> Value {
	serde_json::json!({
		"type": "session_snapshot",
		"snapshot": {
			"workspaces": [],
			"tabs": [],
			"panes": []
		}
	})
}

fn profiles_from_worktree_list(
	project: &ProjectWithProfiles,
	listed: &[WorktreeListEntry],
	notes: &LeftoverNotes,
) -> Vec<Profile> {
	let mut profiles: Vec<Profile> = listed
		.iter()
		.filter_map(|entry| {
			let workspace_id =
				entry.workspace_id.as_deref().filter(|id| !id.is_empty())?;
			Some(derived_profile(
				project,
				workspace_id,
				entry.branch.clone().unwrap_or_default(),
				&entry.path,
				!entry.is_linked_worktree
					&& same_checkout_path(&entry.path, &project.folder),
				notes,
			))
		})
		.collect();
	sort_derived_profiles(&mut profiles);
	profiles
}

fn profiles_from_snapshot(
	project: &ProjectWithProfiles,
	snapshot: &Value,
	notes: &LeftoverNotes,
) -> Vec<Profile> {
	let mut by_workspace: HashMap<String, String> = HashMap::new();
	for pane in snapshot_panes(snapshot) {
		let Some(workspace_id) = json_nonempty(&pane, "workspace_id") else {
			continue;
		};
		let Some(cwd) = pane_cwd(&pane) else {
			continue;
		};
		if !same_checkout_path(&cwd, &project.folder) {
			continue;
		}
		by_workspace.entry(workspace_id.to_string()).or_insert(cwd);
	}

	let mut profiles: Vec<Profile> = by_workspace
		.into_iter()
		.map(|(workspace_id, cwd)| {
			derived_profile(
				project,
				&workspace_id,
				String::new(),
				&cwd,
				true,
				notes,
			)
		})
		.collect();
	if profiles.len() > 1 {
		profiles.sort_by(|left, right| left.id.cmp(&right.id));
		let default_id = profiles[0].id.clone();
		for profile in &mut profiles {
			profile.is_default = profile.id == default_id;
		}
	}
	sort_derived_profiles(&mut profiles);
	profiles
}

fn derived_profile(
	project: &ProjectWithProfiles,
	workspace_id: &str,
	branch_name: String,
	worktree_path: &str,
	is_default: bool,
	notes: &LeftoverNotes,
) -> Profile {
	let (notes, created_at) = notes.for_checkout(worktree_path);
	Profile {
		id: workspace_id.to_string(),
		project_id: project.id.clone(),
		branch_name,
		worktree_path: worktree_path.to_string(),
		created_at,
		is_default,
		notes,
	}
}

fn sort_derived_profiles(profiles: &mut [Profile]) {
	profiles.sort_by(|left, right| {
		right
			.is_default
			.cmp(&left.is_default)
			.then_with(|| left.branch_name.cmp(&right.branch_name))
			.then_with(|| left.id.cmp(&right.id))
	});
}

fn snapshot_panes(snapshot: &Value) -> &[Value] {
	let snap = if snapshot.get("type").and_then(Value::as_str)
		== Some("session_snapshot")
	{
		snapshot.get("snapshot").unwrap_or(snapshot)
	} else {
		snapshot
	};
	snap.get("panes")
		.and_then(Value::as_array)
		.map(Vec::as_slice)
		.unwrap_or(&[])
}

fn pane_cwd(pane: &Value) -> Option<String> {
	json_nonempty(pane, "cwd")
		.or_else(|| json_nonempty(pane, "foreground_cwd"))
		.map(str::to_string)
}

fn json_nonempty<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
	value
		.get(key)
		.and_then(Value::as_str)
		.filter(|id| !id.is_empty())
}

fn is_not_git_worktree(err: &AppError) -> bool {
	match err {
		AppError::HerdrTransport(message) => {
			message.contains("not_git_worktree")
		}
		_ => false,
	}
}

fn project_cwd(folder: &str) -> PathBuf {
	Path::new(folder)
		.canonicalize()
		.unwrap_or_else(|_| PathBuf::from(folder))
}

fn same_checkout_path(left: &str, right: &str) -> bool {
	if left == right {
		return true;
	}
	let left_path = Path::new(left);
	let right_path = Path::new(right);
	match (left_path.canonicalize(), right_path.canonicalize()) {
		(Ok(a), Ok(b)) => a == b,
		_ => left_path == right_path,
	}
}

/// Resolve the checkout used by Git, filesystem, watcher, and
/// terminal-link consumers.
///
/// Herdr-selected ids are live `workspace_id` values. Local keeps sqlite
/// `find_by_id` plus the mapped `worktree.list` cache.
pub fn reconcile_profile_checkout(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	if runtime.selected_backend() == RuntimeBackend::Local {
		return reconcile_local_profile_checkout(db, profile_id);
	}
	live_herdr_profile_checkout(runtime, profile_id)
}

fn live_herdr_profile_checkout(
	runtime: &RuntimeRouter,
	profile_id: &str,
) -> Result<String, AppError> {
	let Some(worktrees) = runtime.herdr_worktrees_optional() else {
		return Err(AppError::NotFound(format!("Profile: {profile_id}")));
	};
	live_workspace_checkout(worktrees, profile_id)
}

/// Live checkout for a Herdr `workspace_id`: `worktree.list` then snapshot
/// pane cwd. sqlite `profiles.worktree_path` is not consulted.
pub(crate) fn live_workspace_checkout(
	worktrees: &dyn HerdrWorktreeClient,
	workspace_id: &str,
) -> Result<String, AppError> {
	checkout_for_workspace(worktrees, workspace_id)
}

/// Open Herdr workspace ids joined to a project folder.
///
/// Git uses `worktree.list` (`open_workspace_id` membership). Non-git
/// uses `session.snapshot` pane `cwd` / `foreground_cwd`. Disk checkouts
/// without an open workspace are omitted. sqlite `profiles` is not
/// consulted.
pub(crate) fn live_open_workspace_ids(
	worktrees: &dyn HerdrWorktreeClient,
	folder: &str,
) -> Result<Vec<String>, AppError> {
	let cwd = project_cwd(folder);
	match worktrees.worktree_list(Some(&cwd), None) {
		Ok(listed) => Ok(workspace_ids_from_worktree_list(&listed)),
		Err(err) if is_not_git_worktree(&err) => {
			match worktrees.session_snapshot() {
				Ok(snap) => {
					Ok(workspace_ids_from_snapshot_folder(&snap, folder))
				}
				Err(_) => Ok(Vec::new()),
			}
		}
		Err(_) => Ok(Vec::new()),
	}
}

fn workspace_ids_from_worktree_list(
	listed: &[WorktreeListEntry],
) -> Vec<String> {
	let mut ids: Vec<String> = listed
		.iter()
		.filter_map(|entry| {
			entry
				.workspace_id
				.as_deref()
				.filter(|id| !id.is_empty())
				.map(str::to_string)
		})
		.collect();
	ids.sort();
	ids.dedup();
	ids
}

fn workspace_ids_from_snapshot_folder(
	snapshot: &Value,
	folder: &str,
) -> Vec<String> {
	let mut ids: Vec<String> = snapshot_panes(snapshot)
		.iter()
		.filter_map(|pane| {
			let workspace_id = json_nonempty(pane, "workspace_id")?;
			let cwd = pane_cwd(pane)?;
			same_checkout_path(&cwd, folder).then(|| workspace_id.to_string())
		})
		.collect();
	ids.sort();
	ids.dedup();
	ids
}

fn checkout_for_workspace(
	worktrees: &dyn HerdrWorktreeClient,
	workspace_id: &str,
) -> Result<String, AppError> {
	match worktrees.worktree_list(None, Some(workspace_id)) {
		Ok(listed) => {
			if let Some(path) = listed_workspace_path(&listed, workspace_id) {
				return Ok(path);
			}
		}
		Err(err) if is_not_git_worktree(&err) => {}
		Err(AppError::HerdrUncertainOutcome(_)) => {}
		Err(AppError::HerdrServerAbsent(_))
		| Err(AppError::HerdrServerIncompatible(_)) => {
			return Err(AppError::NotFound(format!("Profile: {workspace_id}")));
		}
		Err(_) => {}
	}

	let snapshot = worktrees
		.session_snapshot()
		.map_err(|_| AppError::NotFound(format!("Profile: {workspace_id}")))?;
	if let Some(path) = snapshot_workspace_cwd(&snapshot, workspace_id) {
		return Ok(path);
	}
	Err(AppError::NotFound(format!("Profile: {workspace_id}")))
}

fn listed_workspace_path(
	listed: &[WorktreeListEntry],
	workspace_id: &str,
) -> Option<String> {
	let matches: Vec<_> = listed
		.iter()
		.filter(|entry| {
			entry.workspace_id.as_deref() == Some(workspace_id)
				&& !entry.path.is_empty()
		})
		.collect();
	(matches.len() == 1).then(|| matches[0].path.clone())
}

fn snapshot_workspace_cwd(
	snapshot: &Value,
	workspace_id: &str,
) -> Option<String> {
	snapshot_panes(snapshot).iter().find_map(|pane| {
		if json_nonempty(pane, "workspace_id") == Some(workspace_id) {
			pane_cwd(pane)
		} else {
			None
		}
	})
}

fn reconcile_local_profile_checkout(
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	Ok(profile.worktree_path)
}

/// Leftover sqlite profile whose checkout path matches live Herdr cwd.
/// Mapping rows are not consulted.
pub fn sqlite_profile_id_for_checkout(
	db: &DbPool,
	checkout: &str,
) -> Result<Option<String>, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	let projects = repo::project::list_all_with_profiles(conn)?;
	for project in projects {
		for profile in project.profiles {
			if same_checkout_path(&profile.worktree_path, checkout) {
				return Ok(Some(profile.id));
			}
		}
	}
	Ok(None)
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
	let project = repo::project::find_by_id(conn, id)?;
	repo::project::delete(conn, id)?;
	cleanup_empty_group(conn, project.group_id)?;
	Ok(())
}

pub fn delete_with_runtime(
	runtime: &RuntimeRouter,
	db: &infra::db::DbPool,
	id: &str,
) -> Result<(), AppError> {
	let (project, session_ids) = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let project = repo::project::find_by_id(conn, id)?;
		let session_ids = repo::pty::list_by_project(conn, id)?
			.into_iter()
			.map(|session| session.id)
			.collect::<Vec<_>>();
		(project, session_ids)
	};

	for session_id in &session_ids {
		runtime.forget_project_session(session_id)?;
	}

	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	for session_id in &session_ids {
		repo::pty::mark_closed(conn, session_id);
	}
	repo::project::delete(conn, id)?;
	cleanup_empty_group(conn, project.group_id)?;
	Ok(())
}

pub fn create_group(
	conn: &mut SqliteConnection,
	name: &str,
) -> Result<ProjectGroup, AppError> {
	let name = name.trim();
	if name.is_empty() {
		return Err(AppError::DbError(
			"Project group name cannot be empty".into(),
		));
	}

	let id = Uuid::new_v4().to_string();
	repo::project_group::insert(conn, &id, name)
}

pub fn list_groups(
	conn: &mut SqliteConnection,
) -> Result<Vec<ProjectGroup>, AppError> {
	repo::project_group::list_all(conn)
}

pub fn cleanup_empty_groups(
	conn: &mut SqliteConnection,
) -> Result<usize, AppError> {
	repo::project_group::delete_empty(conn)
}

pub fn assign_to_group(
	conn: &mut SqliteConnection,
	project_id: &str,
	group_id: Option<String>,
) -> Result<Project, AppError> {
	let project = repo::project::find_by_id(conn, project_id)?;
	let group_id = group_id.and_then(|id| {
		let trimmed = id.trim().to_string();
		if trimmed.is_empty() {
			None
		} else {
			Some(trimmed)
		}
	});

	if let Some(group_id) = group_id.as_deref() {
		repo::project_group::find_by_id(conn, group_id)?;
	}

	let updated =
		repo::project::set_group(conn, project_id, group_id.as_deref())?;
	if project.group_id != updated.group_id {
		cleanup_empty_group(conn, project.group_id)?;
	}

	Ok(updated)
}

pub fn update_sidebar_layout(
	conn: &mut SqliteConnection,
	updates: Vec<ProjectSidebarLayoutUpdate>,
) -> Result<(), AppError> {
	conn.transaction(|conn| {
		let mut previous_group_ids = Vec::new();

		for update in &updates {
			match update.kind.as_str() {
				"group" => {
					let sort_order = update.sort_order.ok_or_else(|| {
						AppError::DbError("Group sort_order is required".into())
					})?;
					repo::project_group::set_sort_order(
						conn, &update.id, sort_order,
					)?;
				}
				"project" => {
					if update.group_id.is_some()
						&& update.pinned_order.is_some()
					{
						return Err(AppError::DbError(
							"Grouped projects cannot be pinned".into(),
						));
					}
					if let Some(group_id) = update.group_id.as_deref() {
						repo::project_group::find_by_id(conn, group_id)?;
					}
					let project = repo::project::find_by_id(conn, &update.id)?;
					if project.group_id != update.group_id {
						previous_group_ids.push(project.group_id);
					}
					repo::project::update_sidebar_layout(
						conn,
						std::slice::from_ref(update),
					)?;
				}
				other => {
					return Err(AppError::DbError(format!(
						"Unsupported sidebar layout update kind: {other}"
					)));
				}
			}
		}

		for group_id in previous_group_ids {
			cleanup_empty_group(conn, group_id)?;
		}

		Ok(())
	})
}

fn cleanup_empty_group(
	conn: &mut SqliteConnection,
	group_id: Option<String>,
) -> Result<(), AppError> {
	if let Some(group_id) = group_id {
		repo::project_group::delete_if_empty(conn, &group_id)?;
	}

	Ok(())
}

pub fn get_branch(folder: &str) -> Result<String, AppError> {
	infra::git::branch(folder)
}

pub fn get_branch_for_profile(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	infra::git::branch(&worktree_path)
}

pub fn get_diff(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	infra::git::diff(&worktree_path)
}

pub fn get_diff_stats(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<GitDiffStats, AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	infra::git::diff_stats(&worktree_path)
}

pub fn get_log(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	limit: u32,
) -> Result<Vec<GitCommit>, AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	infra::git::log(&worktree_path, limit)
}

pub fn get_commit_diff(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	commit_hash: &str,
) -> Result<String, AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	infra::git::show(&worktree_path, commit_hash)
}

pub fn get_binary_preview(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	cache_root: &Path,
	path: &str,
	source: &str,
	commit_hash: Option<&str>,
) -> Result<Option<GitBinaryPreview>, AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	let file_path = match source {
		"working_tree" => {
			infra::git::read_worktree_file(&worktree_path, cache_root, path)?
		}
		"head" => infra::git::read_head_file(&worktree_path, cache_root, path)?,
		"commit" => {
			let commit_hash = commit_hash.ok_or_else(|| {
				AppError::GitError(
					"commit_hash is required for commit previews".into(),
				)
			})?;
			infra::git::read_commit_file(
				&worktree_path,
				cache_root,
				commit_hash,
				path,
			)?
		}
		"parent_commit" => {
			let commit_hash = commit_hash.ok_or_else(|| {
				AppError::GitError(
					"commit_hash is required for parent commit previews".into(),
				)
			})?;
			infra::git::read_parent_commit_file(
				&worktree_path,
				cache_root,
				commit_hash,
				path,
			)?
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
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	files: &[String],
	message: &str,
	body: Option<&str>,
) -> Result<String, AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	infra::git::commit(&worktree_path, files, message, body)
}

pub fn discard_file_changes(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
	paths: &[String],
) -> Result<(), AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	infra::git::discard_changes(&worktree_path, paths)
}

pub fn get_ahead_count(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<u32, AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	Ok(infra::git::ahead_count(&worktree_path))
}

pub fn push(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<(), AppError> {
	let worktree_path = reconcile_profile_checkout(runtime, db, profile_id)?;
	infra::git::push(&worktree_path)
}

pub fn get_pull_request_status_for_folder(
	folder: &str,
	branch_name: Option<&str>,
) -> Result<Option<GitPullRequestStatus>, AppError> {
	match branch_name
		.map(str::trim)
		.filter(|branch| !branch.is_empty())
	{
		Some(branch_name) => {
			infra::git::pull_request_status_for_branch(folder, branch_name)
		}
		None => infra::git::pull_request_status(folder),
	}
}

pub fn get_github_avatar(
	conn: &mut SqliteConnection,
	project_id: &str,
) -> Result<Option<String>, AppError> {
	let project = repo::project::find_by_id(conn, project_id)?;
	Ok(infra::git::github_avatar_url(&project.folder))
}

#[cfg(test)]
mod tests {
	use std::collections::HashMap;
	use std::path::Path;
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::herdr::transport::{
		WorkspaceCreateRequest, WorkspaceCreateResult, WorktreeCreateRequest,
		WorktreeCreateResult, WorktreeListEntry, WorktreeOpenResult,
		WorktreeRemoveResult,
	};
	use model::runtime::HERDR_NAMESPACE;

	use super::*;
	use crate::pty::{create_flush_senders, PtyContext};
	use crate::runtime::{HerdrStubAdapter, LocalAdapter};
	use crate::PtyEventEmitter;

	struct TestEmitter;

	impl PtyEventEmitter for TestEmitter {
		fn emit_output(&self, _session_id: &str, _bytes: &[u8]) -> bool {
			true
		}

		fn emit_exit(&self, _session_id: &str) {}
	}

	struct ListCall {
		cwd: Option<String>,
		workspace_id: Option<String>,
	}

	struct FakeListState {
		methods: Vec<String>,
		calls: Vec<ListCall>,
		listed: Vec<WorktreeListEntry>,
		scoped: HashMap<String, Vec<WorktreeListEntry>>,
		not_git: Vec<String>,
		snapshot: serde_json::Value,
		snapshot_error: Option<AppError>,
		list_error: Option<AppError>,
	}

	struct FakeList {
		state: Mutex<FakeListState>,
	}

	impl FakeList {
		fn new(listed: Vec<WorktreeListEntry>) -> Arc<Self> {
			Arc::new(Self {
				state: Mutex::new(FakeListState {
					methods: Vec::new(),
					calls: Vec::new(),
					listed,
					scoped: HashMap::new(),
					not_git: Vec::new(),
					snapshot: serde_json::json!({
						"type": "session_snapshot",
						"snapshot": {
							"workspaces": [],
							"tabs": [],
							"panes": []
						}
					}),
					snapshot_error: None,
					list_error: None,
				}),
			})
		}

		fn set_scoped(&self, cwd: &str, listed: Vec<WorktreeListEntry>) {
			self.state
				.lock()
				.unwrap()
				.scoped
				.insert(cwd.to_string(), listed);
		}

		fn fail_not_git(&self, cwd: &str) {
			self.state.lock().unwrap().not_git.push(cwd.to_string());
		}

		fn set_snapshot(&self, snapshot: serde_json::Value) {
			self.state.lock().unwrap().snapshot = snapshot;
		}

		fn fail_snapshot(&self, err: AppError) {
			self.state.lock().unwrap().snapshot_error = Some(err);
		}

		fn methods(&self) -> Vec<String> {
			self.state.lock().unwrap().methods.clone()
		}

		fn calls(&self) -> Vec<(Option<String>, Option<String>)> {
			self.state
				.lock()
				.unwrap()
				.calls
				.iter()
				.map(|call| (call.cwd.clone(), call.workspace_id.clone()))
				.collect()
		}

		fn fail_list(&self, err: AppError) {
			self.state.lock().unwrap().list_error = Some(err);
		}
	}

	impl HerdrWorktreeClient for FakeList {
		fn worktree_create(
			&self,
			_request: WorktreeCreateRequest<'_>,
		) -> Result<WorktreeCreateResult, AppError> {
			self.state.lock().unwrap().methods.push("create".into());
			Err(AppError::PtyError(
				"path reconcile does not create worktrees".into(),
			))
		}

		fn worktree_list(
			&self,
			cwd: Option<&Path>,
			workspace_id: Option<&str>,
		) -> Result<Vec<WorktreeListEntry>, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("worktree.list".into());
			state.calls.push(ListCall {
				cwd: cwd.map(|cwd| cwd.to_string_lossy().into_owned()),
				workspace_id: workspace_id.map(str::to_string),
			});
			if let Some(err) = state.list_error.take() {
				return Err(err);
			}
			if let Some(cwd) = cwd {
				let cwd = cwd.to_string_lossy().into_owned();
				if state.not_git.iter().any(|path| path == &cwd) {
					return Err(AppError::HerdrTransport(
						"Herdr RPC not_git_worktree (wtlst): Herdr worktree actions require a path inside a Git work tree".into(),
					));
				}
				if let Some(listed) = state.scoped.get(&cwd) {
					return Ok(listed.clone());
				}
			}
			if let Some(workspace_id) = workspace_id {
				return Ok(state
					.listed
					.iter()
					.filter(|entry| {
						entry.workspace_id.as_deref() == Some(workspace_id)
					})
					.cloned()
					.collect());
			}
			Ok(state.listed.clone())
		}

		fn worktree_open(
			&self,
			_cwd: &Path,
			_path: &Path,
		) -> Result<WorktreeOpenResult, AppError> {
			self.state
				.lock()
				.unwrap()
				.methods
				.push("worktree.open".into());
			Err(AppError::PtyError(
				"path reconcile does not open worktrees".into(),
			))
		}

		fn worktree_remove(
			&self,
			_workspace_id: &str,
			_force: bool,
		) -> Result<WorktreeRemoveResult, AppError> {
			self.state
				.lock()
				.unwrap()
				.methods
				.push("worktree.remove".into());
			Err(AppError::PtyError(
				"path reconcile does not remove worktrees".into(),
			))
		}

		fn workspace_create(
			&self,
			_request: WorkspaceCreateRequest<'_>,
		) -> Result<WorkspaceCreateResult, AppError> {
			self.state
				.lock()
				.unwrap()
				.methods
				.push("workspace.create".into());
			Err(AppError::PtyError(
				"path reconcile does not create workspaces".into(),
			))
		}

		fn workspace_close(&self, _workspace_id: &str) -> Result<(), AppError> {
			self.state
				.lock()
				.unwrap()
				.methods
				.push("workspace.close".into());
			Err(AppError::PtyError(
				"path reconcile does not close workspaces".into(),
			))
		}

		fn session_snapshot(&self) -> Result<serde_json::Value, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("session.snapshot".into());
			if let Some(err) = state.snapshot_error.take() {
				return Err(err);
			}
			Ok(state.snapshot.clone())
		}
	}

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

	fn pool_from(conn: SqliteConnection) -> DbPool {
		Arc::new(Mutex::new(conn))
	}

	fn local_router(
		db: &DbPool,
		worktrees: Option<Arc<FakeList>>,
	) -> RuntimeRouter {
		let logs = std::env::temp_dir().join("2code-project-path-logs");
		std::fs::create_dir_all(&logs).ok();
		let ctx = PtyContext {
			db: db.clone(),
			sessions: infra::pty::create_session_map(),
			flush_senders: create_flush_senders(),
			read_threads: infra::pty::create_thread_tracker(),
			emitter: Arc::new(TestEmitter),
			output_dir: logs,
		};
		let herdr = match worktrees {
			Some(client) => HerdrStubAdapter::with_worktree_client(client),
			None => HerdrStubAdapter::new(),
		};
		RuntimeRouter::with_backend(
			model::runtime::RuntimeBackend::Local,
			LocalAdapter::new(ctx),
			herdr,
		)
	}

	fn herdr_router(
		db: &DbPool,
		worktrees: Option<Arc<FakeList>>,
	) -> RuntimeRouter {
		let logs = std::env::temp_dir().join("2code-project-herdr-list-logs");
		std::fs::create_dir_all(&logs).ok();
		let ctx = PtyContext {
			db: db.clone(),
			sessions: infra::pty::create_session_map(),
			flush_senders: create_flush_senders(),
			read_threads: infra::pty::create_thread_tracker(),
			emitter: Arc::new(TestEmitter),
			output_dir: logs,
		};
		let herdr = match worktrees {
			Some(client) => HerdrStubAdapter::with_worktree_client(client),
			None => HerdrStubAdapter::new(),
		};
		RuntimeRouter::with_backend(
			model::runtime::RuntimeBackend::Herdr,
			LocalAdapter::new(ctx),
			herdr,
		)
	}

	fn insert_catalog(
		conn: &mut SqliteConnection,
		folder: &str,
		worktree_path: &str,
	) -> (String, String) {
		let project = repo::project::insert(conn, "proj-1", "Project", folder)
			.expect("insert project");
		let profile = repo::profile::insert(
			conn,
			"prof-1",
			&project.id,
			"feat/x",
			worktree_path,
		)
		.expect("insert profile");
		(project.id, profile.id)
	}

	fn listed(
		path: &str,
		workspace_id: Option<&str>,
		branch: Option<&str>,
	) -> WorktreeListEntry {
		listed_entry(path, workspace_id, branch, true)
	}

	fn primary(
		path: &str,
		workspace_id: Option<&str>,
		branch: Option<&str>,
	) -> WorktreeListEntry {
		listed_entry(path, workspace_id, branch, false)
	}

	fn listed_entry(
		path: &str,
		workspace_id: Option<&str>,
		branch: Option<&str>,
		is_linked_worktree: bool,
	) -> WorktreeListEntry {
		WorktreeListEntry {
			path: path.to_string(),
			branch: branch.map(str::to_string),
			workspace_id: workspace_id.map(str::to_string),
			is_linked_worktree,
		}
	}

	fn git(dir: &Path, args: &[&str]) {
		let output = infra::no_window::command_without_windows_console("git")
			.args(args)
			.current_dir(dir)
			.output()
			.expect("git");
		assert!(
			output.status.success(),
			"git {args:?} failed: {}",
			String::from_utf8_lossy(&output.stderr)
		);
	}

	fn init_git_repo(file: &str, content: &str) -> tempfile::TempDir {
		let dir = tempfile::tempdir().expect("tempdir");
		git(dir.path(), &["init"]);
		git(dir.path(), &["config", "user.email", "test@test.com"]);
		git(dir.path(), &["config", "user.name", "Test User"]);
		std::fs::write(dir.path().join(file), content).expect("write");
		git(dir.path(), &["add", file]);
		git(dir.path(), &["commit", "-m", "init"]);
		dir
	}

	fn leftover_git_helper_bodies(src: &str) -> Vec<(&'static str, String)> {
		const NAMES: &[&str] = &[
			"pub fn get_diff(",
			"pub fn get_diff_stats(",
			"pub fn get_log(",
			"pub fn get_commit_diff(",
			"pub fn get_binary_preview(",
			"pub fn commit_changes(",
			"pub fn discard_file_changes(",
			"pub fn get_ahead_count(",
			"pub fn push(",
		];
		NAMES
			.iter()
			.map(|name| {
				let body = src
					.split(name)
					.nth(1)
					.unwrap_or_else(|| panic!("missing {name}"))
					.split("\npub fn ")
					.next()
					.unwrap()
					.to_string();
				(*name, body)
			})
			.collect()
	}

	#[test]
	fn project_delete_is_forget_retain() {
		let src = include_str!("project.rs");
		let delete = src
			.split("pub fn delete_with_runtime")
			.nth(1)
			.unwrap()
			.split("pub fn create_group")
			.next()
			.unwrap();
		assert!(delete.contains("forget_project_session"));
		assert!(!delete.contains("worktree.remove"));
		assert!(!delete.contains("worktree_remove"));
		assert!(!delete.contains("git::worktree_remove"));
		assert!(!delete.contains("workspace.close"));
		assert!(!delete.contains("workspace_close"));
		assert!(!delete.contains("pane.close"));
		assert!(!delete.contains("pane_close"));
		assert!(!delete.contains("teardown_session"));
		assert!(!delete.contains("server.stop"));
		assert!(!delete.contains("pane.send_input"));
		assert!(!delete.contains("--takeover"));
		let handler = include_str!("../../../src/handler/project.rs");
		let delete = handler
			.split("pub async fn delete_project")
			.nth(1)
			.unwrap()
			.split("pub async fn create_project_group")
			.next()
			.unwrap();
		assert!(delete.contains("delete_with_runtime"));
		assert!(!delete.contains("worktree.remove"));
		assert!(!delete.contains("pane.close"));
	}

	#[test]
	fn path_reconcile_does_not_mutate_or_start_herdr() {
		let src = include_str!("project.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		let reconcile = src
			.split("pub fn reconcile_profile_checkout")
			.nth(1)
			.unwrap()
			.split("pub fn update")
			.next()
			.unwrap();
		assert!(reconcile.contains("worktree_list"));
		assert!(reconcile.contains("workspace_id"));
		let dotted = |name: &str| format!("worktree.{name}");
		assert!(!reconcile.contains(&dotted("create")));
		assert!(!reconcile.contains("worktree_create"));
		assert!(!reconcile.contains(&dotted("remove")));
		assert!(!reconcile.contains("worktree_remove"));
		assert!(!reconcile.contains(&dotted("open")));
		assert!(!reconcile.contains("worktree_open"));
		assert!(!reconcile.contains("git::worktree"));
		assert!(!reconcile.contains("workspace.close"));
		assert!(!reconcile.contains("pane.close"));
		assert!(!reconcile.contains("pane.send_input"));
		assert!(!reconcile.contains("server.stop"));
		assert!(!reconcile.contains("--takeover"));
		assert!(!reconcile.contains("herdr-client.sock"));
		assert!(!reconcile.contains("ensure_herdr_listener"));
		assert!(!reconcile.contains("ProjectedWorkspace"));
		assert!(!reconcile.contains("apply_snapshot"));
		assert!(
			reconcile.contains("session_snapshot")
				|| reconcile.contains("session.snapshot"),
			"Herdr live resolve joins non-git pane cwd via session.snapshot"
		);
		let local = src
			.split("fn reconcile_local_profile_checkout")
			.nth(1)
			.unwrap()
			.split("pub fn update")
			.next()
			.unwrap();
		assert!(!local.contains("session_snapshot"));
		assert!(!local.contains("worktree_list"));
		assert!(!local.contains("find_profile_mapping"));
		assert!(!src.contains("set_worktree_path"));
		assert!(!src.contains("workspace.list"));
		let lib = include_str!("../../../src/lib.rs");
		assert!(!lib.contains("ensure_herdr_listener"));
		assert!(src.contains("herdr_worktrees_optional"));
	}

	#[test]
	fn unmapped_profile_uses_db_worktree_path() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/repo/wt");
		let db = pool_from(conn);
		let fake =
			FakeList::new(vec![listed("/other", Some("w1"), Some("feat/x"))]);
		let runtime = local_router(&db, Some(fake.clone()));

		let path = reconcile_profile_checkout(&runtime, &db, &profile_id)
			.expect("unmapped cache");

		assert_eq!(path, "/repo/wt");
		assert!(fake.methods().is_empty());
		assert_eq!(
			runtime.selected_backend(),
			model::runtime::RuntimeBackend::Local
		);
	}

	#[test]
	fn mapped_profile_without_client_uses_cache_and_does_not_start_herdr() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&profile_id,
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		let db = pool_from(conn);
		let runtime = local_router(&db, None);

		let path = reconcile_profile_checkout(&runtime, &db, &profile_id)
			.expect("cache without client");

		assert_eq!(path, "/stale");
		assert!(runtime.herdr_worktrees_optional().is_none());
		assert_eq!(
			runtime.selected_backend(),
			model::runtime::RuntimeBackend::Local
		);
	}

	#[test]
	fn mapped_leftover_does_not_write_listed_path_or_call_herdr() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&profile_id,
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			listed("/other", Some("w2"), Some("feat/x")),
			listed("/listed", Some("w1"), Some("other-name")),
		]);
		let runtime = local_router(&db, Some(fake.clone()));

		let path = reconcile_profile_checkout(&runtime, &db, &profile_id)
			.expect("sqlite cache");

		assert_eq!(path, "/stale");
		assert!(fake.methods().is_empty());
		let conn = &mut *db.lock().unwrap();
		assert_eq!(
			repo::profile::find_by_id(conn, &profile_id)
				.unwrap()
				.worktree_path,
			"/stale"
		);
	}

	#[test]
	fn mapped_unavailable_workspace_keeps_sqlite_cache() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&profile_id,
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			listed("/repo", Some("w-default"), Some("main")),
			listed("/other-profile", Some("w2"), Some("feat/x")),
		]);
		let runtime = local_router(&db, Some(fake.clone()));

		let path = reconcile_profile_checkout(&runtime, &db, &profile_id)
			.expect("sqlite cache");

		assert_eq!(path, "/stale");
		assert!(fake.methods().is_empty());
		let conn = &mut *db.lock().unwrap();
		assert_eq!(
			repo::profile::find_by_id(conn, &profile_id)
				.unwrap()
				.worktree_path,
			"/stale"
		);
	}

	#[test]
	fn leftover_mapping_does_not_consult_herdr_on_uncertain_list() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&profile_id,
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![listed("/listed", Some("w1"), None)]);
		fake.fail_list(AppError::HerdrUncertainOutcome("dropped".into()));
		let runtime = local_router(&db, Some(fake.clone()));

		let path = reconcile_profile_checkout(&runtime, &db, &profile_id)
			.expect("sqlite cache");

		assert_eq!(path, "/stale");
		assert!(fake.methods().is_empty());
		let conn = &mut *db.lock().unwrap();
		assert_eq!(
			repo::profile::find_by_id(conn, &profile_id)
				.unwrap()
				.worktree_path,
			"/stale"
		);
	}

	#[test]
	fn list_with_runtime_local_keeps_sqlite_worktree_path() {
		let mut conn = setup_db();
		let (project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&profile_id,
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		let unmapped = repo::profile::insert(
			&mut conn,
			"prof-local",
			&project_id,
			"local",
			"/local-wt",
		)
		.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![listed("/listed", Some("w1"), None)]);
		let runtime = local_router(&db, Some(fake.clone()));

		let listed = list_with_runtime(&runtime, &db).expect("list");

		let project = &listed[0];
		let mapped = project
			.profiles
			.iter()
			.find(|profile| profile.id == profile_id)
			.unwrap();
		let local = project
			.profiles
			.iter()
			.find(|profile| profile.id == unmapped.id)
			.unwrap();
		assert_eq!(mapped.worktree_path, "/stale");
		assert_eq!(local.worktree_path, "/local-wt");
		assert!(fake.methods().is_empty());
	}

	#[test]
	fn list_with_runtime_keeps_cache_when_mapped_workspace_is_unavailable() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&profile_id,
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![listed("/repo", Some("w-other"), None)]);
		let runtime = local_router(&db, Some(fake));

		let listed = list_with_runtime(&runtime, &db).expect("catalog");

		assert_eq!(listed[0].profiles[0].worktree_path, "/stale");
	}

	#[test]
	fn herdr_list_ignores_sqlite_rows_and_disk_only_checkouts() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		repo::profile::insert(
			&mut conn,
			"default-proj-1",
			"proj-1",
			"main",
			"/repo",
		)
		.ok();
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&profile_id,
			HERDR_NAMESPACE,
			"w-sqlite",
		)
		.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary("/repo", None, Some("main")),
			listed("/repo/disk", None, Some("wt/disk")),
		]);
		let runtime = herdr_router(&db, Some(fake.clone()));

		let listed = list_with_runtime(&runtime, &db).expect("list");

		assert_eq!(listed[0].profiles.len(), 0);
		assert!(fake.methods().contains(&"worktree.list".to_string()));
		assert!(!fake.methods().iter().any(|m| m == "session.snapshot"));
		assert_eq!(fake.calls(), vec![(Some("/repo".into()), None)]);
	}

	#[test]
	fn herdr_list_returns_open_primary_and_linked_workspace_ids() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary("/repo", Some("w1"), Some("main")),
			listed("/repo/disk", None, Some("wt/disk")),
			listed("/repo/linked", Some("w2"), Some("feat/x")),
		]);
		let runtime = herdr_router(&db, Some(fake.clone()));

		let listed = list_with_runtime(&runtime, &db).expect("list");
		let profiles = &listed[0].profiles;
		assert_eq!(profiles.len(), 2);
		assert_eq!(profiles[0].id, "w1");
		assert!(profiles[0].is_default);
		assert_eq!(profiles[0].worktree_path, "/repo");
		assert_eq!(profiles[0].branch_name, "main");
		assert_eq!(profiles[1].id, "w2");
		assert!(!profiles[1].is_default);
		assert_eq!(profiles[1].worktree_path, "/repo/linked");
		assert_eq!(profiles[1].branch_name, "feat/x");
		assert!(!fake
			.methods()
			.iter()
			.any(|method| method.contains("workspace.list")));
	}

	#[test]
	fn herdr_list_isolates_a_second_repo() {
		let mut conn = setup_db();
		repo::project::insert(&mut conn, "proj-a", "A", "/repo-a").unwrap();
		repo::profile::insert_default(
			&mut conn,
			"default-proj-a",
			"proj-a",
			"main",
			"/repo-a",
		)
		.unwrap();
		repo::project::insert(&mut conn, "proj-b", "B", "/repo-b").unwrap();
		repo::profile::insert_default(
			&mut conn,
			"default-proj-b",
			"proj-b",
			"main",
			"/repo-b",
		)
		.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(Vec::new());
		fake.set_scoped(
			"/repo-a",
			vec![
				primary("/repo-a", Some("w1"), Some("main")),
				listed("/repo-a/linked", Some("w2"), Some("feat")),
			],
		);
		fake.set_scoped(
			"/repo-b",
			vec![primary("/repo-b", Some("w3"), Some("main"))],
		);
		let runtime = herdr_router(&db, Some(fake));

		let listed = list_with_runtime(&runtime, &db).expect("list");
		let project_a = listed.iter().find(|p| p.id == "proj-a").unwrap();
		let project_b = listed.iter().find(|p| p.id == "proj-b").unwrap();
		assert_eq!(
			project_a
				.profiles
				.iter()
				.map(|p| p.id.as_str())
				.collect::<Vec<_>>(),
			vec!["w1", "w2"]
		);
		assert_eq!(
			project_b
				.profiles
				.iter()
				.map(|p| p.id.as_str())
				.collect::<Vec<_>>(),
			vec!["w3"]
		);
	}

	#[test]
	fn herdr_list_joins_nongit_snapshot_pane_cwd() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/nongit", "/nongit");
		let db = pool_from(conn);
		let fake = FakeList::new(Vec::new());
		fake.fail_not_git("/nongit");
		fake.set_snapshot(serde_json::json!({
			"type": "session_snapshot",
			"snapshot": {
				"workspaces": [{"workspace_id": "w4", "label": "nongit"}],
				"tabs": [],
				"panes": [
					{
						"pane_id": "w4:p1",
						"workspace_id": "w4",
						"cwd": "/nongit"
					},
					{
						"pane_id": "w4:p2",
						"workspace_id": "w4",
						"cwd": "/nongit"
					},
					{
						"pane_id": "w9:p1",
						"workspace_id": "w9",
						"cwd": "/other-project"
					}
				]
			}
		}));
		let runtime = herdr_router(&db, Some(fake.clone()));

		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert_eq!(listed[0].profiles.len(), 1);
		assert_eq!(listed[0].profiles[0].id, "w4");
		assert!(listed[0].profiles[0].is_default);
		assert_eq!(listed[0].profiles[0].worktree_path, "/nongit");
		assert!(fake.methods().contains(&"session.snapshot".to_string()));
	}

	#[test]
	fn live_open_workspace_ids_join_git_and_nongit_without_sqlite() {
		let git = FakeList::new(Vec::new());
		git.set_scoped(
			"/repo",
			vec![
				primary("/repo", Some("w1"), Some("main")),
				listed("/repo/linked", Some("w2"), Some("feat")),
				primary("/repo/disk", None, Some("old")),
			],
		);
		assert_eq!(
			live_open_workspace_ids(git.as_ref(), "/repo").unwrap(),
			vec!["w1".to_string(), "w2".to_string()]
		);

		let nongit = FakeList::new(Vec::new());
		nongit.fail_not_git("/nongit");
		nongit.set_snapshot(serde_json::json!({
			"type": "session_snapshot",
			"snapshot": {
				"panes": [
					{"pane_id": "w4:p1", "workspace_id": "w4", "cwd": "/nongit"},
					{"pane_id": "w4:p2", "workspace_id": "w4", "cwd": "/nongit"},
					{"pane_id": "w9:p1", "workspace_id": "w9", "cwd": "/other"}
				]
			}
		}));
		assert_eq!(
			live_open_workspace_ids(nongit.as_ref(), "/nongit").unwrap(),
			vec!["w4".to_string()]
		);
	}

	#[test]
	fn herdr_list_empty_snapshot_stays_empty() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/nongit", "/stale");
		let db = pool_from(conn);
		let fake = FakeList::new(Vec::new());
		fake.fail_not_git("/nongit");
		let runtime = herdr_router(&db, Some(fake));

		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert!(listed[0].profiles.is_empty());
	}

	#[test]
	fn herdr_nongit_snapshot_error_stays_empty() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/nongit", "/stale");
		let db = pool_from(conn);
		let fake = FakeList::new(Vec::new());
		fake.fail_not_git("/nongit");
		fake.fail_snapshot(AppError::HerdrServerAbsent("down".into()));
		let runtime = herdr_router(&db, Some(fake));

		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert!(listed[0].profiles.is_empty());
	}

	#[test]
	fn herdr_down_does_not_sqlite_fill_profiles() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let runtime = herdr_router(&db, None);

		let listed = list_with_runtime(&runtime, &db).expect("catalog");

		assert_eq!(listed.len(), 1);
		assert_eq!(listed[0].id, "proj-1");
		assert!(listed[0].profiles.is_empty());
		assert!(runtime.herdr_worktrees_optional().is_none());
	}

	#[test]
	fn herdr_list_overlays_notes_from_checkout_path_not_mapping() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/repo");
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&profile_id,
			HERDR_NAMESPACE,
			"w2",
		)
		.unwrap();
		repo::profile::update_notes(&mut conn, &profile_id, "hello notes")
			.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary("/repo", Some("w1"), Some("main")),
			listed("/repo/linked", Some("w2"), Some("feat")),
		]);
		let runtime = herdr_router(&db, Some(fake));

		let listed = list_with_runtime(&runtime, &db).expect("list");
		let w1 = listed[0].profiles.iter().find(|p| p.id == "w1").unwrap();
		let w2 = listed[0].profiles.iter().find(|p| p.id == "w2").unwrap();
		assert_eq!(w1.notes, "hello notes");
		assert_eq!(w2.notes, "");
	}

	#[test]
	fn herdr_live_checkout_resolves_workspace_id() {
		let db = pool_from(setup_db());
		let fake = FakeList::new(vec![
			primary("/repo", Some("w1"), Some("main")),
			listed("/repo/linked", Some("w2"), Some("feat")),
		]);
		let runtime = herdr_router(&db, Some(fake.clone()));

		let path =
			reconcile_profile_checkout(&runtime, &db, "w2").expect("live path");
		assert_eq!(path, "/repo/linked");
		assert_eq!(fake.calls(), vec![(None, Some("w2".into()))]);
	}

	#[test]
	fn herdr_live_checkout_does_not_resolve_sqlite_uuid() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let fake =
			FakeList::new(vec![primary("/repo", Some("w1"), Some("main"))]);
		let runtime = herdr_router(&db, Some(fake));

		let err = reconcile_profile_checkout(&runtime, &db, &profile_id)
			.expect_err("stale uuid");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");
	}

	#[test]
	fn explicit_local_router_stays_local_for_path_reconcile() {
		let db = pool_from(setup_db());
		let runtime = local_router(&db, None);
		assert_eq!(
			runtime.selected_backend(),
			model::runtime::RuntimeBackend::Local
		);
	}

	#[test]
	fn local_flag_list_keeps_sqlite_nested_profiles() {
		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let runtime = local_router(&db, None);

		let listed = list_with_runtime(&runtime, &db).expect("list");

		assert_eq!(listed[0].profiles.len(), 1);
		assert_eq!(listed[0].profiles[0].id, profile_id);
		assert_eq!(listed[0].profiles[0].worktree_path, "/stale");
	}

	#[test]
	fn production_router_new_selects_herdr_for_path_reconcile() {
		let db = pool_from(setup_db());
		let logs = std::env::temp_dir().join("2code-project-herdr-logs");
		std::fs::create_dir_all(&logs).ok();
		let ctx = PtyContext {
			db: db.clone(),
			sessions: infra::pty::create_session_map(),
			flush_senders: create_flush_senders(),
			read_threads: infra::pty::create_thread_tracker(),
			emitter: Arc::new(TestEmitter),
			output_dir: logs,
		};
		let runtime =
			RuntimeRouter::new(LocalAdapter::new(ctx), HerdrStubAdapter::new());
		assert_eq!(
			runtime.selected_backend(),
			model::runtime::RuntimeBackend::Herdr
		);
	}

	#[test]
	fn leftover_git_helpers_reconcile_instead_of_sqlite_find() {
		let src = include_str!("project.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		for (name, body) in leftover_git_helper_bodies(src) {
			assert!(
				body.contains("reconcile_profile_checkout"),
				"{name} must use live reconcile"
			);
			assert!(
				!body.contains("find_by_id"),
				"{name} must not sqlite-resolve checkout"
			);
		}
		let avatar = src
			.split("pub fn get_github_avatar")
			.nth(1)
			.unwrap()
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(avatar.contains("project.folder"));
		assert!(!avatar.contains("worktree_path"));
	}

	#[test]
	fn herdr_git_helpers_use_listed_checkout_not_sqlite_stale() {
		let listed_repo = init_git_repo("listed.txt", "listed-clean\n");
		let stale_repo = init_git_repo("stale.txt", "stale-clean\n");
		std::fs::write(listed_repo.path().join("listed.txt"), "listed-dirty\n")
			.expect("dirty listed");
		std::fs::write(stale_repo.path().join("stale.txt"), "stale-dirty\n")
			.expect("dirty stale");
		let listed_path = listed_repo.path().to_string_lossy().into_owned();
		let stale_path = stale_repo.path().to_string_lossy().into_owned();

		let mut conn = setup_db();
		insert_catalog(&mut conn, &listed_path, &stale_path);
		let db = pool_from(conn);
		let fake =
			FakeList::new(vec![listed(&listed_path, Some("w1"), Some("main"))]);
		let runtime = herdr_router(&db, Some(fake));

		let diff = get_diff(&runtime, &db, "w1").expect("listed diff");
		assert!(diff.contains("listed.txt"), "{diff}");
		assert!(diff.contains("listed-dirty"), "{diff}");
		assert!(!diff.contains("stale.txt"), "{diff}");
		assert!(!diff.contains("stale-dirty"), "{diff}");

		let stats = get_diff_stats(&runtime, &db, "w1").expect("stats");
		assert_eq!(stats.files_changed, 1);

		let log = get_log(&runtime, &db, "w1", 5).expect("log");
		assert_eq!(log.len(), 1);
		assert_eq!(log[0].message, "init");

		let hash = log[0].full_hash.clone();
		let show = get_commit_diff(&runtime, &db, "w1", &hash).expect("show");
		assert!(show.contains("listed.txt"), "{show}");
		assert!(!show.contains("stale.txt"), "{show}");

		assert_eq!(get_ahead_count(&runtime, &db, "w1").expect("ahead"), 0);

		commit_changes(
			&runtime,
			&db,
			"w1",
			&["listed.txt".into()],
			"from herdr",
			None,
		)
		.expect("commit listed");
		let after = get_diff(&runtime, &db, "w1").expect("committed listed");
		assert!(!after.contains("listed-dirty"), "{after}");
		std::fs::write(listed_repo.path().join("listed.txt"), "listed-again\n")
			.expect("dirty listed again");
		discard_file_changes(&runtime, &db, "w1", &["listed.txt".into()])
			.expect("discard listed");
		let discarded =
			get_diff(&runtime, &db, "w1").expect("discarded listed");
		assert!(!discarded.contains("listed-again"), "{discarded}");
		let stale_diff =
			infra::git::diff(&stale_path).expect("stale untouched");
		assert!(stale_diff.contains("stale-dirty"), "{stale_diff}");

		let sqlite_id = "prof-1";
		let err = get_diff(&runtime, &db, sqlite_id).expect_err("sqlite uuid");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");

		std::fs::write(listed_repo.path().join("listed-only.rs"), "listed")
			.expect("listed search file");
		std::fs::write(stale_repo.path().join("stale-only.rs"), "stale")
			.expect("stale search file");
		let found = crate::filesystem::search_file_for_profile(
			&runtime,
			&db,
			"w1",
			"listed-only",
		)
		.expect("live search");
		assert_eq!(found.len(), 1);
		assert_eq!(found[0].name, "listed-only.rs");
		assert!(crate::filesystem::search_file_for_profile(
			&runtime,
			&db,
			"w1",
			"stale-only",
		)
		.expect("no stale")
		.is_empty());
		let status = crate::filesystem::get_file_tree_git_status_for_profile(
			&runtime, &db, "w1",
		)
		.expect("live status");
		assert!(status
			.iter()
			.any(|entry| entry.path.contains("listed-only.rs")));
		assert!(status
			.iter()
			.all(|entry| !entry.path.contains("stale-only.rs")));
	}

	#[test]
	fn herdr_git_helpers_fail_closed_when_unknown_or_down() {
		let listed_repo = init_git_repo("listed.txt", "listed\n");
		let stale_repo = init_git_repo("stale.txt", "stale\n");
		std::fs::write(stale_repo.path().join("stale.txt"), "stale-dirty\n")
			.expect("dirty stale");
		let listed_path = listed_repo.path().to_string_lossy().into_owned();
		let stale_path = stale_repo.path().to_string_lossy().into_owned();

		let mut conn = setup_db();
		insert_catalog(&mut conn, &listed_path, &stale_path);
		let db = pool_from(conn);
		let fake =
			FakeList::new(vec![listed(&listed_path, Some("w1"), Some("main"))]);
		let runtime = herdr_router(&db, Some(fake));

		let err = get_diff(&runtime, &db, "w-missing").expect_err("unknown");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");

		let down = herdr_router(&db, None);
		let err = get_diff(&down, &db, "w1").expect_err("herdr down");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");
		let stale_diff = infra::git::diff(&stale_path).expect("stale exists");
		assert!(stale_diff.contains("stale-dirty"), "{stale_diff}");
		let err = crate::filesystem::search_file_for_profile(
			&down, &db, "w1", "main",
		)
		.expect_err("search herdr down");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");
	}

	#[test]
	fn local_git_helpers_keep_sqlite_nested_path() {
		let listed_repo = init_git_repo("listed.txt", "listed-clean\n");
		let stale_repo = init_git_repo("stale.txt", "stale-clean\n");
		std::fs::write(listed_repo.path().join("listed.txt"), "listed-dirty\n")
			.expect("dirty listed");
		std::fs::write(stale_repo.path().join("stale.txt"), "stale-dirty\n")
			.expect("dirty stale");
		let listed_path = listed_repo.path().to_string_lossy().into_owned();
		let stale_path = stale_repo.path().to_string_lossy().into_owned();

		let mut conn = setup_db();
		let (_project_id, profile_id) =
			insert_catalog(&mut conn, &listed_path, &stale_path);
		let db = pool_from(conn);
		let runtime = local_router(&db, None);

		let diff =
			get_diff(&runtime, &db, &profile_id).expect("sqlite local diff");
		assert!(diff.contains("stale.txt"), "{diff}");
		assert!(diff.contains("stale-dirty"), "{diff}");
		assert!(!diff.contains("listed.txt"), "{diff}");
	}

	#[test]
	fn herdr_watcher_targets_omit_leftover_sqlite_stale() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary("/repo", Some("w1"), Some("main")),
			listed("/listed", Some("w2"), Some("feat")),
		]);
		let runtime = herdr_router(&db, Some(fake));

		let listed = list_with_runtime(&runtime, &db).expect("list");
		let targets = crate::watcher::watcher_targets(&listed);

		assert!(targets.iter().any(|target| {
			target.root_path == "/repo"
				&& target.profile_id.as_deref() == Some("w1")
		}));
		assert!(targets.iter().any(|target| {
			target.root_path == "/listed"
				&& target.profile_id.as_deref() == Some("w2")
		}));
		assert!(!targets.iter().any(|target| target.root_path == "/stale"));
	}

	#[test]
	fn herdr_empty_watcher_targets_fall_back_to_project_folder() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let runtime = herdr_router(&db, None);

		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert!(listed[0].profiles.is_empty());
		let targets = crate::watcher::watcher_targets(&listed);

		assert_eq!(targets.len(), 1);
		assert_eq!(targets[0].root_path, "/repo");
		assert_eq!(targets[0].profile_id, None);
		assert!(!targets.iter().any(|target| target.root_path == "/stale"));
	}

	#[test]
	fn local_watcher_targets_keep_sqlite_nested_paths() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let runtime = local_router(&db, None);

		let listed = list_with_runtime(&runtime, &db).expect("list");
		let targets = crate::watcher::watcher_targets(&listed);

		assert!(targets.iter().any(|target| {
			target.root_path == "/stale"
				&& target.profile_id.as_deref() == Some("prof-1")
		}));
	}
}
