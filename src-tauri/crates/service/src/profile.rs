use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use diesel::SqliteConnection;
use infra::db::DbPool;
use infra::herdr::transport::{WorktreeCreateRequest, WorktreeCreateResult};
use uuid::Uuid;

use model::error::AppError;
use model::profile::{Profile, ProfileDeleteCheck};
use model::project::GitDiffStats;
use model::runtime::{RuntimeBackend, RuntimeIdentityState, HERDR_NAMESPACE};

use crate::runtime::{HerdrWorktreeClient, RuntimeRouter, TerminalRuntime};
use crate::runtime_mapping::workspace_identity_state;
use crate::runtime_sync::RuntimeProjection;

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

pub fn create_with_runtime(
	runtime: &RuntimeRouter,
	db: &DbPool,
	project_id: &str,
	branch_name: &str,
	default_worktree_dir: Option<&str>,
) -> Result<Profile, AppError> {
	match runtime.selected_backend() {
		RuntimeBackend::Local => {
			create_with_db(db, project_id, branch_name, default_worktree_dir)
		}
		RuntimeBackend::Herdr => {
			let worktrees = runtime.herdr_worktrees()?;
			create_herdr_with_db(
				worktrees,
				db,
				project_id,
				branch_name,
				default_worktree_dir,
			)
		}
	}
}

fn create_herdr_with_db(
	worktrees: &dyn HerdrWorktreeClient,
	db: &DbPool,
	project_id: &str,
	branch_name: &str,
	default_worktree_dir: Option<&str>,
) -> Result<Profile, AppError> {
	let auto_generated = branch_name.trim().is_empty();
	let (project_folder, mut existing_branches, default_profile_id) = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let project_folder =
			repo::profile::get_project_folder(conn, project_id)?;
		let existing_branches =
			repo::profile::list_branch_names_by_project(conn, project_id)?;
		let default_profile_id =
			repo::profile::list_by_project(conn, project_id)?
				.into_iter()
				.find(|profile| profile.is_default)
				.map(|profile| profile.id);
		(project_folder, existing_branches, default_profile_id)
	};
	let project_config = load_project_config(&project_folder)?;
	let cwd = Path::new(&project_folder).canonicalize()?;
	let parent_workspace_id = bound_parent_workspace_id(
		db,
		worktrees,
		default_profile_id.as_deref(),
	)?;

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
		let id = herdr_profile_id(project_id, &branch_name);
		match create_herdr_once(
			worktrees,
			db,
			project_id,
			&project_folder,
			&cwd,
			parent_workspace_id.as_deref(),
			&project_config,
			default_worktree_dir,
			&id,
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

fn bound_parent_workspace_id(
	db: &DbPool,
	worktrees: &dyn HerdrWorktreeClient,
	default_profile_id: Option<&str>,
) -> Result<Option<String>, AppError> {
	let Some(profile_id) = default_profile_id else {
		return Ok(None);
	};
	let mapping = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		match repo::runtime_mapping::find_profile_mapping(conn, profile_id) {
			Ok(mapping) => Some(mapping),
			Err(AppError::NotFound(_)) => None,
			Err(err) => return Err(err),
		}
	};
	let Some(mapping) = mapping else {
		return Ok(None);
	};
	let snapshot = worktrees.session_snapshot()?;
	let mut projection = RuntimeProjection::new();
	projection.apply_snapshot(&snapshot)?;
	if workspace_identity_state(&mapping, &projection)
		== RuntimeIdentityState::Bound
	{
		Ok(Some(mapping.workspace_id))
	} else {
		Ok(None)
	}
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

fn create_herdr_once(
	worktrees: &dyn HerdrWorktreeClient,
	db: &DbPool,
	project_id: &str,
	project_folder: &str,
	cwd: &Path,
	parent_workspace_id: Option<&str>,
	project_config: &infra::config::ProjectConfig,
	default_worktree_dir: Option<&str>,
	id: &str,
	branch_name: &str,
) -> Result<Profile, AppError> {
	if let Some(existing) =
		existing_profile_for_branch(db, project_id, branch_name)?
	{
		return bind_herdr_insert_retry(
			worktrees,
			db,
			cwd,
			parent_workspace_id,
			&existing,
			id,
			branch_name,
		);
	}

	let worktree_base = resolve_worktree_base(
		project_folder,
		project_config.worktree_dir.as_deref(),
		default_worktree_dir,
	)?;
	std::fs::create_dir_all(&worktree_base)?;
	let worktree_base = worktree_base.canonicalize()?;
	let intended_path =
		build_worktree_path(&worktree_base, project_folder, branch_name, id);

	if let Some(created) = checkout_at_listed_path(
		worktrees,
		cwd,
		parent_workspace_id,
		&intended_path,
		false,
	)? {
		return persist_herdr_profile(
			db,
			project_id,
			project_config,
			id,
			branch_name,
			created,
			true,
		);
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

	persist_herdr_profile(
		db,
		project_id,
		project_config,
		id,
		branch_name,
		created,
		true,
	)
}

fn existing_profile_for_branch(
	db: &DbPool,
	project_id: &str,
	branch_name: &str,
) -> Result<Option<Profile>, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	Ok(repo::profile::list_by_project(conn, project_id)?
		.into_iter()
		.find(|profile| {
			!profile.is_default && profile.branch_name == branch_name
		}))
}

fn profile_has_workspace_mapping(
	db: &DbPool,
	profile_id: &str,
) -> Result<bool, AppError> {
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	match repo::runtime_mapping::find_profile_mapping(conn, profile_id) {
		Ok(_) => Ok(true),
		Err(AppError::NotFound(_)) => Ok(false),
		Err(err) => Err(err),
	}
}

fn herdr_profile_id(project_id: &str, branch_name: &str) -> String {
	Uuid::new_v5(
		&Uuid::NAMESPACE_URL,
		format!("2code-profile:{project_id}:{branch_name}").as_bytes(),
	)
	.to_string()
}

fn bind_herdr_insert_retry(
	worktrees: &dyn HerdrWorktreeClient,
	db: &DbPool,
	cwd: &Path,
	parent_workspace_id: Option<&str>,
	existing: &Profile,
	id: &str,
	branch_name: &str,
) -> Result<Profile, AppError> {
	let already_exists =
		AppError::GitError(format!("Branch '{branch_name}' already exists"));
	if existing.id != id || profile_has_workspace_mapping(db, &existing.id)? {
		return Err(already_exists);
	}
	let Some(workspace_id) = listed_open_workspace_id(
		worktrees,
		cwd,
		parent_workspace_id,
		Path::new(&existing.worktree_path),
	)?
	else {
		return Err(already_exists);
	};
	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	repo::runtime_mapping::bind_profile_workspace(
		conn,
		&existing.id,
		HERDR_NAMESPACE,
		&workspace_id,
	)?;
	repo::profile::find_by_id(conn, &existing.id)
}

fn listed_open_workspace_id(
	worktrees: &dyn HerdrWorktreeClient,
	cwd: &Path,
	parent_workspace_id: Option<&str>,
	path: &Path,
) -> Result<Option<String>, AppError> {
	let listed = list_worktrees(worktrees, cwd, parent_workspace_id)?;
	Ok(match_listed_worktree(&listed, path)
		.map(|created| created.workspace_id)
		.filter(|workspace_id| !workspace_id.is_empty()))
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

fn persist_herdr_profile(
	db: &DbPool,
	project_id: &str,
	project_config: &infra::config::ProjectConfig,
	id: &str,
	branch_name: &str,
	created: WorktreeCreateResult,
	run_setup: bool,
) -> Result<Profile, AppError> {
	let worktree_str = created.path.clone();
	let worktree_path = PathBuf::from(&worktree_str);
	let profile = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		if let Ok(existing) = repo::profile::find_by_id(conn, id) {
			repo::runtime_mapping::bind_profile_workspace(
				conn,
				id,
				HERDR_NAMESPACE,
				&created.workspace_id,
			)?;
			return Ok(existing);
		}
		let profile = repo::profile::insert(
			conn,
			id,
			project_id,
			branch_name,
			&worktree_str,
		)?;
		repo::runtime_mapping::bind_profile_workspace(
			conn,
			id,
			HERDR_NAMESPACE,
			&created.workspace_id,
		)?;
		profile
	};

	if run_setup {
		infra::config::execute_scripts(
			&project_config.setup_script,
			&worktree_path,
		);
	}

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

fn cleanup_profile(
	profile: &Profile,
	project_folder: &str,
) -> Result<(), AppError> {
	let worktree_path = PathBuf::from(&profile.worktree_path);

	if let Ok(cfg) = infra::config::load_project_config(project_folder) {
		infra::config::execute_scripts(&cfg.teardown_script, &worktree_path);
	}

	let branch_name =
		infra::git::worktree_current_branch(&profile.worktree_path)?
			.unwrap_or_else(|| profile.branch_name.clone());

	infra::git::worktree_remove(project_folder, &profile.worktree_path)?;
	infra::git::branch_delete(project_folder, &branch_name)?;

	Ok(())
}

pub fn delete_with_db(db: &DbPool, id: &str) -> Result<(), AppError> {
	let (profile, project_folder) = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		repo::profile::get_delete_target(conn, id)?
	};

	cleanup_profile(&profile, &project_folder)?;

	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	repo::profile::delete_record(conn, id)
}

pub fn delete_with_runtime(
	runtime: &RuntimeRouter,
	db: &infra::db::DbPool,
	id: &str,
) -> Result<(), AppError> {
	let (profile, project_folder, session_ids) = {
		let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
		let (profile, project_folder) =
			repo::profile::get_delete_target(conn, id)?;
		let session_ids = repo::pty::list_ids_by_profile(conn, id)?;
		(profile, project_folder, session_ids)
	};

	for session_id in &session_ids {
		runtime.teardown_session(session_id)?;
	}

	cleanup_profile(&profile, &project_folder)?;

	let conn = &mut *db.lock().map_err(|_| AppError::LockError)?;
	for session_id in &session_ids {
		repo::pty::mark_closed(conn, session_id);
	}
	repo::profile::delete_record(conn, id)
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
	let (profile, project_folder) = repo::profile::get_delete_target(conn, id)?;

	cleanup_profile(&profile, &project_folder)?;

	repo::profile::delete_record(conn, id)
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
	use crate::pty::{create_flush_senders, PtyContext};
	use crate::runtime::{HerdrStubAdapter, LocalAdapter, RuntimeRouter};
	use crate::PtyEventEmitter;
	use diesel::Connection;
	use diesel::RunQueryDsl;
	use diesel_migrations::MigrationHarness;
	use infra::herdr::transport::{WorktreeListEntry, WorktreeOpenResult};
	use model::runtime::RuntimeBackend;
	use serde_json::json;
	use std::path::Path;
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

	struct TestEmitter;

	impl PtyEventEmitter for TestEmitter {
		fn emit_output(&self, _session_id: &str, _bytes: &[u8]) -> bool {
			true
		}

		fn emit_exit(&self, _session_id: &str) {}
	}

	struct RecordedCreate {
		branch: String,
		path: Option<String>,
		cwd: Option<String>,
		workspace_id: Option<String>,
		label: Option<String>,
	}

	struct FakeWorktreeState {
		methods: Vec<String>,
		creates: Vec<RecordedCreate>,
		create_error: Option<AppError>,
		list_error: Option<AppError>,
		land_on_error: bool,
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
					create_error: None,
					list_error: None,
					land_on_error: false,
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

		fn session_snapshot(&self) -> Result<serde_json::Value, AppError> {
			let mut state = self.state.lock().unwrap();
			state.methods.push("session.snapshot".into());
			Ok(state.snapshot.clone())
		}
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
		db: &DbPool,
		worktrees: Arc<FakeWorktrees>,
	) -> RuntimeRouter {
		let logs = std::env::temp_dir().join("2code-profile-herdr-logs");
		std::fs::create_dir_all(&logs).ok();
		let ctx = PtyContext {
			db: db.clone(),
			sessions: infra::pty::create_session_map(),
			flush_senders: create_flush_senders(),
			read_threads: infra::pty::create_thread_tracker(),
			emitter: Arc::new(TestEmitter),
			output_dir: logs,
		};
		RuntimeRouter::with_backend(
			RuntimeBackend::Herdr,
			LocalAdapter::new(ctx),
			HerdrStubAdapter::with_worktree_client(worktrees),
		)
	}

	fn local_router(
		db: &DbPool,
		worktrees: Arc<FakeWorktrees>,
	) -> RuntimeRouter {
		let logs = std::env::temp_dir().join("2code-profile-local-logs");
		std::fs::create_dir_all(&logs).ok();
		let ctx = PtyContext {
			db: db.clone(),
			sessions: infra::pty::create_session_map(),
			flush_senders: create_flush_senders(),
			read_threads: infra::pty::create_thread_tracker(),
			emitter: Arc::new(TestEmitter),
			output_dir: logs,
		};
		RuntimeRouter::new(
			LocalAdapter::new(ctx),
			HerdrStubAdapter::with_worktree_client(worktrees),
		)
	}

	fn pool_from(conn: SqliteConnection) -> DbPool {
		Arc::new(Mutex::new(conn))
	}

	#[test]
	fn herdr_create_uses_worktree_create_and_binds_workspace() {
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

		assert_eq!(profile.branch_name, "feat/yong-hu");
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
		let mapping = {
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(conn, &profile.id)
				.unwrap()
		};
		assert_eq!(mapping.workspace_id, "w2");
		assert_eq!(mapping.namespace, HERDR_NAMESPACE);
		assert!(setup_marker.exists());
		assert!(!fake.methods().contains(&"tab.create".to_string()));
		assert!(!fake.methods().contains(&"pane.close".to_string()));
		let sessions = {
			let conn = &mut *db.lock().unwrap();
			repo::pty::list_ids_by_profile(conn, &profile.id).unwrap()
		};
		assert!(sessions.is_empty());
	}

	#[test]
	fn herdr_create_prefers_bound_parent_workspace_id() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let default_id = format!("default-{}", project.id);
		repo::runtime_mapping::bind_profile_workspace(
			&mut conn,
			&default_id,
			HERDR_NAMESPACE,
			"w1",
		)
		.unwrap();
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		{
			let mut state = fake.state.lock().unwrap();
			state.snapshot = json!({
				"type": "session_snapshot",
				"snapshot": {
					"workspaces": [{ "workspace_id": "w1", "label": "main" }],
					"tabs": [],
					"panes": []
				}
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
		let mapping = {
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(conn, &profile.id)
				.unwrap()
		};
		assert_eq!(mapping.workspace_id, "w2");
		assert_eq!(
			git_worktree_list(dir.path()).matches("worktree ").count(),
			1
		);
	}

	#[test]
	fn retry_after_insert_without_bind_does_not_create_again() {
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
		{
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::unbind_profile_workspace(conn, &first.id)
				.unwrap();
		}

		let second = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/retry",
			Some(base),
		)
		.unwrap();

		assert_eq!(first.id, second.id);
		assert_eq!(fake.creates(), 1);
		let mapping = {
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(conn, &second.id)
				.unwrap()
		};
		assert_eq!(mapping.workspace_id, "w2");
		let setup = std::fs::read_to_string(&setup_marker).unwrap();
		assert_eq!(setup.matches('x').count(), 1);
	}

	#[test]
	fn retry_after_create_without_insert_does_not_create_again() {
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
			"feat/orphan-create",
			Some(base),
		)
		.unwrap();
		{
			let conn = &mut *db.lock().unwrap();
			repo::profile::delete_record(conn, &first.id).unwrap();
		}
		let _ = std::fs::remove_file(&setup_marker);

		let second = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/orphan-create",
			Some(base),
		)
		.unwrap();

		assert_eq!(first.id, second.id);
		assert_eq!(fake.creates(), 1);
		let mapping = {
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(conn, &second.id)
				.unwrap()
		};
		assert_eq!(mapping.workspace_id, "w2");
		let extra = {
			let conn = &mut *db.lock().unwrap();
			repo::profile::list_by_project(conn, &project.id)
				.unwrap()
				.into_iter()
				.filter(|profile| !profile.is_default)
				.count()
		};
		assert_eq!(extra, 1);
		let setup = std::fs::read_to_string(&setup_marker).unwrap();
		assert_eq!(setup.matches('x').count(), 1);
	}

	#[test]
	fn retry_after_uncertain_create_reconciles_listed_checkout() {
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
		let mapping = {
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(conn, &profile.id)
				.unwrap()
		};
		assert_eq!(mapping.workspace_id, "w2");
		let extra = {
			let conn = &mut *db.lock().unwrap();
			repo::profile::list_by_project(conn, &project.id)
				.unwrap()
				.into_iter()
				.filter(|profile| !profile.is_default)
				.count()
		};
		assert_eq!(extra, 1);
		let setup = std::fs::read_to_string(&setup_marker).unwrap();
		assert_eq!(setup.matches('x').count(), 1);
	}

	#[test]
	fn herdr_duplicate_bound_profile_fails_closed() {
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
		let err = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/dup",
			Some(base),
		)
		.err()
		.expect("duplicate bound profile should fail");

		assert!(err.to_string().contains("already exists"), "{err}");
		assert_eq!(fake.creates(), 1);
		let extra = {
			let conn = &mut *db.lock().unwrap();
			repo::profile::list_by_project(conn, &project.id)
				.unwrap()
				.into_iter()
				.filter(|profile| !profile.is_default)
				.count()
		};
		assert_eq!(extra, 1);
		let mapping = {
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(conn, &first.id)
				.unwrap()
		};
		assert_eq!(mapping.workspace_id, "w2");
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
		let extra = {
			let conn = &mut *db.lock().unwrap();
			repo::profile::list_by_project(conn, &project.id)
				.unwrap()
				.into_iter()
				.filter(|profile| !profile.is_default)
				.count()
		};
		assert_eq!(extra, 0);
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
		let extra = {
			let conn = &mut *db.lock().unwrap();
			repo::profile::list_by_project(conn, &project.id)
				.unwrap()
				.into_iter()
				.filter(|profile| !profile.is_default)
				.count()
		};
		assert_eq!(extra, 0);
		let stolen = {
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::find_profile_by_workspace(
				conn,
				HERDR_NAMESPACE,
				"w9",
			)
		};
		assert!(stolen.is_err());
	}

	#[test]
	fn herdr_create_does_not_adopt_existing_local_profile() {
		let mut conn = setup_db();
		let (project, _dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let base = global_base.path().to_str().unwrap();
		let local =
			create_with_db(&db, &project.id, "feat/local-dup", Some(base))
				.unwrap();

		for workspace_id in [None, Some("w9")] {
			let fake = FakeWorktrees::new();
			{
				let mut state = fake.state.lock().unwrap();
				state.listed.push(WorktreeListEntry {
					path: local.worktree_path.clone(),
					branch: Some("feat/local-dup".into()),
					workspace_id: workspace_id.map(str::to_string),
					is_linked_worktree: true,
				});
			}
			let router = herdr_router(&db, fake.clone());

			let err = create_with_runtime(
				&router,
				&db,
				&project.id,
				"feat/local-dup",
				Some(base),
			)
			.err()
			.expect("Local same-branch profile should fail closed");

			assert!(err.to_string().contains("already exists"), "{err}");
			assert_eq!(fake.creates(), 0);
			assert!(!fake.methods().contains(&"worktree.create".to_string()));
			assert!(!fake.methods().contains(&"worktree.open".to_string()));
			let extra = {
				let conn = &mut *db.lock().unwrap();
				repo::profile::list_by_project(conn, &project.id)
					.unwrap()
					.into_iter()
					.filter(|profile| !profile.is_default)
					.collect::<Vec<_>>()
			};
			assert_eq!(extra.len(), 1);
			assert_eq!(extra[0].id, local.id);
			let mapping = {
				let conn = &mut *db.lock().unwrap();
				repo::runtime_mapping::find_profile_mapping(conn, &local.id)
			};
			assert!(mapping.is_err());
		}
	}

	#[test]
	fn herdr_without_client_does_not_spawn_local_worktree() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let logs = std::env::temp_dir().join("2code-profile-missing-herdr");
		std::fs::create_dir_all(&logs).ok();
		let ctx = PtyContext {
			db: db.clone(),
			sessions: infra::pty::create_session_map(),
			flush_senders: create_flush_senders(),
			read_threads: infra::pty::create_thread_tracker(),
			emitter: Arc::new(TestEmitter),
			output_dir: logs,
		};
		let router = RuntimeRouter::with_backend(
			RuntimeBackend::Herdr,
			LocalAdapter::new(ctx),
			HerdrStubAdapter::new(),
		);
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
	fn local_create_with_runtime_still_uses_git_worktree_add() {
		let mut conn = setup_db();
		let (project, dir) = create_project_with_git_repo(&mut conn);
		let global_base = TempDir::new().expect("worktree base");
		let db = pool_from(conn);
		let fake = FakeWorktrees::new();
		let router = local_router(&db, fake.clone());
		assert_eq!(router.selected_backend(), RuntimeBackend::Local);

		let profile = create_with_runtime(
			&router,
			&db,
			&project.id,
			"feat/local",
			Some(global_base.path().to_str().unwrap()),
		)
		.unwrap();

		assert_eq!(fake.creates(), 0);
		assert!(Path::new(&profile.worktree_path).exists());
		assert!(git_worktree_list(dir.path()).contains(&profile.worktree_path));
		let mapping = {
			let conn = &mut *db.lock().unwrap();
			repo::runtime_mapping::find_profile_mapping(conn, &profile.id)
		};
		assert!(mapping.is_err());
		delete_with_runtime(&router, &db, &profile.id).unwrap();
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
		assert!(!herdr.contains("worktree.remove"));
		assert!(!herdr.contains("git worktree add"));
		assert!(!herdr.contains("worktree_add"));
		assert!(!herdr.contains("workspace.create"));
		assert!(!herdr.contains("tab.create"));
		assert!(!herdr.contains("pane.close"));
		assert!(!herdr.contains("pane.split"));
		assert!(!herdr.contains("pane.send_input"));
		assert!(!herdr.contains("server.stop"));
		assert!(!herdr.contains("--takeover"));
		assert!(!herdr.contains("herdr-client.sock"));
		assert!(!herdr.contains("replace_profile_workspace"));
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
	fn default_profiles_are_not_created_via_worktree_create() {
		let src = include_str!("project.rs");
		assert!(src.contains("insert_default"));
		assert!(!src.contains("worktree.create"));
		assert!(!src.contains("create_herdr_with_db"));
		assert!(!src.contains("create_with_runtime"));
	}
}
