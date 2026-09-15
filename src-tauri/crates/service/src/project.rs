use std::path::Path;

use diesel::{Connection, SqliteConnection};
use uuid::Uuid;

use infra::db::DbPool;
use model::error::AppError;
use model::project::{
	GitBinaryPreview, GitCommit, GitDiffStats, GitPullRequestStatus, Project,
	ProjectSidebarLayoutUpdate, ProjectWithProfiles,
};
use model::project_group::ProjectGroup;
use model::runtime::HERDR_NAMESPACE;
use model::runtime_mapping::ProfileRuntimeMapping;

use crate::runtime::{HerdrWorktreeClient, RuntimeRouter};

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

/// Reconcile Herdr-mapped checkout caches, then return the catalog.
///
/// Unmapped profiles and Local-without-client keep `profiles.worktree_path`.
/// Unavailable mapped workspaces fail closed for that profile: the catalog
/// keeps the previous cache and does not fall back to `project.folder`,
/// another profile, or a label rematch. Does not start Herdr.
pub fn list_with_runtime(
	runtime: &RuntimeRouter,
	db: &DbPool,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	let mut projects = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::project::list_all_with_profiles(conn)?
	};

	for project in &mut projects {
		for profile in &mut project.profiles {
			match reconcile_profile_checkout(runtime, db, &profile.id) {
				Ok(path) => profile.worktree_path = path,
				Err(AppError::RuntimeMappingMissing(_))
				| Err(AppError::HerdrUncertainOutcome(_)) => {}
				Err(err) => return Err(err),
			}
		}
	}

	Ok(projects)
}

/// Resolve the checkout used by Git, filesystem, watcher, and
/// terminal-link consumers.
///
/// Mapped profiles in namespace `2code` use JSON `worktree.list` keyed by
/// `workspace_id`. The listed path is persisted into `profiles.worktree_path`
/// as a cache. Identity stays `workspace_id`. Local-unmapped profiles and
/// mapped profiles without an injected Herdr client use the DB cache.
pub fn reconcile_profile_checkout(
	runtime: &RuntimeRouter,
	db: &DbPool,
	profile_id: &str,
) -> Result<String, AppError> {
	let (cache, mapping) = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let profile = repo::profile::find_by_id(conn, profile_id)?;
		let mapping =
			match repo::runtime_mapping::find_profile_mapping(conn, profile_id)
			{
				Ok(mapping) => Some(mapping),
				Err(AppError::NotFound(_)) => None,
				Err(err) => return Err(err),
			};
		(profile.worktree_path, mapping)
	};

	let Some(mapping) = mapping else {
		return Ok(cache);
	};
	if mapping.namespace != HERDR_NAMESPACE {
		return Err(AppError::DbError(format!(
			"runtime mappings must use the {HERDR_NAMESPACE} namespace"
		)));
	}
	let Some(worktrees) = runtime.herdr_worktrees_optional() else {
		return Ok(cache);
	};

	persist_listed_checkout(worktrees, db, profile_id, &mapping, &cache)
}

fn persist_listed_checkout(
	worktrees: &dyn HerdrWorktreeClient,
	db: &DbPool,
	profile_id: &str,
	mapping: &ProfileRuntimeMapping,
	cache: &str,
) -> Result<String, AppError> {
	let listed =
		match worktrees.worktree_list(None, Some(&mapping.workspace_id)) {
			Ok(listed) => listed,
			Err(AppError::HerdrUncertainOutcome(_)) => {
				return Err(AppError::HerdrUncertainOutcome(
					"worktree.list is uncertain; not replaying".into(),
				));
			}
			Err(err) => return Err(err),
		};

	let matches: Vec<_> = listed
		.iter()
		.filter(|entry| {
			entry.workspace_id.as_deref() == Some(mapping.workspace_id.as_str())
		})
		.collect();
	let Some(entry) = matches.first() else {
		return Err(AppError::RuntimeMappingMissing(format!(
			"workspace {} is unavailable",
			mapping.workspace_id
		)));
	};
	if matches.len() != 1 || entry.path.is_empty() {
		return Err(AppError::RuntimeMappingMissing(format!(
			"workspace {} is unavailable",
			mapping.workspace_id
		)));
	}

	if entry.path != cache {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::profile::set_worktree_path(conn, profile_id, &entry.path)?;
	}

	Ok(entry.path.clone())
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
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<String, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::diff(&profile.worktree_path)
}

pub fn get_diff_stats(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<GitDiffStats, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::diff_stats(&profile.worktree_path)
}

pub fn get_log(
	conn: &mut SqliteConnection,
	profile_id: &str,
	limit: u32,
) -> Result<Vec<GitCommit>, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::log(&profile.worktree_path, limit)
}

pub fn get_commit_diff(
	conn: &mut SqliteConnection,
	profile_id: &str,
	commit_hash: &str,
) -> Result<String, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::show(&profile.worktree_path, commit_hash)
}

pub fn get_binary_preview(
	conn: &mut SqliteConnection,
	profile_id: &str,
	cache_root: &Path,
	path: &str,
	source: &str,
	commit_hash: Option<&str>,
) -> Result<Option<GitBinaryPreview>, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	let file_path = match source {
		"working_tree" => infra::git::read_worktree_file(
			&profile.worktree_path,
			cache_root,
			path,
		)?,
		"head" => infra::git::read_head_file(
			&profile.worktree_path,
			cache_root,
			path,
		)?,
		"commit" => {
			let commit_hash = commit_hash.ok_or_else(|| {
				AppError::GitError(
					"commit_hash is required for commit previews".into(),
				)
			})?;
			infra::git::read_commit_file(
				&profile.worktree_path,
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
				&profile.worktree_path,
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
	conn: &mut SqliteConnection,
	profile_id: &str,
	files: &[String],
	message: &str,
	body: Option<&str>,
) -> Result<String, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::commit(&profile.worktree_path, files, message, body)
}

pub fn discard_file_changes(
	conn: &mut SqliteConnection,
	profile_id: &str,
	paths: &[String],
) -> Result<(), AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::discard_changes(&profile.worktree_path, paths)
}

pub fn get_ahead_count(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<u32, AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	Ok(infra::git::ahead_count(&profile.worktree_path))
}

pub fn push(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<(), AppError> {
	let profile = repo::profile::find_by_id(conn, profile_id)?;
	infra::git::push(&profile.worktree_path)
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
	use std::path::Path;
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use infra::herdr::transport::{
		WorktreeCreateRequest, WorktreeCreateResult, WorktreeListEntry,
		WorktreeOpenResult, WorktreeRemoveResult,
	};
	use model::runtime::HERDR_NAMESPACE;

	use super::*;
	use crate::pty::{create_flush_senders, PtyContext};
	use crate::runtime::{HerdrStubAdapter, LocalAdapter, TerminalRuntime};
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
					list_error: None,
				}),
			})
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

		fn session_snapshot(&self) -> Result<serde_json::Value, AppError> {
			self.state
				.lock()
				.unwrap()
				.methods
				.push("session.snapshot".into());
			Err(AppError::PtyError(
				"session.snapshot is not part of path reconcile".into(),
			))
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
		RuntimeRouter::new(LocalAdapter::new(ctx), herdr)
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
		WorktreeListEntry {
			path: path.to_string(),
			branch: branch.map(str::to_string),
			workspace_id: workspace_id.map(str::to_string),
			is_linked_worktree: true,
		}
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
		assert!(!reconcile.contains("session_snapshot"));
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
	fn mapped_profile_persists_listed_path_for_workspace_id() {
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
			.expect("listed path");

		assert_eq!(path, "/listed");
		assert_eq!(fake.calls(), vec![(None, Some("w1".into()))]);
		assert_eq!(fake.methods(), vec!["worktree.list".to_string()]);
		let conn = &mut *db.lock().unwrap();
		assert_eq!(
			repo::profile::find_by_id(conn, &profile_id)
				.unwrap()
				.worktree_path,
			"/listed"
		);
	}

	#[test]
	fn mapped_unavailable_workspace_does_not_fall_back() {
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

		let err = reconcile_profile_checkout(&runtime, &db, &profile_id)
			.expect_err("unavailable");

		assert!(matches!(err, AppError::RuntimeMappingMissing(_)), "{err}");
		assert!(err.to_string().contains("w1"));
		assert_eq!(fake.methods(), vec!["worktree.list".to_string()]);
		let conn = &mut *db.lock().unwrap();
		assert_eq!(
			repo::profile::find_by_id(conn, &profile_id)
				.unwrap()
				.worktree_path,
			"/stale"
		);
	}

	#[test]
	fn uncertain_worktree_list_is_not_replayed() {
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

		let err = reconcile_profile_checkout(&runtime, &db, &profile_id)
			.expect_err("uncertain");

		assert!(matches!(err, AppError::HerdrUncertainOutcome(_)), "{err}");
		assert_eq!(fake.methods(), vec!["worktree.list".to_string()]);
		let conn = &mut *db.lock().unwrap();
		assert_eq!(
			repo::profile::find_by_id(conn, &profile_id)
				.unwrap()
				.worktree_path,
			"/stale"
		);
	}

	#[test]
	fn list_with_runtime_returns_reconciled_worktree_path() {
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
		assert_eq!(mapped.worktree_path, "/listed");
		assert_eq!(local.worktree_path, "/local-wt");
		assert_eq!(fake.calls(), vec![(None, Some("w1".into()))]);
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
	fn runtime_new_stays_local_for_path_reconcile() {
		let db = pool_from(setup_db());
		let runtime = local_router(&db, None);
		assert_eq!(
			runtime.selected_backend(),
			model::runtime::RuntimeBackend::Local
		);
	}
}
