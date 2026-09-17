use std::collections::HashMap;
use std::path::{Path, PathBuf};

use diesel::{Connection, SqliteConnection};
use serde_json::Value;
use uuid::Uuid;

use infra::db::DbPool;
use infra::herdr::transport::{WorkspaceCreateRequest, WorktreeListEntry};
use model::error::AppError;
use model::profile::Profile;
use model::project::{
	GitBinaryPreview, GitCommit, GitDiffStats, GitPullRequestStatus, Project,
	ProjectSidebarLayoutUpdate, ProjectWithProfiles,
};
use model::project_group::ProjectGroup;

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
	repo::project::insert(conn, &id, name, folder)
}

pub fn list(
	conn: &mut SqliteConnection,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	Ok(repo::project::list_all(conn)?
		.into_iter()
		.map(project_without_profiles)
		.collect())
}

/// Return the project catalog with nested profiles.
///
/// Live read of sqlite **projects** plus open Herdr workspaces. Does not
/// open or create Herdr workspaces. Watcher polling uses this so a 3s
/// tick cannot mutate Herdr. GUI listing uses
/// [`adopt_existing_checkouts`] first.
/// sqlite `profiles` is gone. A missing Herdr client yields empty
/// profiles, not a synthetic Local catalog.
pub fn list_with_runtime(
	runtime: &RuntimeRouter,
	db: &DbPool,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	list_herdr_derived(runtime, db)
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

struct CheckoutNotesOverlay {
	rows: Vec<model::profile::CheckoutNote>,
}

impl CheckoutNotesOverlay {
	fn for_checkout(
		&self,
		project_id: &str,
		checkout: &str,
	) -> (String, String) {
		self.rows
			.iter()
			.find(|row| {
				row.project_id == project_id
					&& same_checkout_path(&row.checkout_path, checkout)
			})
			.map(|row| (row.notes.clone(), row.created_at.clone()))
			.unwrap_or_else(|| (String::new(), String::new()))
	}
}

/// Notes keyed by project + canonical checkout path. Not stored in Herdr.
fn notes_overlay(
	conn: &mut SqliteConnection,
) -> Result<CheckoutNotesOverlay, AppError> {
	Ok(CheckoutNotesOverlay {
		rows: repo::checkout_notes::list_all(conn)?,
	})
}

fn derive_project_profiles(
	worktrees: &dyn HerdrWorktreeClient,
	project: &ProjectWithProfiles,
	notes: &CheckoutNotesOverlay,
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
	notes: &CheckoutNotesOverlay,
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
	notes: &CheckoutNotesOverlay,
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
	notes: &CheckoutNotesOverlay,
) -> Profile {
	let (notes, created_at) = notes.for_checkout(&project.id, worktree_path);
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
/// Profile ids are live Herdr `workspace_id` values.
pub fn reconcile_profile_checkout(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let _ = db;
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

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	name: Option<String>,
	folder: Option<String>,
) -> Result<Project, AppError> {
	repo::project::update(conn, id, name, folder)
}

/// Start or adopt Herdr workspaces for sqlite project folders.
///
/// Git uses `worktree.open` (already_open keeps the same
/// `workspace_id`). Non-git uses `workspace.create --cwd` unless a
/// snapshot pane cwd is already present. Disk extras without
/// `open_workspace_id` are opened in place; they are not profiles until
/// that open succeeds. Does not create a linked worktree, does not
/// INSERT sqlite `profiles`, and does not run setup scripts. Herdr-down
/// is a no-op so listing still fail-closes to `profiles: []`.
pub fn adopt_existing_checkouts(
	runtime: &RuntimeRouter,
	db: &DbPool,
) -> Result<(), AppError> {
	adopt_existing_checkouts_with(runtime.herdr_worktrees_optional(), db)
}

pub(crate) fn adopt_existing_checkouts_with(
	worktrees: Option<&dyn HerdrWorktreeClient>,
	db: &DbPool,
) -> Result<(), AppError> {
	let Some(worktrees) = worktrees else {
		return Ok(());
	};
	let folders = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::project::list_all(conn)?
			.into_iter()
			.map(|project| project.folder)
			.collect::<Vec<_>>()
	};
	for folder in folders {
		adopt_project_folder(worktrees, &folder);
	}
	Ok(())
}

fn adopt_project_folder(worktrees: &dyn HerdrWorktreeClient, folder: &str) {
	let cwd = project_cwd(folder);
	match worktrees.worktree_list(Some(&cwd), None) {
		Ok(listed) => adopt_git_checkouts(worktrees, &cwd, folder, &listed),
		Err(err) if is_not_git_worktree(&err) => {
			adopt_nongit_folder(worktrees, &cwd, folder);
		}
		Err(_) => {}
	}
}

fn adopt_open_checkout(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	path: &Path,
) {
	if let Err(err) =
		crate::profile::open_existing_checkout(worktrees, cwd, path)
	{
		tracing::warn!(
			target: "herdr",
			path = %path.display(),
			"adopt worktree.open failed: {err}"
		);
	}
}

fn adopt_git_checkouts(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	folder: &str,
	listed: &[WorktreeListEntry],
) {
	adopt_open_checkout(worktrees, cwd, cwd);
	for entry in listed {
		if entry
			.workspace_id
			.as_deref()
			.is_some_and(|id| !id.is_empty())
		{
			continue;
		}
		if same_checkout_path(&entry.path, folder) {
			continue;
		}
		adopt_open_checkout(worktrees, cwd, Path::new(&entry.path));
	}
}

fn adopt_nongit_folder(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	folder: &str,
) {
	if !cwd.exists() {
		return;
	}
	match worktrees.session_snapshot() {
		Ok(snap)
			if !workspace_ids_from_snapshot_folder(&snap, folder)
				.is_empty() =>
		{
			return;
		}
		Ok(_) => {}
		Err(_) => return,
	}
	match worktrees
		.workspace_create(WorkspaceCreateRequest { cwd, label: None })
	{
		Ok(_) => {}
		Err(AppError::HerdrUncertainOutcome(err)) => {
			tracing::warn!(
				target: "herdr",
				cwd = %cwd.display(),
				"workspace.create uncertain; not retrying: {err}"
			);
		}
		Err(err) => {
			tracing::warn!(
				target: "herdr",
				cwd = %cwd.display(),
				"adopt workspace.create failed: {err}"
			);
		}
	}
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
	let project = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::project::find_by_id(conn, id)?
	};

	let session_ids = runtime
		.list_project_sessions(id)
		.unwrap_or_default()
		.into_iter()
		.map(|session| session.id)
		.collect::<Vec<_>>();
	for session_id in &session_ids {
		runtime.forget_project_session(session_id)?;
	}

	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
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
	use std::collections::HashSet;
	use std::path::Path;
	use std::sync::{Arc, Mutex};

	use super::*;
	use crate::runtime::HerdrStubAdapter;
	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::herdr::transport::{
		WorkspaceCreateResult, WorktreeCreateRequest, WorktreeCreateResult,
		WorktreeListEntry, WorktreeOpenResult, WorktreeRemoveResult,
	};
	use serde_json::json;

	struct ListCall {
		cwd: Option<String>,
		workspace_id: Option<String>,
	}

	struct OpenCall {
		cwd: String,
		path: String,
	}

	struct FakeListState {
		methods: Vec<String>,
		calls: Vec<ListCall>,
		opens: Vec<OpenCall>,
		listed: Vec<WorktreeListEntry>,
		scoped: HashMap<String, Vec<WorktreeListEntry>>,
		not_git: Vec<String>,
		snapshot: serde_json::Value,
		snapshot_error: Option<AppError>,
		list_error: Option<AppError>,
		failed_open_paths: HashSet<String>,
		next_workspace: u32,
	}

	struct FakeList {
		state: Mutex<FakeListState>,
	}

	impl FakeList {
		fn new(listed: Vec<WorktreeListEntry>) -> Arc<Self> {
			let next_workspace = next_workspace_from(&listed);
			Arc::new(Self {
				state: Mutex::new(FakeListState {
					methods: Vec::new(),
					calls: Vec::new(),
					opens: Vec::new(),
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
					failed_open_paths: HashSet::new(),
					next_workspace,
				}),
			})
		}

		fn set_scoped(&self, cwd: &str, listed: Vec<WorktreeListEntry>) {
			let mut state = self.state.lock().unwrap();
			state.next_workspace =
				state.next_workspace.max(next_workspace_from(&listed));
			state.scoped.insert(cwd.to_string(), listed);
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

		#[allow(dead_code)]
		fn fail_list(&self, err: AppError) {
			self.state.lock().unwrap().list_error = Some(err);
		}

		fn fail_open_path(&self, path: &str) {
			self.state
				.lock()
				.unwrap()
				.failed_open_paths
				.insert(path.to_string());
		}

		fn opens(&self) -> Vec<(String, String)> {
			self.state
				.lock()
				.unwrap()
				.opens
				.iter()
				.map(|call| (call.cwd.clone(), call.path.clone()))
				.collect()
		}
	}

	fn next_workspace_from(listed: &[WorktreeListEntry]) -> u32 {
		listed
			.iter()
			.filter_map(|entry| {
				entry
					.workspace_id
					.as_deref()?
					.strip_prefix('w')?
					.parse::<u32>()
					.ok()
			})
			.max()
			.unwrap_or(0)
			+ 1
	}

	fn alloc_workspace_id(state: &mut FakeListState) -> String {
		let id = format!("w{}", state.next_workspace);
		state.next_workspace += 1;
		id
	}

	fn apply_worktree_open(
		state: &mut FakeListState,
		cwd: &str,
		path: &str,
	) -> WorktreeOpenResult {
		let existing = state
			.listed
			.iter()
			.chain(state.scoped.values().flatten())
			.find(|entry| entry.path == path)
			.and_then(|entry| {
				entry
					.workspace_id
					.as_deref()
					.filter(|id| !id.is_empty())
					.map(str::to_string)
			});
		if let Some(workspace_id) = existing {
			return WorktreeOpenResult {
				workspace_id,
				already_open: true,
			};
		}
		let workspace_id = alloc_workspace_id(state);
		let mut found = false;
		for entry in state.listed.iter_mut() {
			if entry.path == path {
				entry.workspace_id = Some(workspace_id.clone());
				found = true;
			}
		}
		for entries in state.scoped.values_mut() {
			for entry in entries.iter_mut() {
				if entry.path == path {
					entry.workspace_id = Some(workspace_id.clone());
					found = true;
				}
			}
		}
		if !found {
			let entry = WorktreeListEntry {
				path: path.to_string(),
				branch: None,
				workspace_id: Some(workspace_id.clone()),
				is_linked_worktree: path != cwd,
			};
			state.listed.push(entry.clone());
			if let Some(entries) = state.scoped.get_mut(cwd) {
				entries.push(entry);
			}
		}
		WorktreeOpenResult {
			workspace_id,
			already_open: false,
		}
	}

	fn push_snapshot_pane(
		state: &mut FakeListState,
		workspace_id: &str,
		cwd: &str,
	) {
		let snap = if state.snapshot.get("type").and_then(Value::as_str)
			== Some("session_snapshot")
		{
			state.snapshot.get_mut("snapshot").unwrap()
		} else {
			&mut state.snapshot
		};
		if snap.get("panes").is_none() {
			snap.as_object_mut()
				.unwrap()
				.insert("panes".into(), json!([]));
		}
		snap.get_mut("panes")
			.unwrap()
			.as_array_mut()
			.unwrap()
			.push(json!({
				"pane_id": format!("{workspace_id}:p1"),
				"workspace_id": workspace_id,
				"cwd": cwd,
			}));
	}

	impl HerdrWorktreeClient for FakeList {
		fn worktree_create(
			&self,
			_request: WorktreeCreateRequest<'_>,
		) -> Result<WorktreeCreateResult, AppError> {
			self.state.lock().unwrap().methods.push("create".into());
			Err(AppError::TerminalError(
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
			cwd: &Path,
			path: &Path,
		) -> Result<WorktreeOpenResult, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("worktree.open".into());
			let cwd = cwd.to_string_lossy().into_owned();
			let path = path.to_string_lossy().into_owned();
			state.opens.push(OpenCall {
				cwd: cwd.clone(),
				path: path.clone(),
			});
			if state.failed_open_paths.contains(&path) {
				return Err(AppError::TerminalError(format!(
					"worktree.open failed: {path}"
				)));
			}
			Ok(apply_worktree_open(&mut state, &cwd, &path))
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
			Err(AppError::TerminalError(
				"path reconcile does not remove worktrees".into(),
			))
		}

		fn workspace_create(
			&self,
			request: WorkspaceCreateRequest<'_>,
		) -> Result<WorkspaceCreateResult, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("workspace.create".into());
			let cwd = request.cwd.to_string_lossy().into_owned();
			let workspace_id = alloc_workspace_id(&mut state);
			push_snapshot_pane(&mut state, &workspace_id, &cwd);
			Ok(WorkspaceCreateResult { workspace_id })
		}

		fn workspace_close(&self, _workspace_id: &str) -> Result<(), AppError> {
			self.state
				.lock()
				.unwrap()
				.methods
				.push("workspace.close".into());
			Err(AppError::TerminalError(
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

	fn herdr_router(worktrees: Option<Arc<FakeList>>) -> RuntimeRouter {
		let herdr = match worktrees {
			Some(client) => HerdrStubAdapter::with_worktree_client(client),
			None => HerdrStubAdapter::new(),
		};
		RuntimeRouter::new(herdr)
	}

	fn insert_catalog(
		conn: &mut SqliteConnection,
		folder: &str,
		_worktree_path: &str,
	) -> String {
		repo::project::insert(conn, "proj-1", "Project", folder)
			.expect("insert project")
			.id
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

	fn abs_folder(dir: &tempfile::TempDir) -> String {
		dir.path()
			.canonicalize()
			.expect("canonicalize")
			.to_string_lossy()
			.into_owned()
	}

	fn existing_dir() -> (tempfile::TempDir, String) {
		let dir = tempfile::tempdir().expect("folder");
		let folder = abs_folder(&dir);
		(dir, folder)
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
	fn data_flow_deletion_does_not_describe_sqlite_profiles_git_only() {
		let docs = include_str!("../../../../docs/data-flow.md");
		let deletion = docs
			.split("### Deletion Flow")
			.nth(1)
			.expect("Deletion Flow")
			.split("\n## ")
			.next()
			.unwrap();
		assert!(deletion.contains("worktree.remove"));
		assert!(deletion.contains("workspace.close"));
		assert!(deletion.contains("sqlite `profiles` is DROPped"));
		assert!(!deletion.contains("Delete profile record from DB"));
		assert!(
			!deletion.contains("Run `git worktree remove` and `git branch -D`")
		);
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
		assert!(!src.contains("reconcile_local_profile_checkout"));
		assert!(!src.contains("list_synthetic_local_profiles"));
		assert!(!src.contains("default-{"));
		assert!(!src.contains("set_worktree_path"));
		assert!(!src.contains("workspace.list"));
		let lib = include_str!("../../../src/lib.rs");
		assert!(!lib.contains("ensure_herdr_listener"));
		assert!(src.contains("herdr_worktrees_optional"));
	}

	#[test]
	fn herdr_list_ignores_sqlite_rows_and_disk_only_checkouts() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary("/repo", None, Some("main")),
			listed("/repo/disk", None, Some("wt/disk")),
		]);
		let runtime = herdr_router(Some(fake.clone()));

		let listed = list_with_runtime(&runtime, &db).expect("list");

		assert_eq!(listed[0].profiles.len(), 0);
		assert!(fake.methods().contains(&"worktree.list".to_string()));
		assert!(!fake.methods().iter().any(|m| m == "session.snapshot"));
		assert!(!fake.methods().iter().any(|m| m == "worktree.open"));
		assert!(!fake.methods().iter().any(|m| m == "workspace.create"));
		assert!(!fake.methods().iter().any(|m| m == "create"));
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
		let runtime = herdr_router(Some(fake.clone()));

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
		repo::project::insert(&mut conn, "proj-b", "B", "/repo-b").unwrap();
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
		let runtime = herdr_router(Some(fake));

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
		let runtime = herdr_router(Some(fake.clone()));

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
		let runtime = herdr_router(Some(fake));

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
		let runtime = herdr_router(Some(fake));

		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert!(listed[0].profiles.is_empty());
	}

	#[test]
	fn herdr_down_does_not_sqlite_fill_profiles() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let runtime = herdr_router(None);

		let listed = list_with_runtime(&runtime, &db).expect("catalog");

		assert_eq!(listed.len(), 1);
		assert_eq!(listed[0].id, "proj-1");
		assert!(listed[0].profiles.is_empty());
		assert!(runtime.herdr_worktrees_optional().is_none());
	}

	#[test]
	fn adopt_git_default_uses_worktree_open_and_keeps_already_open_id() {
		let (primary_dir, folder) = existing_dir();
		let (extra_dir, extra) = existing_dir();
		let mut conn = setup_db();
		insert_catalog(&mut conn, &folder, &folder);
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary(&folder, None, Some("main")),
			listed(&extra, None, Some("wt/disk")),
		]);
		let runtime = herdr_router(Some(fake.clone()));

		adopt_existing_checkouts(&runtime, &db).expect("adopt");
		let first = list_with_runtime(&runtime, &db).expect("list");
		assert_eq!(first[0].profiles.len(), 2);
		assert_eq!(first[0].profiles[0].id, "w1");
		assert!(first[0].profiles[0].is_default);
		assert_eq!(first[0].profiles[0].worktree_path, folder);
		assert_eq!(first[0].profiles[1].id, "w2");
		assert!(!first[0].profiles[1].is_default);
		assert_eq!(first[0].profiles[1].worktree_path, extra);
		assert_eq!(
			fake.opens(),
			vec![
				(folder.clone(), folder.clone()),
				(folder.clone(), extra.clone()),
			]
		);
		assert!(!fake.methods().iter().any(|m| m == "create"));
		assert!(!fake.methods().iter().any(|m| m == "workspace.create"));

		adopt_existing_checkouts(&runtime, &db).expect("re-adopt");
		let second = list_with_runtime(&runtime, &db).expect("list");
		assert_eq!(second[0].profiles[0].id, "w1");
		assert_eq!(second[0].profiles[1].id, "w2");
		assert_eq!(fake.opens().len(), 3);
		assert_eq!(
			fake.opens()[2],
			(folder.clone(), folder.clone()),
			"already_open default is opened again and keeps w1"
		);
		let _keep = (primary_dir, extra_dir);
	}

	#[test]
	fn adopt_skips_failed_extra_until_open_succeeds() {
		let (primary_dir, folder) = existing_dir();
		let (extra_dir, extra) = existing_dir();
		let mut conn = setup_db();
		insert_catalog(&mut conn, &folder, &folder);
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary(&folder, None, Some("main")),
			listed(&extra, None, Some("wt/disk")),
		]);
		fake.fail_open_path(&extra);
		let runtime = herdr_router(Some(fake.clone()));

		adopt_existing_checkouts(&runtime, &db).expect("adopt");
		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert_eq!(listed[0].profiles.len(), 1);
		assert_eq!(listed[0].profiles[0].id, "w1");
		assert!(listed[0].profiles[0].is_default);
		assert!(!listed[0]
			.profiles
			.iter()
			.any(|profile| profile.worktree_path == extra));
		assert!(fake
			.opens()
			.iter()
			.any(|call| call == &(folder.clone(), extra.clone())));
		let _keep = (primary_dir, extra_dir);
	}

	#[test]
	fn adopt_nongit_creates_once_and_keeps_snapshot_cwd() {
		let (dir, folder) = existing_dir();
		let mut conn = setup_db();
		insert_catalog(&mut conn, &folder, &folder);
		let db = pool_from(conn);
		let fake = FakeList::new(Vec::new());
		fake.fail_not_git(&folder);
		let runtime = herdr_router(Some(fake.clone()));

		adopt_existing_checkouts(&runtime, &db).expect("adopt");
		let first = list_with_runtime(&runtime, &db).expect("list");
		assert_eq!(first[0].profiles.len(), 1);
		assert_eq!(first[0].profiles[0].id, "w1");
		assert!(first[0].profiles[0].is_default);
		assert_eq!(first[0].profiles[0].worktree_path, folder);
		assert_eq!(
			fake.methods()
				.iter()
				.filter(|m| *m == "workspace.create")
				.count(),
			1
		);
		assert!(!fake.methods().iter().any(|m| m == "worktree.open"));
		assert!(!fake.methods().iter().any(|m| m == "create"));

		adopt_existing_checkouts(&runtime, &db).expect("re-adopt");
		let second = list_with_runtime(&runtime, &db).expect("list");
		assert_eq!(second[0].profiles[0].id, "w1");
		assert_eq!(
			fake.methods()
				.iter()
				.filter(|m| *m == "workspace.create")
				.count(),
			1,
			"already-present snapshot cwd must not create again"
		);
		let _keep = dir;
	}

	#[test]
	fn connect_time_adopt_opens_project_folder() {
		let (dir, folder) = existing_dir();
		let mut conn = setup_db();
		insert_catalog(&mut conn, &folder, &folder);
		let db = pool_from(conn);
		let fake = FakeList::new(vec![primary(&folder, None, Some("main"))]);
		let adapter = HerdrStubAdapter::with_worktree_client(fake.clone());

		adopt_existing_checkouts_with(adapter.worktrees().ok(), &db)
			.expect("connect-time adopt");
		let runtime = RuntimeRouter::new(adapter);
		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert_eq!(listed[0].profiles.len(), 1);
		assert_eq!(listed[0].profiles[0].id, "w1");
		assert!(listed[0].profiles[0].is_default);
		assert_eq!(fake.opens(), vec![(folder.clone(), folder)]);
		let _keep = dir;
	}

	#[test]
	fn adopt_git_dirty_folder_is_not_recreated() {
		let dir = init_git_repo("tracked.txt", "committed");
		let folder = abs_folder(&dir);
		std::fs::write(dir.path().join("dirty.txt"), "uncommitted")
			.expect("dirty file");
		let mut conn = setup_db();
		insert_catalog(&mut conn, &folder, &folder);
		let db = pool_from(conn);
		let fake = FakeList::new(vec![primary(&folder, None, Some("main"))]);
		let runtime = herdr_router(Some(fake.clone()));

		adopt_existing_checkouts(&runtime, &db).expect("adopt");
		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert_eq!(listed[0].profiles.len(), 1);
		assert!(listed[0].profiles[0].is_default);
		assert_eq!(
			std::fs::read_to_string(dir.path().join("tracked.txt")).unwrap(),
			"committed"
		);
		assert_eq!(
			std::fs::read_to_string(dir.path().join("dirty.txt")).unwrap(),
			"uncommitted"
		);
		assert!(!fake.methods().iter().any(|m| m == "create"));
		assert!(!fake.methods().iter().any(|m| m == "workspace.create"));
		assert_eq!(fake.opens(), vec![(folder.clone(), folder)]);
	}

	#[test]
	fn adopt_skips_nonexistent_path() {
		let missing = format!(
			"{}/2code-missing-adopt-{}",
			std::env::temp_dir().display(),
			Uuid::new_v4()
		);
		assert!(!Path::new(&missing).exists());
		let mut conn = setup_db();
		insert_catalog(&mut conn, &missing, &missing);
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary(&missing, None, Some("main")),
			listed(&format!("{missing}/disk"), None, Some("wt/disk")),
		]);
		let runtime = herdr_router(Some(fake.clone()));

		adopt_existing_checkouts(&runtime, &db).expect("adopt");
		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert!(listed[0].profiles.is_empty());
		assert!(fake.opens().is_empty());
		assert!(!fake.methods().iter().any(|m| m == "create"));
		assert!(!fake.methods().iter().any(|m| m == "workspace.create"));
	}

	#[test]
	fn adopt_herdr_down_does_not_sqlite_fill() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let runtime = herdr_router(None);

		adopt_existing_checkouts(&runtime, &db).expect("adopt");
		let listed = list_with_runtime(&runtime, &db).expect("catalog");
		assert!(listed[0].profiles.is_empty());
	}

	#[test]
	fn create_from_folder_then_adopt_lists_default_workspace() {
		let dir = tempfile::tempdir().expect("folder");
		let folder = dir
			.path()
			.canonicalize()
			.unwrap()
			.to_string_lossy()
			.into_owned();
		let mut conn = setup_db();
		let project = create_from_folder(&mut conn, "Proj", &folder).unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![primary(&folder, None, Some("main"))]);
		let runtime = herdr_router(Some(fake.clone()));

		adopt_existing_checkouts(&runtime, &db).expect("adopt");
		let listed = list_with_runtime(&runtime, &db).expect("list");
		let created = listed.iter().find(|item| item.id == project.id).unwrap();
		assert_eq!(created.profiles.len(), 1);
		assert_eq!(created.profiles[0].id, "w1");
		assert!(created.profiles[0].is_default);
		assert_eq!(fake.opens(), vec![(folder.clone(), folder)]);
	}

	#[test]
	fn herdr_list_overlays_notes_from_checkout_path_not_workspace_id() {
		let mut conn = setup_db();
		let project_id = insert_catalog(&mut conn, "/repo", "/repo");
		repo::checkout_notes::upsert(
			&mut conn,
			&project_id,
			"/repo",
			"hello notes",
		)
		.unwrap();
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary("/repo", Some("w1"), Some("main")),
			listed("/repo/linked", Some("w2"), Some("feat")),
		]);
		let runtime = herdr_router(Some(fake));

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
		let runtime = herdr_router(Some(fake.clone()));

		let path =
			reconcile_profile_checkout(&runtime, &db, "w2").expect("live path");
		assert_eq!(path, "/repo/linked");
		assert_eq!(fake.calls(), vec![(None, Some("w2".into()))]);
	}

	#[test]
	fn herdr_live_checkout_does_not_resolve_sqlite_uuid() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let fake =
			FakeList::new(vec![primary("/repo", Some("w1"), Some("main"))]);
		let runtime = herdr_router(Some(fake));

		let err = reconcile_profile_checkout(&runtime, &db, "default-proj-1")
			.expect_err("stale uuid");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");
	}

	#[test]
	fn production_router_new_selects_herdr_for_path_reconcile() {
		let runtime = RuntimeRouter::new(HerdrStubAdapter::new());
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
		let runtime = herdr_router(Some(fake));

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
		let runtime = herdr_router(Some(fake));

		let err = get_diff(&runtime, &db, "w-missing").expect_err("unknown");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");

		let down = herdr_router(None);
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
	fn herdr_watcher_targets_omit_leftover_sqlite_stale() {
		let mut conn = setup_db();
		insert_catalog(&mut conn, "/repo", "/stale");
		let db = pool_from(conn);
		let fake = FakeList::new(vec![
			primary("/repo", Some("w1"), Some("main")),
			listed("/listed", Some("w2"), Some("feat")),
		]);
		let runtime = herdr_router(Some(fake));

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
		let runtime = herdr_router(None);

		let listed = list_with_runtime(&runtime, &db).expect("list");
		assert!(listed[0].profiles.is_empty());
		let targets = crate::watcher::watcher_targets(&listed);

		assert_eq!(targets.len(), 1);
		assert_eq!(targets[0].root_path, "/repo");
		assert_eq!(targets[0].profile_id, None);
		assert!(!targets.iter().any(|target| target.root_path == "/stale"));
	}

	#[test]
	fn create_from_folder_does_not_insert_a_profile_row() {
		let dir = tempfile::tempdir().expect("folder");
		let mut conn = setup_db();
		create_from_folder(&mut conn, "Proj", &dir.path().to_string_lossy())
			.unwrap();
		#[derive(diesel::QueryableByName)]
		struct CountRow {
			#[diesel(sql_type = diesel::sql_types::BigInt)]
			count: i64,
		}
		let tables: CountRow = diesel::sql_query(
			"SELECT COUNT(*) AS count FROM sqlite_master \
			 WHERE type = 'table' AND name = 'profiles'",
		)
		.get_result(&mut conn)
		.unwrap();
		assert_eq!(tables.count, 0);
		let projects = repo::project::list_all(&mut conn).unwrap();
		assert_eq!(projects.len(), 1);
	}

	#[test]
	fn production_source_does_not_write_profiles_or_mappings() {
		let src = include_str!("project.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(!src.contains("insert_default"));
		assert!(!src.contains("sqlite_profile_id_for_checkout"));
		assert!(!src.contains("list_all_with_profiles"));
		assert!(!src.contains("bind_profile_workspace"));
		assert!(!src.contains("import_leftover_sqlite_profiles"));
		assert!(!src.contains("git::worktree"));
		assert!(!src.contains("setup_script"));
		assert!(!src.contains("INSERT INTO profiles"));
	}

	#[test]
	fn list_with_runtime_is_a_live_read_without_adopt() {
		let src = include_str!("project.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		let live = src
			.split("/// Start or adopt Herdr workspaces")
			.next()
			.unwrap();
		assert!(live.contains("list_with_runtime"));
		assert!(live.contains("list_herdr_derived"));
		assert!(!live.contains("worktree_open"));
		assert!(!live.contains("worktree.open"));
		assert!(!live.contains("workspace_create"));
		assert!(!live.contains("workspace.create"));
		let adopt = src
			.split("pub fn adopt_existing_checkouts")
			.nth(1)
			.unwrap()
			.split("pub fn delete(")
			.next()
			.unwrap();
		assert!(adopt.contains("open_existing_checkout"));
		assert!(adopt.contains("workspace_create"));
		assert!(!adopt.contains("worktree_create"));
		assert!(!adopt.contains("git::worktree"));
		assert!(!adopt.contains("setup_script"));
		assert!(!adopt.contains("insert_default"));
	}
}
