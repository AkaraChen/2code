//! One-shot import of leftover sqlite extra profiles into Herdr.
//!
//! Uses JSON `worktree.open` only. Does not create git worktrees, write
//! `profile_runtime_mappings`, write `profiles.worktree_path`, bind
//! RuntimeRouter identities, or start from the explicit Local fallback.
//! Default / project-folder checkouts stay for #436 Task 10.

use std::path::{Path, PathBuf};

use diesel::SqliteConnection;
use infra::db::DbPool;
use infra::herdr::transport::{HerdrClient, WorktreeOpenResult};
use model::error::AppError;
use model::profile::Profile;

use crate::runtime::HerdrWorktreeClient;

/// Result of JSON `worktree.open`.
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

/// Typed `worktree.open` against a Herdr JSON client. Does not retry.
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

struct WorktreeClientOpener<'a> {
	client: &'a dyn HerdrWorktreeClient,
}

impl WorktreeOpener for WorktreeClientOpener<'_> {
	fn open(
		&mut self,
		cwd: &Path,
		path: &Path,
	) -> Result<OpenedWorktree, AppError> {
		self.client
			.worktree_open(cwd, path)
			.map(OpenedWorktree::from)
	}
}

/// What happened for one leftover extra during import.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdoptionAction {
	Bound,
	AlreadyBound,
	SkippedMissingCheckout,
	SkippedDefault,
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

/// Import leftover sqlite extras via `worktree.open`. Does not persist
/// mapping rows. Default checkouts are skipped (Task 10). Logs each
/// Failed outcome, including uncertain `worktree.open`.
pub fn import_leftover_sqlite_profiles(
	db: &DbPool,
	worktrees: &dyn HerdrWorktreeClient,
) -> Result<AdoptionReport, AppError> {
	let mut opener = WorktreeClientOpener { client: worktrees };
	let report = import_leftover_sqlite_profiles_with(db, &mut opener)?;
	log_failed_import_outcomes(&report);
	Ok(report)
}

/// Warn for Failed leftover extras. Does not fail the overall import.
pub fn log_failed_import_outcomes(report: &AdoptionReport) {
	for outcome in &report.outcomes {
		if outcome.action != AdoptionAction::Failed {
			continue;
		}
		tracing::warn!(
			target: "herdr",
			profile_id = %outcome.profile_id,
			"leftover sqlite extra import failed: {}",
			outcome.error.as_deref().unwrap_or("unknown")
		);
	}
}

/// Same import against a test opener. Not called from Local fallback.
pub fn import_leftover_sqlite_profiles_with(
	db: &DbPool,
	opener: &mut dyn WorktreeOpener,
) -> Result<AdoptionReport, AppError> {
	let targets = with_db(db, adoption_targets)?;
	let mut report = AdoptionReport::default();
	for target in targets {
		report.outcomes.push(import_one(opener, &target));
	}
	Ok(report)
}

fn import_one(
	opener: &mut dyn WorktreeOpener,
	target: &AdoptionTarget,
) -> ProfileAdoptionOutcome {
	let profile_id = target.profile.id.clone();
	if is_default_checkout(target) {
		return ProfileAdoptionOutcome {
			profile_id,
			workspace_id: None,
			action: AdoptionAction::SkippedDefault,
			error: None,
		};
	}
	let Some((cwd, checkout)) = resolve_canonical_paths(target) else {
		return ProfileAdoptionOutcome {
			profile_id,
			workspace_id: None,
			action: AdoptionAction::SkippedMissingCheckout,
			error: Some(format!(
				"missing checkout for profile {}",
				target.profile.id
			)),
		};
	};

	match opener.open(&cwd, &checkout) {
		Ok(opened) => ProfileAdoptionOutcome {
			profile_id,
			workspace_id: Some(opened.workspace_id),
			action: if opened.already_open {
				AdoptionAction::AlreadyBound
			} else {
				AdoptionAction::Bound
			},
			error: None,
		},
		Err(err) => failed_profile(profile_id, err.to_string()),
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

fn is_default_checkout(target: &AdoptionTarget) -> bool {
	if target.profile.is_default {
		return true;
	}
	let folder = Path::new(&target.project_folder);
	let checkout = Path::new(&target.profile.worktree_path);
	match (folder.canonicalize(), checkout.canonicalize()) {
		(Ok(left), Ok(right)) => left == right,
		_ => folder == checkout,
	}
}

fn resolve_canonical_paths(
	target: &AdoptionTarget,
) -> Option<(PathBuf, PathBuf)> {
	let cwd = Path::new(&target.project_folder).canonicalize().ok()?;
	let checkout = Path::new(&target.profile.worktree_path)
		.canonicalize()
		.ok()?;
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
	use model::runtime::{RuntimeBackend, HERDR_NAMESPACE};

	use super::*;
	use crate::runtime::{
		HerdrStubAdapter, RuntimeSelector, TerminalRuntime, SESSION_NAME,
	};

	struct FakeOpener {
		assigned: HashMap<PathBuf, String>,
		calls: Vec<(PathBuf, PathBuf)>,
		fail_on_call: Option<usize>,
		fail_err: Option<AppError>,
	}

	impl FakeOpener {
		fn new() -> Self {
			Self {
				assigned: HashMap::new(),
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

		fn worktree_list(&self) -> String {
			let output = Command::new("git")
				.args(["worktree", "list", "--porcelain"])
				.current_dir(&self.repo)
				.output()
				.unwrap();
			String::from_utf8_lossy(&output.stdout).into_owned()
		}
	}

	fn leftover_profile_mappings(db: &DbPool) -> Vec<String> {
		repo::runtime_mapping::list_profile_mappings(&mut db.lock().unwrap())
			.unwrap()
			.into_iter()
			.map(|row| format!("{}:{}", row.profile_id, row.workspace_id))
			.collect()
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

	#[test]
	fn interrupt_then_retry_does_not_duplicate_workspaces() {
		let fx = Fixture::new();
		let lists_before = fx.worktree_list();
		let mut opener = FakeOpener::new();
		opener.fail_on_call = Some(0);
		let first =
			import_leftover_sqlite_profiles_with(&fx.db, &mut opener).unwrap();
		assert_eq!(first.outcomes[0].action, AdoptionAction::SkippedDefault);
		assert_eq!(first.outcomes[0].profile_id, "def-1");
		assert_eq!(first.outcomes[1].action, AdoptionAction::Failed);
		assert_eq!(first.outcomes[1].profile_id, "wt-1");
		assert!(leftover_profile_mappings(&fx.db).is_empty());

		opener.fail_on_call = None;
		let retry =
			import_leftover_sqlite_profiles_with(&fx.db, &mut opener).unwrap();
		assert_eq!(retry.outcomes[0].action, AdoptionAction::SkippedDefault);
		assert_eq!(retry.outcomes[1].action, AdoptionAction::Bound);
		assert_eq!(retry.outcomes[1].workspace_id.as_deref(), Some("w1"));
		assert!(leftover_profile_mappings(&fx.db).is_empty());
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
		let report =
			import_leftover_sqlite_profiles_with(&fx.db, &mut opener).unwrap();
		assert_eq!(report.outcomes[0].action, AdoptionAction::SkippedDefault);
		assert_eq!(report.outcomes[1].action, AdoptionAction::Bound);
		let repo = fx.repo.canonicalize().unwrap();
		let wt = fx.worktree.canonicalize().unwrap();
		assert_eq!(opener.calls, vec![(repo, wt)]);
		assert_eq!(
			repo::profile::find_by_id(&mut fx.db.lock().unwrap(), "def-1")
				.unwrap()
				.worktree_path,
			slashed
		);
	}

	#[test]
	fn leftover_mapping_is_ignored_and_already_open_is_not_rewritten() {
		let fx = Fixture::new();
		{
			let mut conn = fx.db.lock().unwrap();
			repo::runtime_mapping::bind_profile_workspace(
				&mut conn,
				"wt-1",
				HERDR_NAMESPACE,
				"w-stale",
			)
			.unwrap();
			repo::pty::insert_session(
				&mut conn,
				&NewPtySessionRecord {
					id: "sess-1",
					profile_id: "wt-1",
					title: "Shell",
					shell: "/bin/sh",
					cwd: fx.worktree.to_str().unwrap(),
					cols: 80,
					rows: 24,
				},
			)
			.unwrap();
			repo::runtime_mapping::bind_session_pane(
				&mut conn,
				"sess-1",
				HERDR_NAMESPACE,
				"w-stale",
				"w-stale:p1",
			)
			.unwrap();
		}
		let mut opener = FakeOpener::new();
		let first =
			import_leftover_sqlite_profiles_with(&fx.db, &mut opener).unwrap();
		assert_eq!(first.outcomes[0].action, AdoptionAction::SkippedDefault);
		assert_eq!(first.outcomes[1].action, AdoptionAction::Bound);
		assert_eq!(first.outcomes[1].workspace_id.as_deref(), Some("w1"));
		assert_eq!(
			leftover_profile_mappings(&fx.db),
			vec!["wt-1:w-stale".to_string()]
		);
		assert!(repo::runtime_mapping::find_session_mapping(
			&mut fx.db.lock().unwrap(),
			"sess-1"
		)
		.is_ok());

		let second =
			import_leftover_sqlite_profiles_with(&fx.db, &mut opener).unwrap();
		assert_eq!(second.outcomes[1].action, AdoptionAction::AlreadyBound);
		assert_eq!(second.outcomes[1].workspace_id.as_deref(), Some("w1"));
		assert_eq!(opener.calls.len(), 2);
		assert_eq!(
			leftover_profile_mappings(&fx.db),
			vec!["wt-1:w-stale".to_string()]
		);
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
			import_leftover_sqlite_profiles_with(&fx.db, &mut opener).unwrap();
		assert_eq!(report.outcomes[0].action, AdoptionAction::SkippedDefault);
		assert_eq!(
			report.outcomes[1].action,
			AdoptionAction::SkippedMissingCheckout
		);
		assert!(!missing.exists());
		assert!(opener.calls.is_empty());
		assert!(leftover_profile_mappings(&fx.db).is_empty());
	}

	#[test]
	fn uncertain_open_is_not_retried() {
		let fx = Fixture::new();
		let mut opener = FakeOpener::new();
		opener.fail_on_call = Some(0);
		opener.fail_err =
			Some(AppError::HerdrUncertainOutcome("worktree.open".into()));
		let report =
			import_leftover_sqlite_profiles_with(&fx.db, &mut opener).unwrap();
		assert_eq!(report.outcomes[0].action, AdoptionAction::SkippedDefault);
		assert_eq!(report.outcomes[1].action, AdoptionAction::Failed);
		assert_eq!(opener.calls.len(), 1);
		assert!(leftover_profile_mappings(&fx.db).is_empty());
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
		import_leftover_sqlite_profiles_with(&fx.db, &mut opener).unwrap();
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
		assert!(leftover_profile_mappings(&fx.db).is_empty());
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
		assert!(!src.contains("bind_profile_workspace"));
		assert!(!src.contains("replace_profile_workspace"));
		assert!(!src.contains("unbind_profile_workspace"));
		assert!(!src.contains("find_profile_mapping"));
		assert!(!src.contains("set_worktree_path"));
		assert!(!src.contains("setup_script"));
		assert!(!src.contains("teardown_script"));
		assert!(!src.contains("ensure_herdr_listener"));
		assert!(src.contains("log_failed_import_outcomes"));
		assert!(src.contains("tracing::warn"));
		assert!(src.contains("AdoptionAction::Failed"));
		let lib = include_str!("../../../src/lib.rs");
		assert!(!lib.contains("adopt_existing_profiles"));
		assert!(!lib.contains("import_leftover_sqlite_profiles"));
		assert!(!lib.contains("runtime_adoption"));
		assert!(!lib.contains("ensure_herdr_listener"));
	}
}
