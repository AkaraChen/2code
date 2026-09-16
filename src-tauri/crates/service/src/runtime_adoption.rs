//! Adopt existing 2code checkouts into the dedicated Herdr namespace.
//!
//! Uses JSON `worktree.open` only. Does not create git worktrees, bind
//! RuntimeRouter identities, write session→pane rows, or start from
//! the explicit Local fallback.

use std::path::{Path, PathBuf};

use diesel::SqliteConnection;
use infra::db::DbPool;
use infra::herdr::transport::{HerdrClient, WorktreeOpenResult};
use model::error::AppError;
use model::profile::Profile;
use model::runtime::{RuntimeIdentityState, HERDR_NAMESPACE};

use crate::runtime_mapping::workspace_identity_state;
use crate::runtime_sync::RuntimeProjection;

/// Result of JSON `worktree.open` used for profile bind/replace.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenedWorktree {
	pub workspace_id: String,
	pub already_open: bool,
}

impl From<WorktreeOpenResult> for OpenedWorktree {
	fn from(value: WorktreeOpenResult) -> Self {
		Self {
			workspace_id: value.workspace_id,
			already_open: value.already_open,
		}
	}
}

/// Opens an existing checkout. Implementors must not create worktrees.
pub trait WorktreeOpener {
	fn open(
		&mut self,
		cwd: &Path,
		path: &Path,
	) -> Result<OpenedWorktree, AppError>;
}

/// Typed `worktree.open` against a Task 5 client. Does not retry.
pub struct HerdrClientOpener<'a> {
	client: &'a HerdrClient,
}

impl<'a> HerdrClientOpener<'a> {
	pub fn new(client: &'a HerdrClient) -> Self {
		Self { client }
	}
}

impl WorktreeOpener for HerdrClientOpener<'_> {
	fn open(
		&mut self,
		cwd: &Path,
		path: &Path,
	) -> Result<OpenedWorktree, AppError> {
		self.client
			.worktree_open(cwd, path)
			.map(OpenedWorktree::from)
			.map_err(AppError::from)
	}
}

/// What happened for one profile during adopt/resume.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdoptionAction {
	Bound,
	Replaced { from: String },
	AlreadyBound,
	SkippedMissingCheckout,
	Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfileAdoptionOutcome {
	pub profile_id: String,
	pub workspace_id: Option<String>,
	pub action: AdoptionAction,
	pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AdoptionReport {
	pub outcomes: Vec<ProfileAdoptionOutcome>,
}

struct AdoptionTarget {
	profile: Profile,
	project_folder: String,
}

/// Resume-safe adoption. Persists after each successful profile bind.
/// Not called from the explicit Local fallback.
pub fn adopt_existing_profiles(
	db: &DbPool,
	projection: &RuntimeProjection,
	opener: &mut dyn WorktreeOpener,
) -> Result<AdoptionReport, AppError> {
	let targets = with_db(db, adoption_targets)?;
	let mut report = AdoptionReport::default();
	for target in targets {
		report
			.outcomes
			.push(adopt_one(db, projection, opener, &target)?);
	}
	Ok(report)
}

fn adopt_one(
	db: &DbPool,
	projection: &RuntimeProjection,
	opener: &mut dyn WorktreeOpener,
	target: &AdoptionTarget,
) -> Result<ProfileAdoptionOutcome, AppError> {
	let profile_id = target.profile.id.clone();
	let Some((cwd, checkout)) = resolve_canonical_paths(target) else {
		return Ok(ProfileAdoptionOutcome {
			profile_id,
			workspace_id: None,
			action: AdoptionAction::SkippedMissingCheckout,
			error: Some(format!(
				"missing checkout for profile {}",
				target.profile.id
			)),
		});
	};

	let stored = with_db(db, |conn| {
		optional_profile_mapping(conn, &target.profile.id)
	})?;
	if let Some(mapping) = stored.as_ref() {
		if workspace_identity_state(mapping, projection)
			== RuntimeIdentityState::Bound
		{
			return Ok(ProfileAdoptionOutcome {
				profile_id,
				workspace_id: Some(mapping.workspace_id.clone()),
				action: AdoptionAction::AlreadyBound,
				error: None,
			});
		}
	}

	let opened = match open_resumable(opener, &cwd, &checkout) {
		Ok(opened) => opened,
		Err(err) => return Ok(failed_profile(profile_id, err.to_string())),
	};

	match with_db(db, |conn| {
		persist_workspace(conn, &target.profile.id, stored.as_ref(), &opened)
	}) {
		Ok(outcome) => Ok(outcome),
		Err(AppError::LockError) => Err(AppError::LockError),
		Err(err) => Ok(failed_profile(profile_id, err.to_string())),
	}
}

fn failed_profile(profile_id: String, error: String) -> ProfileAdoptionOutcome {
	ProfileAdoptionOutcome {
		profile_id,
		workspace_id: None,
		action: AdoptionAction::Failed,
		error: Some(error),
	}
}

fn persist_workspace(
	conn: &mut SqliteConnection,
	profile_id: &str,
	stored: Option<&model::runtime_mapping::ProfileRuntimeMapping>,
	opened: &OpenedWorktree,
) -> Result<ProfileAdoptionOutcome, AppError> {
	if let Some(existing) = stored {
		let replaced = repo::runtime_mapping::replace_profile_workspace(
			conn,
			profile_id,
			HERDR_NAMESPACE,
			&opened.workspace_id,
		)?;
		let action = if existing.workspace_id == replaced.workspace_id {
			AdoptionAction::AlreadyBound
		} else {
			AdoptionAction::Replaced {
				from: existing.workspace_id.clone(),
			}
		};
		Ok(ProfileAdoptionOutcome {
			profile_id: profile_id.to_string(),
			workspace_id: Some(replaced.workspace_id),
			action,
			error: None,
		})
	} else {
		let bound = repo::runtime_mapping::bind_profile_workspace(
			conn,
			profile_id,
			HERDR_NAMESPACE,
			&opened.workspace_id,
		)?;
		Ok(ProfileAdoptionOutcome {
			profile_id: profile_id.to_string(),
			workspace_id: Some(bound.workspace_id),
			action: AdoptionAction::Bound,
			error: None,
		})
	}
}

fn open_resumable(
	opener: &mut dyn WorktreeOpener,
	cwd: &Path,
	path: &Path,
) -> Result<OpenedWorktree, AppError> {
	match opener.open(cwd, path) {
		Ok(opened) => Ok(opened),
		Err(AppError::HerdrUncertainOutcome(_)) => opener.open(cwd, path),
		Err(err) => Err(err),
	}
}

fn resolve_canonical_paths(
	target: &AdoptionTarget,
) -> Option<(PathBuf, PathBuf)> {
	let cwd = Path::new(&target.project_folder).canonicalize().ok()?;
	let checkout = if target.profile.is_default {
		Path::new(&target.project_folder).canonicalize().ok()?
	} else {
		Path::new(&target.profile.worktree_path)
			.canonicalize()
			.ok()?
	};
	Some((cwd, checkout))
}

fn adoption_targets(
	conn: &mut SqliteConnection,
) -> Result<Vec<AdoptionTarget>, AppError> {
	let projects = repo::project::list_all_with_profiles(conn)?;
	let mut out = Vec::new();
	for project in projects {
		let folder = project.folder;
		let mut profiles = project.profiles;
		profiles.sort_by(|a, b| {
			b.is_default
				.cmp(&a.is_default)
				.then_with(|| a.created_at.cmp(&b.created_at))
				.then_with(|| a.id.cmp(&b.id))
		});
		for profile in profiles {
			out.push(AdoptionTarget {
				profile,
				project_folder: folder.clone(),
			});
		}
	}
	Ok(out)
}

fn optional_profile_mapping(
	conn: &mut SqliteConnection,
	profile_id: &str,
) -> Result<Option<model::runtime_mapping::ProfileRuntimeMapping>, AppError> {
	match repo::runtime_mapping::find_profile_mapping(conn, profile_id) {
		Ok(mapping) => Ok(Some(mapping)),
		Err(AppError::NotFound(_)) => Ok(None),
		Err(err) => Err(err),
	}
}

fn with_db<T>(
	db: &DbPool,
	f: impl FnOnce(&mut SqliteConnection) -> Result<T, AppError>,
) -> Result<T, AppError> {
	let mut conn = db.lock().map_err(|_| AppError::LockError)?;
	f(&mut conn)
}

#[cfg(test)]
mod tests {
	use std::collections::HashMap;
	use std::process::Command;
	use std::sync::{Arc, Mutex};

	use diesel::prelude::*;
	use diesel_migrations::MigrationHarness;
	use model::pty::NewPtySessionRecord;
	use model::runtime::RuntimeBackend;
	use serde_json::json;

	use super::*;
	use crate::runtime::{
		HerdrStubAdapter, RuntimeSelector, TerminalRuntime, SESSION_NAME,
	};

	struct FakeOpener {
		assigned: HashMap<PathBuf, String>,
		reopen_as: HashMap<PathBuf, String>,
		calls: Vec<(PathBuf, PathBuf)>,
		fail_on_call: Option<usize>,
		fail_err: Option<AppError>,
	}

	impl FakeOpener {
		fn new() -> Self {
			Self {
				assigned: HashMap::new(),
				reopen_as: HashMap::new(),
				calls: Vec::new(),
				fail_on_call: None,
				fail_err: None,
			}
		}
	}

	impl WorktreeOpener for FakeOpener {
		fn open(
			&mut self,
			cwd: &Path,
			path: &Path,
		) -> Result<OpenedWorktree, AppError> {
			self.calls.push((cwd.to_path_buf(), path.to_path_buf()));
			if self.fail_on_call == Some(self.calls.len() - 1) {
				return Err(self.fail_err.take().unwrap_or_else(|| {
					AppError::HerdrTransport("injected open failure".into())
				}));
			}
			if let Some(id) = self.reopen_as.get(path) {
				return Ok(OpenedWorktree {
					workspace_id: id.clone(),
					already_open: false,
				});
			}
			if let Some(id) = self.assigned.get(path) {
				return Ok(OpenedWorktree {
					workspace_id: id.clone(),
					already_open: true,
				});
			}
			let id = format!("w{}", self.assigned.len() + 1);
			self.assigned.insert(path.to_path_buf(), id.clone());
			Ok(OpenedWorktree {
				workspace_id: id,
				already_open: false,
			})
		}
	}

	struct Fixture {
		db: DbPool,
		root: tempfile::TempDir,
		repo: PathBuf,
		worktree: PathBuf,
	}

	impl Fixture {
		fn new() -> Self {
			let root = tempfile::tempdir().unwrap();
			let repo = root.path().join("repo");
			let worktree = root.path().join("wt");
			std::fs::create_dir_all(&repo).unwrap();
			init_git_repo(&repo);
			add_linked_worktree(&repo, &worktree);
			std::fs::write(repo.join("dirty-primary.txt"), "PRIMARY\n")
				.unwrap();
			std::fs::write(worktree.join("dirty-wt.txt"), "WORKTREE\n")
				.unwrap();
			let mut conn = SqliteConnection::establish(":memory:").unwrap();
			diesel::sql_query("PRAGMA foreign_keys=ON;")
				.execute(&mut conn)
				.ok();
			conn.run_pending_migrations(infra::db::MIGRATIONS)
				.expect("migrations");
			let folder = repo.to_string_lossy().into_owned();
			let wt = worktree.to_string_lossy().into_owned();
			repo::project::insert(&mut conn, "proj-1", "App", &folder).unwrap();
			repo::profile::insert_default(
				&mut conn, "def-1", "proj-1", "main", &folder,
			)
			.unwrap();
			repo::profile::insert(&mut conn, "wt-1", "proj-1", "feat", &wt)
				.unwrap();
			Self {
				db: Arc::new(Mutex::new(conn)),
				root,
				repo,
				worktree,
			}
		}

		fn mapping(&self, profile_id: &str) -> String {
			let mut conn = self.db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(&mut conn, profile_id)
				.unwrap()
				.workspace_id
		}

		fn worktree_list(&self) -> String {
			let output = Command::new("git")
				.args(["worktree", "list", "--porcelain"])
				.current_dir(&self.repo)
				.output()
				.unwrap();
			String::from_utf8_lossy(&output.stdout).into_owned()
		}

		fn snapshot(workspaces: serde_json::Value) -> RuntimeProjection {
			let mut projection = RuntimeProjection::new();
			projection
				.apply_snapshot(&json!({
					"type": "session_snapshot",
					"snapshot": {
						"workspaces": workspaces,
						"tabs": [],
						"panes": []
					}
				}))
				.unwrap();
			projection
		}
	}

	fn init_git_repo(repo: &Path) {
		assert!(git()
			.args(["init", "-b", "main"])
			.current_dir(repo)
			.status()
			.unwrap()
			.success());
		for (key, value) in [
			("user.email", "adoption@example.test"),
			("user.name", "Adoption"),
		] {
			assert!(git()
				.args(["config", key, value])
				.current_dir(repo)
				.status()
				.unwrap()
				.success());
		}
		std::fs::write(repo.join("README.md"), "# fixture\n").unwrap();
		assert!(git()
			.args(["add", "README.md"])
			.current_dir(repo)
			.status()
			.unwrap()
			.success());
		assert!(git()
			.args(["commit", "-m", "init"])
			.current_dir(repo)
			.status()
			.unwrap()
			.success());
	}

	fn add_linked_worktree(repo: &Path, worktree: &Path) {
		assert!(git()
			.args(["worktree", "add", "-b", "feat", worktree.to_str().unwrap()])
			.current_dir(repo)
			.status()
			.unwrap()
			.success());
	}

	fn git() -> Command {
		let mut cmd = Command::new("git");
		cmd.env("GIT_CONFIG_GLOBAL", "/dev/null")
			.env("GIT_CONFIG_SYSTEM", "/dev/null")
			.stdout(std::process::Stdio::null())
			.stderr(std::process::Stdio::null());
		cmd
	}

	fn empty_projection() -> RuntimeProjection {
		RuntimeProjection::new()
	}

	#[test]
	fn interrupt_then_retry_does_not_duplicate_workspaces() {
		let fx = Fixture::new();
		let lists_before = fx.worktree_list();
		let mut opener = FakeOpener::new();
		opener.fail_on_call = Some(1);
		let first =
			adopt_existing_profiles(&fx.db, &empty_projection(), &mut opener)
				.unwrap();
		assert_eq!(first.outcomes[0].action, AdoptionAction::Bound);
		assert_eq!(first.outcomes[0].profile_id, "def-1");
		assert_eq!(first.outcomes[1].action, AdoptionAction::Failed);
		assert_eq!(fx.mapping("def-1"), "w1");
		assert!(repo::runtime_mapping::find_profile_mapping(
			&mut fx.db.lock().unwrap(),
			"wt-1"
		)
		.is_err());

		opener.fail_on_call = None;
		let retry =
			adopt_existing_profiles(&fx.db, &empty_projection(), &mut opener)
				.unwrap();
		assert_eq!(retry.outcomes[0].workspace_id.as_deref(), Some("w1"));
		assert_eq!(retry.outcomes[1].action, AdoptionAction::Bound);
		assert_eq!(fx.mapping("def-1"), "w1");
		assert_eq!(fx.mapping("wt-1"), "w2");
		let mut ids = vec![fx.mapping("def-1"), fx.mapping("wt-1")];
		ids.sort();
		ids.dedup();
		assert_eq!(ids, vec!["w1".to_string(), "w2".to_string()]);
		assert_eq!(fx.worktree_list(), lists_before);
		assert_eq!(
			std::fs::read_to_string(fx.repo.join("dirty-primary.txt")).unwrap(),
			"PRIMARY\n"
		);
		assert_eq!(
			std::fs::read_to_string(fx.worktree.join("dirty-wt.txt")).unwrap(),
			"WORKTREE\n"
		);
	}

	#[test]
	fn default_and_worktree_paths_are_canonical_and_cwd_is_project() {
		let fx = Fixture::new();
		let slashed = format!("{}/", fx.repo.display());
		{
			let mut conn = fx.db.lock().unwrap();
			diesel::update(model::schema::profiles::table.find("def-1"))
				.set(model::schema::profiles::worktree_path.eq(&slashed))
				.execute(&mut *conn)
				.unwrap();
		}
		let mut opener = FakeOpener::new();
		adopt_existing_profiles(&fx.db, &empty_projection(), &mut opener)
			.unwrap();
		let repo = fx.repo.canonicalize().unwrap();
		let wt = fx.worktree.canonicalize().unwrap();
		assert_eq!(opener.calls[0], (repo.clone(), repo));
		assert_eq!(opener.calls[1], (fx.repo.canonicalize().unwrap(), wt));
		assert_eq!(
			repo::profile::find_by_id(&mut fx.db.lock().unwrap(), "def-1")
				.unwrap()
				.worktree_path,
			slashed
		);
	}

	#[test]
	fn bound_projection_skips_open_and_missing_id_is_replaced() {
		let fx = Fixture::new();
		let mut opener = FakeOpener::new();
		adopt_existing_profiles(&fx.db, &empty_projection(), &mut opener)
			.unwrap();
		let first_calls = opener.calls.len();
		let projection = Fixture::snapshot(json!([
			{ "workspace_id": "w1", "label": "Renamed" },
			{ "workspace_id": "w2", "label": "App" }
		]));
		adopt_existing_profiles(&fx.db, &projection, &mut opener).unwrap();
		assert_eq!(opener.calls.len(), first_calls);

		{
			let mut conn = fx.db.lock().unwrap();
			repo::pty::insert_session(
				&mut conn,
				&NewPtySessionRecord {
					id: "sess-1",
					profile_id: "def-1",
					title: "Shell",
					shell: "/bin/sh",
					cwd: fx.repo.to_str().unwrap(),
					cols: 80,
					rows: 24,
				},
			)
			.unwrap();
			repo::runtime_mapping::bind_session_pane(
				&mut conn,
				"sess-1",
				HERDR_NAMESPACE,
				"w1",
				"w1:p1",
			)
			.unwrap();
		}
		opener
			.reopen_as
			.insert(fx.repo.canonicalize().unwrap(), "w9".into());
		let other = Fixture::snapshot(json!([
			{ "workspace_id": "w8", "label": "App" }
		]));
		let report =
			adopt_existing_profiles(&fx.db, &other, &mut opener).unwrap();
		assert_eq!(
			report.outcomes[0].action,
			AdoptionAction::Replaced { from: "w1".into() }
		);
		assert_eq!(fx.mapping("def-1"), "w9");
		assert_ne!(fx.mapping("def-1"), "w8");
		assert!(repo::runtime_mapping::find_session_mapping(
			&mut fx.db.lock().unwrap(),
			"sess-1"
		)
		.is_err());
	}

	#[test]
	fn missing_checkout_continues_and_does_not_create_paths() {
		let fx = Fixture::new();
		let missing = fx.root.path().join("gone");
		{
			let mut conn = fx.db.lock().unwrap();
			diesel::update(model::schema::profiles::table.find("wt-1"))
				.set(
					model::schema::profiles::worktree_path
						.eq(missing.to_str().unwrap()),
				)
				.execute(&mut *conn)
				.unwrap();
		}
		let mut opener = FakeOpener::new();
		let report =
			adopt_existing_profiles(&fx.db, &empty_projection(), &mut opener)
				.unwrap();
		assert_eq!(report.outcomes[0].action, AdoptionAction::Bound);
		assert_eq!(
			report.outcomes[1].action,
			AdoptionAction::SkippedMissingCheckout
		);
		assert!(!missing.exists());
		assert_eq!(opener.calls.len(), 1);
	}

	#[test]
	fn uncertain_open_is_retried_then_bound() {
		let fx = Fixture::new();
		let mut opener = FakeOpener::new();
		opener.fail_on_call = Some(0);
		opener.fail_err =
			Some(AppError::HerdrUncertainOutcome("worktree.open".into()));
		let report =
			adopt_existing_profiles(&fx.db, &empty_projection(), &mut opener)
				.unwrap();
		assert_eq!(report.outcomes[0].action, AdoptionAction::Bound);
		assert_eq!(fx.mapping("def-1"), "w1");
		assert!(opener.calls.len() >= 2);
	}

	#[test]
	fn adoption_does_not_bind_sessions_or_router_or_herdr_runtime() {
		let fx = Fixture::new();
		{
			let mut conn = fx.db.lock().unwrap();
			repo::pty::insert_session(
				&mut conn,
				&NewPtySessionRecord {
					id: "sess-local",
					profile_id: "def-1",
					title: "Shell",
					shell: "/bin/sh",
					cwd: fx.repo.to_str().unwrap(),
					cols: 80,
					rows: 24,
				},
			)
			.unwrap();
		}
		let selector = RuntimeSelector::default();
		selector.bind("sess-local", RuntimeBackend::Local).unwrap();
		let herdr = HerdrStubAdapter::new();
		let mut opener = FakeOpener::new();
		adopt_existing_profiles(&fx.db, &empty_projection(), &mut opener)
			.unwrap();
		assert_eq!(
			selector.owner("sess-local").unwrap(),
			Some(RuntimeBackend::Local)
		);
		assert!(selector.bind("sess-local", RuntimeBackend::Herdr).is_err());
		assert!(herdr.recorded_ops().is_empty());
		assert!(herdr.write("sess-local", b"x").is_err());
		assert!(repo::runtime_mapping::find_session_mapping(
			&mut fx.db.lock().unwrap(),
			"sess-local"
		)
		.is_err());
		assert_eq!(SESSION_NAME, HERDR_NAMESPACE);
		assert_ne!(SESSION_NAME, "default");
	}

	#[test]
	fn production_adoption_is_open_only_and_off_local_startup() {
		let src = include_str!("runtime_adoption.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(src.contains("worktree.open"));
		assert!(!src.contains("worktree.create"));
		assert!(!src.contains("git worktree add"));
		assert!(!src.contains("git worktree remove"));
		assert!(!src.contains("workspace.create"));
		assert!(!src.contains("workspace.close"));
		assert!(!src.contains("worktree.remove"));
		assert!(!src.contains("pane.close"));
		assert!(!src.contains("pane.split"));
		assert!(!src.contains("server.stop"));
		assert!(!src.contains("bind_session_pane"));
		assert!(!src.contains("setup_script"));
		assert!(!src.contains("teardown_script"));
		assert!(!src.contains("ensure_herdr_listener"));
		let lib = include_str!("../../../src/lib.rs");
		assert!(!lib.contains("adopt_existing_profiles"));
		assert!(!lib.contains("runtime_adoption"));
		assert!(!lib.contains("ensure_herdr_listener"));
	}
}
