use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use diesel::SqliteConnection;
use infra::db::DbPool;
use infra::herdr::transport::{
	WorkspaceCreateRequest, WorkspaceCreateResult, WorktreeCreateRequest,
	WorktreeCreateResult,
};
use uuid::Uuid;

use model::error::AppError;
use model::profile::{Profile, ProfileDeleteCheck};
use model::project::GitDiffStats;
use crate::runtime::{HerdrWorktreeClient, RuntimeRouter};
use serde_json::Value;

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

fn load_project_config(
	project_folder: &str,
) -> Result<infra::config::ProjectConfig, AppError> {
	infra::config::load_project_config(project_folder)
}

pub fn create_with_db(
	db: &DbPool,
	project_id: &str,
	_branch_name: &str,
	_default_worktree_dir: Option<&str>,
) -> Result<Profile, AppError> {
	{
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::project::find_by_id(conn, project_id)?;
	}
	Err(AppError::PtyError(
		"Herdr runtime is required to create profiles".into(),
	))
}

pub fn create_with_runtime(
	runtime: &RuntimeRouter,
	db: &DbPool,
	project_id: &str,
	branch_name: &str,
	default_worktree_dir: Option<&str>,
) -> Result<Profile, AppError> {
	let worktrees = runtime.herdr_worktrees()?;
	create_herdr_with_db(
		worktrees,
		db,
		project_id,
		branch_name,
		default_worktree_dir,
	)
}

fn create_herdr_with_db(
	worktrees: &dyn HerdrWorktreeClient,
	db: &DbPool,
	project_id: &str,
	branch_name: &str,
	default_worktree_dir: Option<&str>,
) -> Result<Profile, AppError> {
	let auto_generated = branch_name.trim().is_empty();
	let project_folder = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::project::find_by_id(conn, project_id)?.folder
	};
	let project_config = load_project_config(&project_folder)?;
	let cwd = Path::new(&project_folder).canonicalize()?;
	match worktrees.worktree_list(Some(&cwd), None) {
		Ok(listed) => create_herdr_git(
			worktrees,
			project_id,
			&project_folder,
			&cwd,
			&project_config,
			default_worktree_dir,
			&listed,
			branch_name,
			auto_generated,
		),
		Err(err) if is_not_git_worktree(&err) => create_herdr_nongit(
			worktrees,
			project_id,
			&cwd,
			&project_config,
			branch_name,
			auto_generated,
		),
		Err(err) => Err(err),
	}
}

fn create_herdr_nongit(
	worktrees: &dyn HerdrWorktreeClient,
	project_id: &str,
	cwd: &Path,
	project_config: &infra::config::ProjectConfig,
	branch_name: &str,
	auto_generated: bool,
) -> Result<Profile, AppError> {
	let label = if auto_generated {
		None
	} else {
		let sanitized = sanitize_branch_name(branch_name);
		if sanitized.is_empty() {
			return Err(AppError::GitError("Invalid branch name".to_string()));
		}
		Some(sanitized)
	};
	let before_ids = match worktrees.session_snapshot() {
		Ok(snapshot) => Some(snapshot_workspace_ids_for_cwd(&snapshot, cwd)),
		Err(_) => None,
	};
	let created = match worktrees.workspace_create(WorkspaceCreateRequest {
		cwd,
		label: label.as_deref(),
	}) {
		Ok(created) => created,
		Err(AppError::HerdrUncertainOutcome(_)) => {
			let Some(before_ids) = before_ids else {
				return Err(AppError::HerdrUncertainOutcome(
					"workspace.create outcome is uncertain; not replaying"
						.into(),
				));
			};
			recover_nongit_workspace(worktrees, cwd, &before_ids)?
		}
		Err(err) => return Err(err),
	};
	let path = cwd.to_string_lossy().into_owned();
	let profile = herdr_profile(
		project_id,
		&created.workspace_id,
		label.unwrap_or_default(),
		&path,
		false,
	);
	infra::config::execute_scripts(&project_config.setup_script, cwd);
	Ok(profile)
}

fn recover_nongit_workspace(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	before_ids: &[String],
) -> Result<WorkspaceCreateResult, AppError> {
	let snapshot = worktrees.session_snapshot().map_err(|_| {
		AppError::HerdrUncertainOutcome(
			"workspace.create outcome is uncertain; not replaying".into(),
		)
	})?;
	let mut ids: Vec<String> = snapshot_workspace_ids_for_cwd(&snapshot, cwd)
		.into_iter()
		.filter(|id| !before_ids.iter().any(|before| before == id))
		.collect();
	ids.sort();
	ids.into_iter()
		.next_back()
		.map(|workspace_id| WorkspaceCreateResult { workspace_id })
		.ok_or_else(|| {
			AppError::HerdrUncertainOutcome(
				"workspace.create outcome is uncertain; not replaying".into(),
			)
		})
}

fn snapshot_workspace_ids_for_cwd(snapshot: &Value, cwd: &Path) -> Vec<String> {
	let snap = if snapshot.get("type").and_then(Value::as_str)
		== Some("session_snapshot")
	{
		snapshot.get("snapshot").unwrap_or(snapshot)
	} else {
		snapshot
	};
	let mut ids = Vec::new();
	let Some(panes) = snap.get("panes").and_then(Value::as_array) else {
		return ids;
	};
	for pane in panes {
		let Some(workspace_id) = pane
			.get("workspace_id")
			.and_then(Value::as_str)
			.filter(|id| !id.is_empty())
		else {
			continue;
		};
		let Some(pane_cwd) = pane
			.get("cwd")
			.and_then(Value::as_str)
			.or_else(|| pane.get("foreground_cwd").and_then(Value::as_str))
		else {
			continue;
		};
		if same_worktree_path(Path::new(pane_cwd), cwd)
			&& !ids.iter().any(|id| id == workspace_id)
		{
			ids.push(workspace_id.to_string());
		}
	}
	ids
}

fn create_herdr_git(
	worktrees: &dyn HerdrWorktreeClient,
	project_id: &str,
	project_folder: &str,
	cwd: &Path,
	project_config: &infra::config::ProjectConfig,
	default_worktree_dir: Option<&str>,
	listed: &[infra::herdr::transport::WorktreeListEntry],
	branch_name: &str,
	auto_generated: bool,
) -> Result<Profile, AppError> {
	let parent_workspace_id = live_parent_workspace_id(listed, cwd);
	let mut existing_branches: Vec<String> = listed
		.iter()
		.filter_map(|entry| entry.branch.clone())
		.collect();

	let mut branch_name = if auto_generated {
		generate_auto_branch_name_from(&existing_branches)?
	} else {
		let sanitized = sanitize_branch_name(branch_name);
		if sanitized.is_empty() {
			return Err(AppError::GitError("Invalid branch name".to_string()));
		}
		sanitized
	};

	let attempts = if auto_generated { 5 } else { 1 };
	let mut last_conflict = None;
	for _ in 0..attempts {
		let dir_key = herdr_dir_key(project_id, &branch_name);
		match create_herdr_git_once(
			worktrees,
			project_id,
			project_folder,
			cwd,
			parent_workspace_id.as_deref(),
			project_config,
			default_worktree_dir,
			&dir_key,
			&branch_name,
		) {
			Ok(profile) => return Ok(profile),
			Err(err) if auto_generated && is_branch_conflict(&err) => {
				existing_branches.push(branch_name.clone());
				last_conflict = Some(err);
				branch_name =
					generate_auto_branch_name_from(&existing_branches)?;
			}
			Err(err) => return Err(err),
		}
	}
	Err(last_conflict.unwrap_or_else(|| {
		AppError::GitError(
			"Failed to auto-generate a unique branch name".to_string(),
		)
	}))
}

fn live_parent_workspace_id(
	listed: &[infra::herdr::transport::WorktreeListEntry],
	cwd: &Path,
) -> Option<String> {
	listed.iter().find_map(|entry| {
		if entry.is_linked_worktree {
			return None;
		}
		let workspace_id =
			entry.workspace_id.as_deref().filter(|id| !id.is_empty())?;
		same_worktree_path(Path::new(&entry.path), cwd)
			.then(|| workspace_id.to_string())
	})
}

fn is_branch_conflict(err: &AppError) -> bool {
	match err {
		AppError::GitError(message) => message.contains("already exists"),
		AppError::HerdrTransport(message) => {
			message.contains("worktree_create_failed")
				|| message.contains("already exists")
		}
		_ => false,
	}
}

fn create_herdr_git_once(
	worktrees: &dyn HerdrWorktreeClient,
	project_id: &str,
	project_folder: &str,
	cwd: &Path,
	parent_workspace_id: Option<&str>,
	project_config: &infra::config::ProjectConfig,
	default_worktree_dir: Option<&str>,
	dir_key: &str,
	branch_name: &str,
) -> Result<Profile, AppError> {
	let worktree_base = resolve_worktree_base(
		project_folder,
		project_config.worktree_dir.as_deref(),
		default_worktree_dir,
	)?;
	std::fs::create_dir_all(&worktree_base)?;
	let worktree_base = worktree_base.canonicalize()?;
	let intended_path = build_worktree_path(
		&worktree_base,
		project_folder,
		branch_name,
		dir_key,
	);

	if let Some(created) = checkout_at_listed_path(
		worktrees,
		cwd,
		parent_workspace_id,
		&intended_path,
		false,
	)? {
		return Ok(herdr_profile_from_create(project_id, branch_name, created));
	}

	if infra::git::local_branch_exists(project_folder, branch_name)?
		|| linked_worktree_for_branch(
			worktrees,
			cwd,
			parent_workspace_id,
			branch_name,
			Some(&intended_path),
		)? {
		return Err(AppError::GitError(format!(
			"Branch '{branch_name}' already exists"
		)));
	}

	let created = match worktrees.worktree_create(WorktreeCreateRequest {
		branch: branch_name,
		path: Some(&intended_path),
		cwd: parent_workspace_id.is_none().then_some(cwd),
		workspace_id: parent_workspace_id,
		label: Some(branch_name),
	}) {
		Ok(created) => created,
		Err(AppError::HerdrUncertainOutcome(_)) => checkout_at_listed_path(
			worktrees,
			cwd,
			parent_workspace_id,
			&intended_path,
			true,
		)?
		.ok_or_else(|| {
			AppError::HerdrUncertainOutcome(
				"worktree.create outcome is uncertain; not replaying".into(),
			)
		})?,
		Err(err) => return Err(err),
	};

	let profile = herdr_profile_from_create(project_id, branch_name, created);
	infra::config::execute_scripts(
		&project_config.setup_script,
		Path::new(&profile.worktree_path),
	);
	Ok(profile)
}

fn herdr_profile_from_create(
	project_id: &str,
	branch_name: &str,
	created: WorktreeCreateResult,
) -> Profile {
	herdr_profile(
		project_id,
		&created.workspace_id,
		branch_name.to_string(),
		&created.path,
		false,
	)
}

fn herdr_profile(
	project_id: &str,
	workspace_id: &str,
	branch_name: String,
	worktree_path: &str,
	is_default: bool,
) -> Profile {
	Profile {
		id: workspace_id.to_string(),
		project_id: project_id.to_string(),
		branch_name,
		worktree_path: worktree_path.to_string(),
		created_at: String::new(),
		is_default,
		notes: String::new(),
	}
}

fn is_not_git_worktree(err: &AppError) -> bool {
	match err {
		AppError::HerdrTransport(message) => {
			message.contains("not_git_worktree")
		}
		_ => false,
	}
}

fn herdr_dir_key(project_id: &str, branch_name: &str) -> String {
	Uuid::new_v5(
		&Uuid::NAMESPACE_URL,
		format!("2code-profile:{project_id}:{branch_name}").as_bytes(),
	)
	.to_string()
}

fn linked_worktree_for_branch(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	parent_workspace_id: Option<&str>,
	branch_name: &str,
	except_path: Option<&Path>,
) -> Result<bool, AppError> {
	let listed = list_worktrees(worktrees, cwd, parent_workspace_id)?;
	Ok(listed.iter().any(|entry| {
		entry.is_linked_worktree
			&& entry.branch.as_deref() == Some(branch_name)
			&& except_path.is_none_or(|intended| {
				!same_worktree_path(Path::new(&entry.path), intended)
			})
	}))
}

fn list_worktrees(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	parent_workspace_id: Option<&str>,
) -> Result<Vec<infra::herdr::transport::WorktreeListEntry>, AppError> {
	worktrees.worktree_list(
		parent_workspace_id.is_none().then_some(cwd),
		parent_workspace_id,
	)
}

/// Resolve a Herdr checkout by absolute path only. Unique-branch matching is
/// forbidden so a Local profile cannot bind someone else's workspace.
/// `open_unlisted` is only for recovering our own `worktree.create`.
fn checkout_at_listed_path(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	parent_workspace_id: Option<&str>,
	intended_path: &Path,
	open_unlisted: bool,
) -> Result<Option<WorktreeCreateResult>, AppError> {
	let listed = match list_worktrees(worktrees, cwd, parent_workspace_id) {
		Ok(listed) => listed,
		Err(AppError::HerdrUncertainOutcome(_)) if open_unlisted => Vec::new(),
		Err(err) => return Err(err),
	};
	if let Some(created) = match_listed_worktree(&listed, intended_path) {
		if created.workspace_id.is_empty() {
			return open_existing_checkout(
				worktrees,
				cwd,
				Path::new(&created.path),
			);
		}
		return Ok(Some(created));
	}
	if open_unlisted {
		return open_existing_checkout(worktrees, cwd, intended_path);
	}
	Ok(None)
}

fn same_worktree_path(left: &Path, right: &Path) -> bool {
	if left == right {
		return true;
	}
	match (left.canonicalize(), right.canonicalize()) {
		(Ok(a), Ok(b)) => a == b,
		_ => false,
	}
}

fn match_listed_worktree(
	listed: &[infra::herdr::transport::WorktreeListEntry],
	intended: &Path,
) -> Option<WorktreeCreateResult> {
	listed
		.iter()
		.find(|entry| same_worktree_path(Path::new(&entry.path), intended))
		.map(listed_entry_to_created)
}

fn listed_entry_to_created(
	entry: &infra::herdr::transport::WorktreeListEntry,
) -> WorktreeCreateResult {
	WorktreeCreateResult {
		workspace_id: entry.workspace_id.clone().unwrap_or_default(),
		path: entry.path.clone(),
	}
}

fn open_existing_checkout(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	path: &Path,
) -> Result<Option<WorktreeCreateResult>, AppError> {
	if !path.exists() {
		return Ok(None);
	}
	match worktrees.worktree_open(cwd, path) {
		Ok(opened) => Ok(Some(WorktreeCreateResult {
			workspace_id: opened.workspace_id,
			path: path.to_string_lossy().into_owned(),
		})),
		Err(AppError::HerdrUncertainOutcome(_)) => Ok(None),
		Err(err) => Err(err),
	}
}

pub fn create_with_default_worktree_dir(
	conn: &mut SqliteConnection,
	project_id: &str,
	_branch_name: &str,
	_default_worktree_dir: Option<&str>,
) -> Result<Profile, AppError> {
	repo::project::find_by_id(conn, project_id)?;
	Err(AppError::PtyError(
		"Herdr runtime is required to create profiles".into(),
	))
}

pub fn create(
	conn: &mut SqliteConnection,
	project_id: &str,
	branch_name: &str,
) -> Result<Profile, AppError> {
	create_with_default_worktree_dir(conn, project_id, branch_name, None)
}

fn working_tree_is_dirty(path: &str) -> Result<bool, AppError> {
	if !Path::new(path).exists() {
		return Ok(false);
	}
	match infra::git::diff_stats(path) {
		Ok(stats) => Ok(stats.files_changed > 0
			|| stats.insertions > 0
			|| stats.deletions > 0),
		Err(AppError::GitError(_)) => Ok(false),
		Err(err) => Err(err),
	}
}

fn is_dirty_worktree_error(err: &AppError) -> bool {
	match err {
		AppError::HerdrTransport(message) => {
			message.contains("dirty_worktree_requires_force")
		}
		_ => false,
	}
}

fn refuse_primary_checkout() -> AppError {
	AppError::GitError(
		"refusing to worktree.remove a default/primary checkout".into(),
	)
}

fn listed_workspace<'a>(
	listed: &'a [infra::herdr::transport::WorktreeListEntry],
	workspace_id: &str,
) -> Option<&'a infra::herdr::transport::WorktreeListEntry> {
	listed
		.iter()
		.find(|entry| entry.workspace_id.as_deref() == Some(workspace_id))
}

fn herdr_workspace_listed_absent(
	worktrees: &dyn HerdrWorktreeClient,
	workspace_id: &str,
	checkout: &str,
) -> Result<bool, AppError> {
	match worktrees.worktree_list(None, Some(workspace_id)) {
		Ok(listed) => Ok(listed_workspace(&listed, workspace_id).is_none()),
		Err(err) if is_not_git_worktree(&err) => Ok(true),
		Err(AppError::HerdrUncertainOutcome(_)) => {
			Ok(!Path::new(checkout).exists())
		}
		Err(err) => Err(err),
	}
}

fn git_common_dir(path: &str) -> Option<PathBuf> {
	if !Path::new(path).exists() {
		return None;
	}
	let output = infra::no_window::command_without_windows_console("git")
		.args(["rev-parse", "--git-common-dir"])
		.current_dir(path)
		.output()
		.ok()?;
	if !output.status.success() {
		return None;
	}
	let raw = String::from_utf8_lossy(&output.stdout);
	let trimmed = raw.trim();
	if trimmed.is_empty() {
		return None;
	}
	let resolved = Path::new(trimmed);
	if resolved.is_absolute() {
		resolved.canonicalize().ok()
	} else {
		Path::new(path).join(resolved).canonicalize().ok()
	}
}

fn git_repo_folder_for_checkout(checkout: &str) -> Option<String> {
	let common = git_common_dir(checkout)?;
	let folder = if common.file_name().is_some_and(|name| name == ".git") {
		common.parent()?.to_path_buf()
	} else {
		common
	};
	folder.to_str().map(str::to_string)
}

/// Repo for `git branch -D` after Herdr `worktree.remove`. Listed checkout
/// first; `projects.folder` only as a live path join, never sqlite `profiles`.
fn repo_folder_for_linked_checkout(
	db: &DbPool,
	checkout: &str,
) -> Option<String> {
	if let Some(repo) = git_repo_folder_for_checkout(checkout) {
		return Some(repo);
	}
	let projects = {
		let mut conn = db.lock().ok()?;
		repo::project::list_all(&mut conn).ok()?
	};
	let checkout_path = Path::new(checkout);
	let checkout_common = git_common_dir(checkout);
	projects.into_iter().find_map(|project| {
		if same_worktree_path(Path::new(&project.folder), checkout_path) {
			return Some(project.folder);
		}
		let project_common = git_common_dir(&project.folder)?;
		checkout_common
			.as_ref()
			.filter(|common| *common == &project_common)
			.map(|_| project.folder)
	})
}

pub fn delete_with_db(_db: &DbPool, id: &str) -> Result<(), AppError> {
	let _ = id;
	Err(AppError::PtyError(
		"Herdr runtime is required to delete profiles".into(),
	))
}

pub fn delete_with_runtime(
	runtime: &RuntimeRouter,
	db: &infra::db::DbPool,
	id: &str,
) -> Result<(), AppError> {
	delete_with_runtime_force(runtime, db, id, None)
}

fn delete_with_runtime_force(
	runtime: &RuntimeRouter,
	db: &infra::db::DbPool,
	id: &str,
	force: Option<bool>,
) -> Result<(), AppError> {
	delete_herdr_identity(runtime, db, id, force)
}

fn delete_herdr_identity(
	runtime: &RuntimeRouter,
	db: &DbPool,
	id: &str,
	force: Option<bool>,
) -> Result<(), AppError> {
	let worktrees = runtime.herdr_worktrees()?;
	match worktrees.worktree_list(None, Some(id)) {
		Ok(listed) => {
			delete_herdr_git_workspace(worktrees, db, id, &listed, force)
		}
		Err(err) if is_not_git_worktree(&err) => {
			delete_herdr_nongit_workspace(worktrees, id)
		}
		Err(AppError::NotFound(_)) => Ok(()),
		Err(AppError::HerdrUncertainOutcome(_)) => {
			Err(AppError::HerdrUncertainOutcome(
				"worktree.list is uncertain; not removing".into(),
			))
		}
		Err(err) => Err(err),
	}
}

fn delete_herdr_git_workspace(
	worktrees: &dyn HerdrWorktreeClient,
	db: &DbPool,
	workspace_id: &str,
	listed: &[infra::herdr::transport::WorktreeListEntry],
	force: Option<bool>,
) -> Result<(), AppError> {
	let Some(entry) = listed_workspace(listed, workspace_id) else {
		return Ok(());
	};
	if !entry.is_linked_worktree {
		return Err(refuse_primary_checkout());
	}

	let checkout = entry.path.clone();
	let checkout_exists = Path::new(&checkout).exists();
	let branch_name = entry
		.branch
		.clone()
		.filter(|branch| !branch.is_empty())
		.or_else(|| {
			infra::git::worktree_current_branch(&checkout)
				.ok()
				.flatten()
		})
		.unwrap_or_default();
	let repo = repo_folder_for_linked_checkout(db, &checkout);
	run_teardown_script_at(&checkout);
	let force = match force {
		Some(force) => force,
		None => working_tree_is_dirty(&checkout)?,
	};
	match worktrees.worktree_remove(workspace_id, force) {
		Ok(_) => {}
		Err(err) if is_dirty_worktree_error(&err) => return Err(err),
		Err(AppError::HerdrUncertainOutcome(_)) => {
			if !herdr_workspace_listed_absent(
				worktrees,
				workspace_id,
				&checkout,
			)? {
				return Err(AppError::HerdrUncertainOutcome(format!(
					"worktree.remove {workspace_id} is uncertain; not replaying"
				)));
			}
		}
		Err(err) => return Err(err),
	}
	if Path::new(&checkout).exists() && checkout_exists {
		return Err(AppError::GitError(
			"worktree.remove left the checkout in place; not using git worktree remove".into(),
		));
	}
	if let Some(repo) = repo.filter(|folder| !folder.is_empty()) {
		if !branch_name.is_empty() {
			infra::git::branch_delete(&repo, &branch_name)?;
		}
	}
	Ok(())
}

fn delete_herdr_nongit_workspace(
	worktrees: &dyn HerdrWorktreeClient,
	workspace_id: &str,
) -> Result<(), AppError> {
	let snapshot = worktrees.session_snapshot()?;
	let cwd = nongit_workspace_cwd(&snapshot, workspace_id);
	let Some(cwd) = cwd else {
		return Ok(());
	};
	let mut siblings =
		snapshot_workspace_ids_for_cwd(&snapshot, Path::new(&cwd));
	siblings.sort();
	if siblings.len() <= 1
		|| siblings.first().map(String::as_str) == Some(workspace_id)
	{
		return Err(refuse_primary_checkout());
	}
	match worktrees.workspace_close(workspace_id) {
		Ok(()) => Ok(()),
		Err(AppError::HerdrUncertainOutcome(_)) => {
			let again = worktrees.session_snapshot().ok();
			let still_there = again.as_ref().is_some_and(|snap| {
				nongit_workspace_cwd(snap, workspace_id).is_some()
			});
			if still_there {
				Err(AppError::HerdrUncertainOutcome(format!(
					"workspace.close {workspace_id} is uncertain; not replaying"
				)))
			} else {
				Ok(())
			}
		}
		Err(err) => Err(err),
	}
}

fn nongit_workspace_cwd(
	snapshot: &Value,
	workspace_id: &str,
) -> Option<String> {
	let snap = if snapshot.get("type").and_then(Value::as_str)
		== Some("session_snapshot")
	{
		snapshot.get("snapshot").unwrap_or(snapshot)
	} else {
		snapshot
	};
	let panes = snap.get("panes").and_then(Value::as_array)?;
	for pane in panes {
		let id = pane.get("workspace_id").and_then(Value::as_str)?;
		if id != workspace_id {
			continue;
		}
		if let Some(cwd) = pane
			.get("cwd")
			.and_then(Value::as_str)
			.or_else(|| pane.get("foreground_cwd").and_then(Value::as_str))
			.filter(|cwd| !cwd.is_empty())
		{
			return Some(cwd.to_string());
		}
	}
	None
}

fn run_teardown_script_at(checkout: &str) {
	let worktree_path = PathBuf::from(checkout);
	if let Ok(cfg) = infra::config::load_project_config(checkout) {
		infra::config::execute_scripts(&cfg.teardown_script, &worktree_path);
	}
}

pub fn update_notes_with_runtime(
	runtime: &RuntimeRouter,
	db: &DbPool,
	id: &str,
	notes: &str,
) -> Result<Profile, AppError> {
	let path = crate::project::reconcile_profile_checkout(runtime, db, id)?;
	let live = live_catalog_profile(runtime, db, id)?
		.ok_or_else(|| AppError::NotFound(format!("Profile: {id}")))?;
	{
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::checkout_notes::upsert(conn, &live.project_id, &path, notes)?;
	}
	live_catalog_profile(runtime, db, id)?
		.ok_or_else(|| AppError::NotFound(format!("Profile: {id}")))
}

fn live_catalog_profile(
	runtime: &RuntimeRouter,
	db: &DbPool,
	id: &str,
) -> Result<Option<Profile>, AppError> {
	Ok(crate::project::list_with_runtime(runtime, db)?
		.into_iter()
		.flat_map(|project| project.profiles)
		.find(|profile| profile.id == id))
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
	let _ = conn;
	let _ = id;
	Err(AppError::PtyError(
		"Herdr runtime is required to delete profiles".into(),
	))
}

pub fn delete_check(
	runtime: &RuntimeRouter,
	db: &DbPool,
	id: &str,
) -> Result<ProfileDeleteCheck, AppError> {
	let worktree_path =
		crate::project::reconcile_profile_checkout(runtime, db, id)?;
	let branch_name = infra::git::branch(&worktree_path).unwrap_or_default();
	let working_tree_diff = infra::git::diff_stats(&worktree_path)?;
	let unpushed_commits =
		infra::git::branch_unique_commits(&worktree_path, &branch_name)?;
	let unpushed_commit_diff =
		infra::git::commit_diff_stats(&worktree_path, &unpushed_commits)?;

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
	use crate::runtime::{HerdrStubAdapter, HerdrWorktreeClient, RuntimeRouter};
	use diesel::Connection;
	use diesel::RunQueryDsl;
	use diesel::sqlite::SqliteConnection;
	use diesel_migrations::MigrationHarness;
	use infra::db::DbPool;
	use infra::herdr::transport::{
		WorktreeCreateRequest, WorktreeCreateResult, WorkspaceCreateRequest,
		WorkspaceCreateResult, WorktreeListEntry, WorktreeOpenResult,
		WorktreeRemoveResult,
	};
	use model::error::AppError;
	use serde_json::{json, Value};
	use std::path::{Path, PathBuf};
	use std::sync::{Arc, Mutex};
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


	struct RecordedCreate {
		branch: String,
		path: Option<String>,
		cwd: Option<String>,
		workspace_id: Option<String>,
		label: Option<String>,
	}

	#[derive(Clone)]
	struct RecordedRemove {
		workspace_id: String,
		force: bool,
	}

	struct RecordedWorkspaceCreate {
		cwd: String,
		label: Option<String>,
	}

	struct FakeWorktreeState {
		methods: Vec<String>,
		creates: Vec<RecordedCreate>,
		workspace_creates: Vec<RecordedWorkspaceCreate>,
		removes: Vec<RecordedRemove>,
		workspace_closes: Vec<String>,
		create_error: Option<AppError>,
		workspace_create_error: Option<AppError>,
		remove_error: Option<AppError>,
		workspace_close_error: Option<AppError>,
		list_error: Option<AppError>,
		land_on_error: bool,
		dirty: bool,
		not_git: bool,
		listed: Vec<WorktreeListEntry>,
		snapshot: serde_json::Value,
		next_workspace: u32,
	}

	struct FakeWorktrees {
		state: Mutex<FakeWorktreeState>,
	}

	impl FakeWorktrees {
		fn new() -> Arc<Self> {
			Arc::new(Self {
				state: Mutex::new(FakeWorktreeState {
					methods: Vec::new(),
					creates: Vec::new(),
					workspace_creates: Vec::new(),
					removes: Vec::new(),
					workspace_closes: Vec::new(),
					create_error: None,
					workspace_create_error: None,
					remove_error: None,
					workspace_close_error: None,
					list_error: None,
					land_on_error: false,
					dirty: false,
					not_git: false,
					listed: Vec::new(),
					snapshot: json!({
						"type": "session_snapshot",
						"snapshot": { "workspaces": [], "tabs": [], "panes": [] }
					}),
					next_workspace: 2,
				}),
			})
		}

		fn methods(&self) -> Vec<String> {
			self.state.lock().unwrap().methods.clone()
		}

		fn creates(&self) -> usize {
			self.state.lock().unwrap().creates.len()
		}

		fn last_create(&self) -> RecordedCreate {
			let state = self.state.lock().unwrap();
			let last = state.creates.last().expect("create recorded");
			RecordedCreate {
				branch: last.branch.clone(),
				path: last.path.clone(),
				cwd: last.cwd.clone(),
				workspace_id: last.workspace_id.clone(),
				label: last.label.clone(),
			}
		}

		fn removes(&self) -> Vec<RecordedRemove> {
			self.state.lock().unwrap().removes.clone()
		}

		fn last_remove(&self) -> RecordedRemove {
			let state = self.state.lock().unwrap();
			let last = state.removes.last().expect("remove recorded");
			RecordedRemove {
				workspace_id: last.workspace_id.clone(),
				force: last.force,
			}
		}

		fn workspace_creates(&self) -> usize {
			self.state.lock().unwrap().workspace_creates.len()
		}

		fn last_workspace_create(&self) -> RecordedWorkspaceCreate {
			let state = self.state.lock().unwrap();
			let last = state
				.workspace_creates
				.last()
				.expect("workspace create recorded");
			RecordedWorkspaceCreate {
				cwd: last.cwd.clone(),
				label: last.label.clone(),
			}
		}

		fn workspace_closes(&self) -> Vec<String> {
			self.state.lock().unwrap().workspace_closes.clone()
		}
	}

	impl HerdrWorktreeClient for FakeWorktrees {
		fn worktree_create(
			&self,
			request: WorktreeCreateRequest<'_>,
		) -> Result<WorktreeCreateResult, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("worktree.create".into());
			state.creates.push(RecordedCreate {
				branch: request.branch.to_string(),
				path: request
					.path
					.map(|path| path.to_string_lossy().into_owned()),
				cwd: request.cwd.map(|cwd| cwd.to_string_lossy().into_owned()),
				workspace_id: request.workspace_id.map(str::to_string),
				label: request.label.map(str::to_string),
			});
			let workspace_id = format!("w{}", state.next_workspace);
			state.next_workspace += 1;
			let path = request
				.path
				.map(|path| path.to_string_lossy().into_owned())
				.unwrap_or_else(|| "/tmp/herdr-wt".into());
			let entry = WorktreeListEntry {
				path: path.clone(),
				branch: Some(request.branch.to_string()),
				workspace_id: Some(workspace_id.clone()),
				is_linked_worktree: true,
			};
			if let Some(err) = state.create_error.take() {
				if state.land_on_error {
					if let Some(create_path) = request.path {
						std::fs::create_dir_all(create_path).ok();
					}
					state.listed.push(entry);
				}
				return Err(err);
			}
			if let Some(create_path) = request.path {
				std::fs::create_dir_all(create_path).ok();
			}
			state.listed.push(entry);
			Ok(WorktreeCreateResult { workspace_id, path })
		}

		fn worktree_list(
			&self,
			_cwd: Option<&Path>,
			_workspace_id: Option<&str>,
		) -> Result<Vec<WorktreeListEntry>, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("worktree.list".into());
			if state.not_git {
				return Err(AppError::HerdrTransport(
					"Herdr RPC not_git_worktree (wtlst): Herdr worktree actions require a path inside a Git work tree".into(),
				));
			}
			if let Some(err) = state.list_error.take() {
				return Err(err);
			}
			Ok(state.listed.clone())
		}

		fn worktree_open(
			&self,
			_cwd: &Path,
			path: &Path,
		) -> Result<WorktreeOpenResult, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("worktree.open".into());
			let path = path.to_string_lossy().into_owned();
			let workspace_id = state
				.listed
				.iter()
				.find(|entry| entry.path == path)
				.and_then(|entry| entry.workspace_id.clone())
				.unwrap_or_else(|| "w2".into());
			Ok(WorktreeOpenResult {
				workspace_id,
				already_open: true,
			})
		}

		fn worktree_remove(
			&self,
			workspace_id: &str,
			force: bool,
		) -> Result<WorktreeRemoveResult, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("worktree.remove".into());
			state.removes.push(RecordedRemove {
				workspace_id: workspace_id.to_string(),
				force,
			});
			if let Some(err) = state.remove_error.take() {
				if state.land_on_error {
					let _ =
						apply_listed_remove(&mut state, workspace_id, force);
				}
				return Err(err);
			}
			apply_listed_remove(&mut state, workspace_id, force)
		}

		fn workspace_create(
			&self,
			request: WorkspaceCreateRequest<'_>,
		) -> Result<WorkspaceCreateResult, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("workspace.create".into());
			let cwd = request.cwd.to_string_lossy().into_owned();
			state.workspace_creates.push(RecordedWorkspaceCreate {
				cwd: cwd.clone(),
				label: request.label.map(str::to_string),
			});
			if let Some(err) = state.workspace_create_error.take() {
				if state.land_on_error {
					let workspace_id = format!("w{}", state.next_workspace);
					state.next_workspace += 1;
					push_snapshot_workspace(&mut state, &workspace_id, &cwd);
				}
				return Err(err);
			}
			let workspace_id = format!("w{}", state.next_workspace);
			state.next_workspace += 1;
			push_snapshot_workspace(&mut state, &workspace_id, &cwd);
			Ok(WorkspaceCreateResult { workspace_id })
		}

		fn workspace_close(&self, workspace_id: &str) -> Result<(), AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("workspace.close".into());
			state.workspace_closes.push(workspace_id.to_string());
			if let Some(err) = state.workspace_close_error.take() {
				return Err(err);
			}
			remove_snapshot_workspace(&mut state, workspace_id);
			Ok(())
		}

		fn session_snapshot(&self) -> Result<serde_json::Value, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("session.snapshot".into());
			Ok(state.snapshot.clone())
		}
	}

	fn apply_listed_remove(
		state: &mut FakeWorktreeState,
		workspace_id: &str,
		force: bool,
	) -> Result<WorktreeRemoveResult, AppError> {
		let index = state.listed.iter().position(|entry| {
			entry.workspace_id.as_deref() == Some(workspace_id)
		});
		let Some(index) = index else {
			return Ok(WorktreeRemoveResult {
				workspace_id: workspace_id.to_string(),
				path: String::new(),
				forced: force,
			});
		};
		if !state.listed[index].is_linked_worktree {
			return Err(AppError::HerdrTransport(
				"refusing worktree.remove of a primary checkout".into(),
			));
		}
		if state.dirty && !force {
			return Err(AppError::HerdrTransport(
				"dirty_worktree_requires_force".into(),
			));
		}
		let path = state.listed[index].path.clone();
		state.listed.remove(index);
		if !path.is_empty() {
			if let Some(repo) = git_repo_folder_for_checkout(&path) {
				let _ = infra::git::worktree_remove(&repo, &path);
			}
			let _ = std::fs::remove_dir_all(&path);
		}
		Ok(WorktreeRemoveResult {
			workspace_id: workspace_id.to_string(),
			path,
			forced: force,
		})
	}

	fn snapshot_panes_mut(state: &mut FakeWorktreeState) -> &mut Vec<Value> {
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
		snap.get_mut("panes").unwrap().as_array_mut().unwrap()
	}

	fn push_snapshot_workspace(
		state: &mut FakeWorktreeState,
		workspace_id: &str,
		cwd: &str,
	) {
		snapshot_panes_mut(state).push(json!({
			"pane_id": format!("{workspace_id}:p1"),
			"workspace_id": workspace_id,
			"cwd": cwd,
		}));
	}

	fn remove_snapshot_workspace(
		state: &mut FakeWorktreeState,
		workspace_id: &str,
	) {
		snapshot_panes_mut(state).retain(|pane| {
			pane.get("workspace_id").and_then(Value::as_str)
				!= Some(workspace_id)
		});
	}

	fn git_worktree_list(dir: &Path) -> String {
		let output = infra::no_window::command_without_windows_console("git")
			.args(["worktree", "list", "--porcelain"])
			.current_dir(dir)
			.output()
			.expect("git worktree list");
		String::from_utf8_lossy(&output.stdout).into_owned()
	}

	fn herdr_router(
		_db: &DbPool,
		worktrees: Arc<FakeWorktrees>,
	) -> RuntimeRouter {
		RuntimeRouter::new(HerdrStubAdapter::with_worktree_client(worktrees))
	}

	fn pool_from(conn: SqliteConnection) -> DbPool {
		Arc::new(Mutex::new(conn))
	}

	fn no_sqlite_profiles(db: &DbPool) {
		#[derive(diesel::QueryableByName)]
		struct CountRow {
			#[diesel(sql_type = diesel::sql_types::BigInt)]
			count: i64,
		}
		let conn = &mut *db.lock().unwrap();
		let tables: CountRow = diesel::sql_query(
			"SELECT COUNT(*) AS count FROM sqlite_master 			 WHERE type = 'table' AND name IN 			 ('profiles', 'profile_runtime_mappings', 			  'session_runtime_mappings', 'herdr_namespaces')",
		)
		.get_result(conn)
		.unwrap();
		assert_eq!(tables.count, 0);
	}

	fn checkout_note(db: &DbPool, project_id: &str, path: &str) -> String {
		let conn = &mut *db.lock().unwrap();
		repo::checkout_notes::list_all(conn)
			.unwrap()
			.into_iter()
			.find(|row| {
				row.project_id == project_id && row.checkout_path == path
			})
			.map(|row| row.notes)
			.unwrap_or_default()
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
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let before = git_worktree_list(dir.path());
		let long_branch = std::iter::once("feature".to_string())
			.chain((0..30).map(|index| format!("segment-{index:02}")))
			.collect::<Vec<_>>()
			.join("/");

		let err = create_with_default_worktree_dir(
			&mut conn,
			&project.id,
			&long_branch,
			None,
		)
		.unwrap_err();
		assert!(
			err.to_string().contains("Herdr runtime is required"),
			"{err}"
		);
		assert_eq!(git_worktree_list(dir.path()), before);
	}

	#[test]
	fn create_profile_returns_invalid_project_config_errors() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		std::fs::write(dir.path().join("2code.json"), "{").unwrap();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake);

		let err = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feature/broken-config",
			None,
		)
		.unwrap_err();
		assert!(err.to_string().contains("Failed to parse 2code.json"), "{err}");
	}

	#[test]
	fn create_profile_uses_project_configured_worktree_dir() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let before = git_worktree_list(dir.path());
		let err = create_with_default_worktree_dir(
			&mut conn,
			&project.id,
			"feature/worktree",
			None,
		)
		.unwrap_err();
		assert!(
			err.to_string().contains("Herdr runtime is required"),
			"{err}"
		);
		assert_eq!(git_worktree_list(dir.path()), before);
	}

	#[test]
	fn create_profile_uses_default_worktree_dir_without_project_config() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let before = git_worktree_list(dir.path());
		let err = create_with_default_worktree_dir(
			&mut conn,
			&project.id,
			"feature/global",
			None,
		)
		.unwrap_err();
		assert!(
			err.to_string().contains("Herdr runtime is required"),
			"{err}"
		);
		assert_eq!(git_worktree_list(dir.path()), before);
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
	fn herdr_worktree_client_records_remove_without_replay() {
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: "/tmp/herdr-wt".into(),
				branch: Some("feat/x".into()),
				workspace_id: Some("w2".into()),
				is_linked_worktree: true,
			});
			state.dirty = true;
		}
		let err = fake.worktree_remove("w2", false).unwrap_err();
		assert!(
			err.to_string().contains("dirty_worktree_requires_force"),
			"{err}"
		);
		assert_eq!(fake.removes().len(), 1);
		assert!(!fake.last_remove().force);
		assert_eq!(
			fake.methods()
				.iter()
				.filter(|m| *m == "worktree.remove")
				.count(),
			1
		);
		fake.worktree_remove("w2", true).unwrap();
		assert_eq!(fake.removes().len(), 2);
		assert!(fake.last_remove().force);
		assert!(fake
			.worktree_list(Some(Path::new("/tmp")), None)
			.unwrap()
			.is_empty());
	}

	#[test]
	fn herdr_delete_linked_uses_worktree_remove_not_git() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let marker = dir.path().join("teardown.ran");
		let teardown =
			format!(r#"{{"teardown_script":["touch {}"]}}"#, marker.display());
		std::fs::write(dir.path().join("2code.json"), &teardown).unwrap();
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let before = git_worktree_list(dir.path());
		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/remove",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		let checkout = PathBuf::from(&profile.worktree_path);
		assert!(checkout.exists());
		std::fs::write(checkout.join("2code.json"), &teardown).unwrap();

		delete_with_runtime(&router, &db, &profile.id).unwrap();

		assert_eq!(fake.removes().len(), 1);
		assert_eq!(fake.last_remove().workspace_id, "w2");
		assert!(!fake.last_remove().force);
		assert!(marker.exists());
		assert!(!checkout.exists());
		assert_eq!(git_worktree_list(dir.path()), before);
		no_sqlite_profiles(&db);
		assert!(fake.workspace_closes().is_empty());
	}



	#[test]
	fn dirty_herdr_remove_without_force_keeps_checkout() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/dirty",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		{
			let mut state = fake.state.lock().unwrap();
			state.dirty = true;
		}
		std::fs::write(
			Path::new(&profile.worktree_path).join("dirty.txt"),
			"keep\n",
		)
		.unwrap();

		let err =
			delete_with_runtime_force(&router, &db, &profile.id, Some(false))
				.unwrap_err();
		assert!(
			err.to_string().contains("dirty_worktree_requires_force"),
			"{err}"
		);
		assert_eq!(fake.removes().len(), 1);
		assert!(!fake.last_remove().force);
		assert!(Path::new(&profile.worktree_path).exists());
		assert_eq!(profile.id, "w2");
		no_sqlite_profiles(&db);
	}

	#[test]
	fn confirmed_dirty_herdr_delete_passes_force() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/force",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		{
			let mut state = fake.state.lock().unwrap();
			state.dirty = true;
		}

		delete_with_runtime_force(&router, &db, &profile.id, Some(true))
			.unwrap();

		assert_eq!(fake.removes().len(), 1);
		assert!(fake.last_remove().force);
		assert!(!Path::new(&profile.worktree_path).exists());
		no_sqlite_profiles(&db);
	}

	#[test]
	fn herdr_delete_removes_git_branch_so_create_can_reuse_name() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let folder = dir.path().to_string_lossy().into_owned();
		let global_base = TempDir::new().expect("worktree base");
		let checkout = global_base.path().join("feat-reuse");
		let checkout_path = checkout.to_string_lossy().into_owned();
		run_git(
			dir.path(),
			["worktree", "add", "-b", "feat/reuse", &checkout_path],
		);
		assert!(infra::git::local_branch_exists(&folder, "feat/reuse").unwrap());
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: checkout
					.canonicalize()
					.unwrap()
					.to_string_lossy()
					.into_owned(),
				branch: Some("feat/reuse".into()),
				workspace_id: Some("w2".into()),
				is_linked_worktree: true,
			});
		}
		let router = herdr_router(&db, fake.clone());

		delete_with_runtime(&router, &db, "w2").unwrap();

		assert_eq!(fake.removes().len(), 1);
		assert!(!checkout.exists());
		assert!(
			!infra::git::local_branch_exists(&folder, "feat/reuse").unwrap()
		);

		let created = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/reuse",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();

		assert_eq!(created.branch_name, "feat/reuse");
		assert_eq!(fake.creates(), 1);
		no_sqlite_profiles(&db);
	}

	#[test]
	fn uncertain_worktree_remove_reconciles_without_replay() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/uncertain-rm",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		{
			let mut state = fake.state.lock().unwrap();
			state.remove_error =
				Some(AppError::HerdrUncertainOutcome("dropped".into()));
			state.land_on_error = true;
		}

		delete_with_runtime(&router, &db, &profile.id).unwrap();

		assert_eq!(fake.removes().len(), 1);
		assert!(!Path::new(&profile.worktree_path).exists());
		no_sqlite_profiles(&db);
	}

	#[test]
	fn uncertain_worktree_remove_still_present_is_not_replayed() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/uncertain-keep",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		{
			let mut state = fake.state.lock().unwrap();
			state.remove_error =
				Some(AppError::HerdrUncertainOutcome("dropped".into()));
		}

		let err = delete_with_runtime(&router, &db, &profile.id).unwrap_err();
		assert!(matches!(err, AppError::HerdrUncertainOutcome(_)), "{err}");
		assert_eq!(fake.removes().len(), 1);
		assert!(Path::new(&profile.worktree_path).exists());
		no_sqlite_profiles(&db);
	}

	#[test]
	fn herdr_delete_refuses_primary_listed_checkout() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/primary",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed[0].is_linked_worktree = false;
		}

		let err = delete_with_runtime(&router, &db, &profile.id).unwrap_err();
		assert!(err.to_string().contains("primary"), "{err}");
		assert!(fake.removes().is_empty());
		no_sqlite_profiles(&db);
		assert!(Path::new(&profile.worktree_path).exists());
	}


	#[test]
	fn project_delete_forgets_mapped_herdr_worktrees() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/forget",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();
		let checkout = PathBuf::from(&profile.worktree_path);
		assert!(checkout.exists());

		crate::project::delete_with_runtime(&router, &db, &project.id).unwrap();

		assert!(fake.removes().is_empty());
		assert!(!fake.methods().contains(&"worktree.remove".to_string()));
		assert!(checkout.exists());
		{
			let conn = &mut *db.lock().unwrap();
			assert!(repo::project::find_by_id(conn, &project.id).is_err());
		}
		no_sqlite_profiles(&db);
		let _ = dir;
	}

	#[test]
	fn herdr_create_uses_worktree_create_without_sqlite_insert() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let setup_marker = dir.path().join("setup.ran");
		std::fs::write(
			dir.path().join("2code.json"),
			format!(
				r#"{{"setup_script":["touch {}"]}}"#,
				setup_marker.display()
			),
		)
		.unwrap();
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let before = git_worktree_list(dir.path());

		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/用户",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();

		assert_eq!(profile.id, "w2");
		assert_eq!(profile.branch_name, "feat/yong-hu");
		assert!(profile.notes.is_empty());
		assert!(profile.created_at.is_empty());
		assert!(!profile.is_default);
		assert_eq!(fake.creates(), 1);
		let recorded = fake.last_create();
		assert_eq!(recorded.branch, "feat/yong-hu");
		assert!(recorded
			.cwd
			.as_ref()
			.is_some_and(|cwd| Path::new(cwd).is_absolute()));
		assert!(recorded
			.path
			.as_ref()
			.is_some_and(|path| Path::new(path).is_absolute()));
		assert!(recorded.workspace_id.is_none());
		assert_eq!(git_worktree_list(dir.path()), before);
		assert!(Path::new(&profile.worktree_path).exists());
		assert_eq!(profile.worktree_path, recorded.path.expect("path sent"));
		no_sqlite_profiles(&db);
		assert!(setup_marker.exists());
		assert!(!fake.methods().contains(&"tab.create".to_string()));
		assert!(!fake.methods().contains(&"pane.close".to_string()));
		assert!(!fake.methods().contains(&"workspace.create".to_string()));
	}

	#[test]
	fn herdr_create_prefers_live_parent_workspace_id() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let folder = dir.path().canonicalize().unwrap();
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: folder.to_string_lossy().into_owned(),
				branch: Some("main".into()),
				workspace_id: Some("w1".into()),
				is_linked_worktree: false,
			});
		}
		let router = herdr_router(&db, fake.clone());

		create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/parent",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();

		let recorded = fake.last_create();
		assert_eq!(recorded.workspace_id.as_deref(), Some("w1"));
		assert!(recorded.cwd.is_none());
	}

	#[test]
	fn uncertain_worktree_create_reconciles_without_replay() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.create_error =
				Some(AppError::HerdrUncertainOutcome("dropped".into()));
			state.land_on_error = true;
		}
		let router = herdr_router(&db, fake.clone());

		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/uncertain",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();

		assert_eq!(fake.creates(), 1);
		assert!(fake.methods().contains(&"worktree.list".to_string()));
		assert_eq!(profile.id, "w2");
		no_sqlite_profiles(&db);
		assert_eq!(
			git_worktree_list(dir.path()).matches("worktree ").count(),
			1
		);
	}

	#[test]
	fn retry_after_herdr_create_does_not_create_again() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let setup_marker = dir.path().join("setup-count");
		std::fs::write(
			dir.path().join("2code.json"),
			format!(
				r#"{{"setup_script":["printf x >> {}"]}}"#,
				setup_marker.display()
			),
		)
		.unwrap();
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let base = global_base.path().to_str().unwrap();

		let first = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/retry",
			Some(base),
		)
		.unwrap();
		let _ = dir;
		let _ = std::fs::remove_file(&setup_marker);

		let second = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/retry",
			Some(base),
		)
		.unwrap();

		assert_eq!(first.id, "w2");
		assert_eq!(first.id, second.id);
		assert_eq!(fake.creates(), 1);
		no_sqlite_profiles(&db);
		assert!(!setup_marker.exists());
	}

	#[test]
	fn retry_after_uncertain_create_reconciles_listed_checkout() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.create_error =
				Some(AppError::HerdrUncertainOutcome("dropped".into()));
			state.land_on_error = false;
		}
		let router = herdr_router(&db, fake.clone());
		let base = global_base.path().to_str().unwrap();

		let err = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/uncertain-retry",
			Some(base),
		)
		.err()
		.expect("uncertain create without listed checkout should fail");
		assert!(matches!(err, AppError::HerdrUncertainOutcome(_)), "{err}");
		assert_eq!(fake.creates(), 1);

		let recorded = fake.last_create();
		let checkout = recorded.path.clone().expect("create path");
		std::fs::create_dir_all(&checkout).unwrap();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: checkout,
				branch: Some("feat/uncertain-retry".into()),
				workspace_id: Some("w2".into()),
				is_linked_worktree: true,
			});
		}

		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/uncertain-retry",
			Some(base),
		)
		.unwrap();

		assert_eq!(fake.creates(), 1);
		assert_eq!(profile.id, "w2");
		no_sqlite_profiles(&db);
	}

	#[test]
	fn herdr_duplicate_create_returns_existing_workspace() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());
		let base = global_base.path().to_str().unwrap();

		let first = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/dup",
			Some(base),
		)
		.unwrap();
		let second = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/dup",
			Some(base),
		)
		.unwrap();

		assert_eq!(first.id, "w2");
		assert_eq!(first.id, second.id);
		assert_eq!(fake.creates(), 1);
		no_sqlite_profiles(&db);
	}

	#[test]
	fn herdr_nongit_create_uses_workspace_create_cwd() {
		let mut conn = setup_db();
		let dir = TempDir::new().expect("nongit");
		std::fs::write(dir.path().join("notes.txt"), "hi\n").unwrap();
		let folder = dir.path().to_string_lossy().into_owned();
		let project =
			crate::project::create_from_folder(&mut conn, "Notes", &folder)
				.unwrap();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			fake.state.lock().unwrap().not_git = true;
		}
		let router = herdr_router(&db, fake.clone());

		let profile =
			create_with_runtime(&router, &db, &project.id, "folder", None)
				.unwrap();

		assert_eq!(profile.id, "w2");
		assert_eq!(profile.branch_name, "folder");
		assert!(profile.notes.is_empty());
		assert_eq!(fake.creates(), 0);
		assert_eq!(fake.workspace_creates(), 1);
		let recorded = fake.last_workspace_create();
		assert!(Path::new(&recorded.cwd).is_absolute());
		assert_eq!(recorded.label.as_deref(), Some("folder"));
		no_sqlite_profiles(&db);
		assert!(!fake.methods().contains(&"worktree.create".to_string()));
	}

	#[test]
	fn uncertain_nongit_create_does_not_adopt_existing_workspace() {
		let mut conn = setup_db();
		let dir = TempDir::new().expect("nongit");
		std::fs::write(dir.path().join("notes.txt"), "hi\n").unwrap();
		let folder = dir.path().to_string_lossy().into_owned();
		let project =
			crate::project::create_from_folder(&mut conn, "Notes", &folder)
				.unwrap();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			fake.state.lock().unwrap().not_git = true;
		}
		let router = herdr_router(&db, fake.clone());
		let first = create_with_runtime(&router, &db, &project.id, "one", None)
			.unwrap();
		assert_eq!(first.id, "w2");
		{
			let mut state = fake.state.lock().unwrap();
			state.workspace_create_error =
				Some(AppError::HerdrUncertainOutcome("dropped".into()));
			state.land_on_error = false;
		}

		let err = create_with_runtime(&router, &db, &project.id, "two", None)
			.err()
			.expect("uncertain create must not adopt the existing workspace");

		assert!(err.to_string().contains("uncertain"), "{err}");
		assert_eq!(fake.workspace_creates(), 2);
		no_sqlite_profiles(&db);
	}

	#[test]
	fn uncertain_nongit_create_reconciles_new_workspace_without_replay() {
		let mut conn = setup_db();
		let dir = TempDir::new().expect("nongit");
		std::fs::write(dir.path().join("notes.txt"), "hi\n").unwrap();
		let folder = dir.path().to_string_lossy().into_owned();
		let project =
			crate::project::create_from_folder(&mut conn, "Notes", &folder)
				.unwrap();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			fake.state.lock().unwrap().not_git = true;
		}
		let router = herdr_router(&db, fake.clone());
		let first = create_with_runtime(&router, &db, &project.id, "one", None)
			.unwrap();
		assert_eq!(first.id, "w2");
		{
			let mut state = fake.state.lock().unwrap();
			state.workspace_create_error =
				Some(AppError::HerdrUncertainOutcome("dropped".into()));
			state.land_on_error = true;
		}

		let profile =
			create_with_runtime(&router, &db, &project.id, "two", None)
				.unwrap();

		assert_eq!(profile.id, "w3");
		assert_eq!(fake.workspace_creates(), 2);
		no_sqlite_profiles(&db);
	}

	#[test]
	fn herdr_nongit_delete_extra_uses_workspace_close() {
		let mut conn = setup_db();
		let dir = TempDir::new().expect("nongit");
		std::fs::write(dir.path().join("notes.txt"), "hi\n").unwrap();
		let folder = dir.path().to_string_lossy().into_owned();
		let project =
			crate::project::create_from_folder(&mut conn, "Notes", &folder)
				.unwrap();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			fake.state.lock().unwrap().not_git = true;
		}
		let router = herdr_router(&db, fake.clone());
		let first = create_with_runtime(&router, &db, &project.id, "one", None)
			.unwrap();
		let extra = create_with_runtime(&router, &db, &project.id, "two", None)
			.unwrap();
		assert_eq!(first.id, "w2");
		assert_eq!(extra.id, "w3");

		delete_with_runtime(&router, &db, &extra.id).unwrap();

		assert_eq!(fake.workspace_closes(), vec!["w3".to_string()]);
		assert!(fake.removes().is_empty());
		no_sqlite_profiles(&db);

		let err = delete_with_runtime(&router, &db, &first.id).unwrap_err();
		assert!(err.to_string().contains("primary"), "{err}");
		assert_eq!(fake.workspace_closes(), vec!["w3".to_string()]);
	}

	#[test]
	fn herdr_duplicate_existing_branch_fails_closed() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		run_git(dir.path(), ["branch", "feat/taken"]);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = herdr_router(&db, fake.clone());

		let err = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/taken",
			Some(global_base.path().to_str().unwrap()),
		)
		.err()
		.expect("duplicate branch should fail");

		assert!(err.to_string().contains("already exists"), "{err}");
		assert_eq!(fake.creates(), 0);
	}

	#[test]
	fn herdr_existing_linked_worktree_does_not_persist_a_new_profile() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: "/tmp/someone-else-wt".into(),
				branch: Some("feat/taken".into()),
				workspace_id: Some("w9".into()),
				is_linked_worktree: true,
			});
		}
		let router = herdr_router(&db, fake.clone());

		let err = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/taken",
			Some(global_base.path().to_str().unwrap()),
		)
		.err()
		.expect("existing linked worktree should fail closed");

		assert!(err.to_string().contains("already exists"), "{err}");
		assert_eq!(fake.creates(), 0);
		no_sqlite_profiles(&db);
	}

	#[test]
	fn herdr_uncertain_list_does_not_steal_existing_linked_worktree() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: "/tmp/someone-else-wt".into(),
				branch: Some("feat/taken".into()),
				workspace_id: Some("w9".into()),
				is_linked_worktree: true,
			});
			state.list_error =
				Some(AppError::HerdrUncertainOutcome("dropped".into()));
		}
		let router = herdr_router(&db, fake.clone());

		let err = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/taken",
			Some(global_base.path().to_str().unwrap()),
		)
		.err()
		.expect("uncertain worktree.list should fail closed");

		assert!(matches!(err, AppError::HerdrUncertainOutcome(_)), "{err}");
		assert_eq!(fake.creates(), 0);
		no_sqlite_profiles(&db);
	}


	#[test]
	fn herdr_without_client_does_not_spawn_local_worktree() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let router = RuntimeRouter::new(HerdrStubAdapter::new());
		let before = git_worktree_list(dir.path());

		let err = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/missing",
			Some(global_base.path().to_str().unwrap()),
		)
		.err()
		.expect("missing Herdr client should fail");

		assert!(err.to_string().contains("not available"), "{err}");
		assert_eq!(git_worktree_list(dir.path()), before);
	}

	#[test]
	fn herdr_without_client_does_not_git_worktree_remove() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let db = pool_from(conn);
		let router = RuntimeRouter::new(HerdrStubAdapter::new());
		let before = git_worktree_list(dir.path());

		let err = delete_with_runtime(&router, &db, "w2")
			.err()
			.expect("missing Herdr client should fail");

		assert!(err.to_string().contains("not available"), "{err}");
		assert_eq!(git_worktree_list(dir.path()), before);
		no_sqlite_profiles(&db);
		let _ = project;
	}


	#[test]
	fn herdr_profile_create_does_not_use_forbidden_ops() {
		let src = include_str!("profile.rs");
		let herdr = src
			.split("fn create_herdr_with_db")
			.nth(1)
			.unwrap()
			.split("pub fn create_with_default_worktree_dir")
			.next()
			.unwrap();
		assert!(
			herdr.contains("worktree.create")
				|| herdr.contains("worktree_create")
		);
		assert!(
			herdr.contains("workspace.create")
				|| herdr.contains("workspace_create")
		);
		assert!(!herdr.contains("worktree.remove"));
		assert!(!herdr.contains("git worktree add"));
		assert!(!herdr.contains("worktree_add"));
		assert!(!herdr.contains("repo::profile::insert"));
		assert!(!herdr.contains("bind_profile_workspace"));
		assert!(!herdr.contains("tab.create"));
		assert!(!herdr.contains("pane.close"));
		assert!(!herdr.contains("pane.split"));
		assert!(!herdr.contains("pane.send_input"));
		assert!(!herdr.contains("server.stop"));
		assert!(!herdr.contains("--takeover"));
		assert!(!herdr.contains("herdr-client.sock"));
		assert!(!herdr.contains("replace_profile_workspace"));
		assert!(!herdr.contains("git worktree add"));
		let identity = src
			.split("fn delete_herdr_identity")
			.nth(1)
			.unwrap()
			.split("pub fn update_notes_with_runtime")
			.next()
			.unwrap();
		assert!(
			identity.contains("worktree.remove")
				|| identity.contains("worktree_remove")
		);
		assert!(
			identity.contains("workspace.close")
				|| identity.contains("workspace_close")
		);
		assert!(!identity.contains("repo::profile::delete_record"));
		assert!(!identity.contains("infra::git::worktree_remove"));
		assert!(identity.contains("branch_delete"));
		assert!(!identity.contains("git::worktree_remove"));
		let handler = include_str!("../../../src/handler/profile.rs");
		let create = handler
			.split("pub async fn create_profile")
			.nth(1)
			.unwrap()
			.split("pub async fn delete_profile")
			.next()
			.unwrap();
		assert!(create.contains("create_with_runtime"));
		assert!(create.contains("RuntimeHandle"));
		assert!(!create.contains("create_with_db"));
		assert!(!create.contains("ensure_herdr_listener"));
		let lib = include_str!("../../../src/lib.rs");
		assert!(!lib.contains("ensure_herdr_listener"));
	}

	#[test]
	fn herdr_profile_delete_does_not_use_forbidden_ops() {
		let src = include_str!("profile.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		let herdr = src
			.split("fn delete_herdr_git_workspace")
			.nth(1)
			.unwrap()
			.split("fn delete_herdr_nongit_workspace")
			.next()
			.unwrap();
		assert!(
			herdr.contains("worktree.remove")
				|| herdr.contains("worktree_remove")
		);
		assert!(herdr.contains("run_teardown_script_at"));
		assert!(herdr.contains("branch_delete"));
		assert!(!herdr.contains("release_herdr_session"));
		assert!(!herdr.contains("infra::git::worktree_remove"));
		assert!(!herdr.contains("teardown_session"));
		assert!(!herdr.contains("pane.close"));
		assert!(!herdr.contains("pane_close"));
		assert!(!herdr.contains("workspace.close"));
		assert!(!herdr.contains("workspace_close"));
		assert!(!herdr.contains("server.stop"));
		assert!(!herdr.contains("pane.send_input"));
		assert!(!herdr.contains("--takeover"));
		assert!(!herdr.contains("herdr-client.sock"));
		let handler = include_str!("../../../src/handler/profile.rs");
		let delete = handler
			.split("pub async fn delete_profile")
			.nth(1)
			.unwrap()
			.split("pub async fn get_profile_delete_check")
			.next()
			.unwrap();
		assert!(delete.contains("delete_with_runtime"));
		assert!(!delete.contains("cleanup_profile"));
		assert!(!delete.contains("git::worktree_remove"));
		assert!(!src.contains("delete_sqlite_identity"));
		assert!(!src.contains("local_extras_delete_closed"));
	}

	#[test]
	fn default_profiles_are_not_created_via_worktree_create() {
		let src = include_str!("project.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		assert!(!src.contains("synthetic_local_profile"));
		assert!(!src.contains("insert_default"));
		assert!(!src.contains("worktree.create"));
		assert!(!src.contains("create_herdr_with_db"));
		assert!(!src.contains("create_with_runtime"));
	}

	#[test]
	fn herdr_notes_update_persists_sqlite_notes_by_checkout_path() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let default_id = format!("default-{}", project.id);
		let folder = dir.path().to_string_lossy().into_owned();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: folder.clone(),
				branch: Some("main".into()),
				workspace_id: Some("w1".into()),
				is_linked_worktree: false,
			});
		}
		let router = herdr_router(&db, fake);

		let updated = update_notes_with_runtime(&router, &db, "w1", "hello")
			.expect("notes");
		assert_eq!(updated.id, "w1");
		assert_eq!(updated.notes, "hello");
		assert!(updated.is_default);

		assert_eq!(checkout_note(&db, &project.id, &folder), "hello");
		let _ = default_id;
	}

	#[test]
	fn herdr_notes_update_linked_persists_checkout_notes() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let default_id = format!("default-{}", project.id);
		let folder = dir.path().to_string_lossy().into_owned();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: folder.clone(),
				branch: Some("main".into()),
				workspace_id: Some("w1".into()),
				is_linked_worktree: false,
			});
			state.listed.push(WorktreeListEntry {
				path: format!("{folder}/linked"),
				branch: Some("feat/x".into()),
				workspace_id: Some("w2".into()),
				is_linked_worktree: true,
			});
		}
		let router = herdr_router(&db, fake);

		let primary = update_notes_with_runtime(&router, &db, "w1", "kept")
			.expect("primary notes persist on leftover checkout");
		assert_eq!(primary.id, "w1");
		assert!(primary.is_default);
		assert_eq!(primary.notes, "kept");

		let linked =
			update_notes_with_runtime(&router, &db, "w2", "linked-note")
				.expect("linked notes persist");
		assert_eq!(linked.id, "w2");
		assert!(!linked.is_default);
		assert_eq!(linked.notes, "linked-note");

		assert_eq!(checkout_note(&db, &project.id, &folder), "kept");
		assert_eq!(
			checkout_note(&db, &project.id, &format!("{folder}/linked")),
			"linked-note"
		);
		let _ = default_id;
	}

	#[test]
	fn herdr_delete_unmapped_workspace_id_does_not_insert_sqlite_profile() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let folder = dir.path().to_string_lossy().into_owned();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: folder.clone(),
				branch: Some("main".into()),
				workspace_id: Some("w1".into()),
				is_linked_worktree: false,
			});
			state.listed.push(WorktreeListEntry {
				path: format!("{folder}/linked"),
				branch: Some("feat/x".into()),
				workspace_id: Some("w2".into()),
				is_linked_worktree: true,
			});
		}
		let router = herdr_router(&db, fake.clone());

		delete_with_runtime(&router, &db, "w2").unwrap();

		assert_eq!(fake.removes().len(), 1);
		assert_eq!(fake.last_remove().workspace_id, "w2");
		no_sqlite_profiles(&db);
		let _ = project;
	}

	#[test]
	fn delete_check_reconciles_instead_of_sqlite_find() {
		let src = include_str!("profile.rs")
			.split("#[cfg(test)]")
			.next()
			.unwrap();
		let body = src
			.split("pub fn delete_check(")
			.nth(1)
			.unwrap()
			.split("fn add_diff_stats")
			.next()
			.unwrap();
		assert!(body.contains("reconcile_profile_checkout"));
		assert!(!body.contains("find_by_id"));
		let handler = include_str!("../../../src/handler/profile.rs");
		let check = handler
			.split("pub async fn get_profile_delete_check")
			.nth(1)
			.unwrap()
			.split("pub async fn update_profile_notes")
			.next()
			.unwrap();
		assert!(check.contains("delete_check"));
		assert!(!check.contains("find_by_id"));
	}

	#[test]
	fn herdr_delete_check_uses_listed_checkout_not_sqlite_stale() {
		let mut conn = setup_db();
		let (project, listed_dir) = create_project_with_git_repo(&mut conn);
		let stale_dir = create_temp_git_repo();
		let listed_path = listed_dir.path().to_string_lossy().into_owned();
		let default_id = format!("default-{}", project.id);
		let _ = stale_dir;
		std::fs::write(
			listed_dir.path().join("listed-only.txt"),
			"listed dirty",
		)
		.unwrap();
		std::fs::write(stale_dir.path().join("stale-only.txt"), "stale dirty")
			.unwrap();
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.listed.push(WorktreeListEntry {
				path: listed_path,
				branch: Some("main".into()),
				workspace_id: Some("w1".into()),
				is_linked_worktree: false,
			});
		}
		let router = herdr_router(&db, fake);

		let check = delete_check(&router, &db, "w1").expect("live check");
		assert_eq!(check.working_tree_diff.files_changed, 1);

		let err = delete_check(&router, &db, &default_id)
			.expect_err("sqlite default id");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");
		let err = delete_check(&router, &db, "leftover").expect_err("stale id");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");
		let err = delete_check(&router, &db, "w-missing").expect_err("unknown");
		assert!(matches!(err, AppError::NotFound(_)), "{err}");
	}


}
