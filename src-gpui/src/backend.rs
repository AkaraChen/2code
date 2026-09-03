use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};

use infra::db::{init_db, DbPool};
use infra::pty::{self as pty_infra, PtyReadThreads, PtySessionMap};
use model::error::AppError;
use model::filesystem::{FilePreview, FileSearchResult, FileTreeGitStatusEntry};
use model::profile::{Profile, ProfileDeleteCheck};
use model::project::{
	GitBranchInfo, GitCommit, GitDiffSnapshot, GitDiffStats, GitPullRequestStatus, Project, ProjectConfig,
	ProjectSidebarLayoutUpdate, ProjectWithProfiles,
};
use model::project_group::ProjectGroup;
use model::pty::{PtyConfig, PtySessionMeta, PtySessionRecord};
use service::pty::{PtyContext, PtyFlushSenders, PtyLogDir};
use service::{PtyEventEmitter, WatchEventSender};

pub type TerminalBuffers = Arc<Mutex<HashMap<String, Vec<u8>>>>;
pub type TerminalExits = Arc<Mutex<Vec<String>>>;
pub type WatchInbox = Arc<Mutex<Vec<model::watcher::WatchEvent>>>;

pub struct GpuiPtyEmitter {
	buffers: TerminalBuffers,
	exits: TerminalExits,
}

impl PtyEventEmitter for GpuiPtyEmitter {
	fn emit_output(&self, session_id: &str, bytes: &[u8]) -> bool {
		if let Ok(mut map) = self.buffers.lock() {
			map.entry(session_id.to_string()).or_default().extend_from_slice(bytes);
		}
		true
	}

	fn emit_exit(&self, session_id: &str) {
		if let Ok(mut exits) = self.exits.lock() {
			exits.push(session_id.to_string());
		}
	}
}

struct GpuiWatchSender {
	events: WatchInbox,
}

impl WatchEventSender for GpuiWatchSender {
	fn send(&self, event: model::watcher::WatchEvent) -> bool {
		if let Ok(mut queue) = self.events.lock() {
			queue.push(event);
		}
		true
	}
}

struct NoopWatchSender;

impl WatchEventSender for NoopWatchSender {
	fn send(&self, _event: model::watcher::WatchEvent) -> bool {
		true
	}
}

#[derive(Clone)]
pub struct Backend {
	pub db: DbPool,
	pub app_data_dir: PathBuf,
	pub sessions: PtySessionMap,
	pub flush_senders: PtyFlushSenders,
	pub read_threads: PtyReadThreads,
	pub output_dir: PathBuf,
	pub buffers: TerminalBuffers,
	pub exits: TerminalExits,
	pub watch_events: WatchInbox,
}

impl Backend {
	pub fn init() -> Result<Self, String> {
		let app_data_dir = app_data_dir();
		std::fs::create_dir_all(&app_data_dir).map_err(|e| format!("create app data dir: {e}"))?;

		let db = init_db(&app_data_dir)?;
		service::pty::mark_all_closed(&db);
		let output_dir = infra::pty_log::logs_dir(&app_data_dir);
		service::pty::gc_orphan_logs(&db, &output_dir);

		let buffers = Arc::new(Mutex::new(HashMap::new()));
		let exits = Arc::new(Mutex::new(Vec::new()));
		let watch_events = Arc::new(Mutex::new(Vec::new()));
		service::watcher::start(
			Box::new(GpuiWatchSender {
				events: watch_events.clone(),
			}),
			db.clone(),
			infra::watcher::create_shutdown_flag(),
		);

		Ok(Self {
			db,
			app_data_dir,
			sessions: pty_infra::create_session_map(),
			flush_senders: service::pty::create_flush_senders(),
			read_threads: pty_infra::create_thread_tracker(),
			output_dir,
			buffers,
			exits,
			watch_events,
		})
	}

	fn pty_ctx(&self) -> PtyContext {
		PtyContext {
			db: self.db.clone(),
			sessions: self.sessions.clone(),
			flush_senders: self.flush_senders.clone(),
			read_threads: self.read_threads.clone(),
			emitter: Arc::new(GpuiPtyEmitter {
				buffers: self.buffers.clone(),
				exits: self.exits.clone(),
			}),
			output_dir: self.output_dir.clone(),
		}
	}

	fn with_db<T>(
		&self,
		f: impl FnOnce(&mut diesel::sqlite::SqliteConnection) -> Result<T, AppError>,
	) -> Result<T, AppError> {
		let mut conn = self.db.lock().map_err(|_| AppError::LockError)?;
		f(&mut conn)
	}

	pub fn list_projects(&self) -> Result<Vec<ProjectWithProfiles>, AppError> {
		self.with_db(service::project::list)
	}

	pub fn list_groups(&self) -> Result<Vec<ProjectGroup>, AppError> {
		self.with_db(service::project::list_groups)
	}

	pub fn create_project(&self, name: &str, folder: &str) -> Result<Project, AppError> {
		self.with_db(|conn| service::project::create_from_folder(conn, name, folder))
	}

	pub fn rename_project(&self, id: &str, name: &str) -> Result<Project, AppError> {
		self.with_db(|conn| service::project::update(conn, id, Some(name.to_string()), None))
	}

	pub fn delete_project(&self, id: &str) -> Result<(), AppError> {
		service::project::delete_with_context(&self.pty_ctx(), id)
	}

	pub fn create_group(&self, name: &str) -> Result<ProjectGroup, AppError> {
		self.with_db(|conn| service::project::create_group(conn, name))
	}

	pub fn assign_to_group(&self, project_id: &str, group_id: Option<String>) -> Result<Project, AppError> {
		self.with_db(|conn| service::project::assign_to_group(conn, project_id, group_id))
	}

	pub fn update_sidebar_layout(&self, updates: Vec<ProjectSidebarLayoutUpdate>) -> Result<(), AppError> {
		self.with_db(|conn| service::project::update_sidebar_layout(conn, updates))
	}

	pub fn create_profile(&self, project_id: &str, branch_name: &str) -> Result<Profile, AppError> {
		self.with_db(|conn| service::profile::create(conn, project_id, branch_name))
	}

	pub fn delete_profile(&self, id: &str) -> Result<(), AppError> {
		service::profile::delete_with_context(&self.pty_ctx(), id)
	}

	pub fn delete_profile_check(&self, id: &str) -> Result<ProfileDeleteCheck, AppError> {
		self.with_db(|conn| service::profile::delete_check(conn, id))
	}

	pub fn update_notes(&self, profile_id: &str, notes: &str) -> Result<(), AppError> {
		self.with_db(|conn| repo::profile::update_notes(conn, profile_id, notes).map(|_| ()))
	}

	pub fn git_branch(&self, folder: &str) -> Result<String, AppError> {
		service::project::get_branch(folder)
	}

	pub fn git_diff_stats(&self, profile_id: &str) -> Result<GitDiffStats, AppError> {
		self.with_db(|conn| service::project::get_diff_stats(conn, profile_id))
	}

	pub fn git_diff(&self, profile_id: &str) -> Result<String, AppError> {
		self.with_db(|conn| service::project::get_diff(conn, profile_id))
	}

	pub fn git_diff_snapshot(&self, profile_id: &str) -> Result<GitDiffSnapshot, AppError> {
		self.with_db(|conn| {
			let profile = repo::profile::find_by_id(conn, profile_id)?;
			infra::git::diff_snapshot(&profile.worktree_path)
		})
	}

	pub fn git_log(&self, profile_id: &str, limit: u32) -> Result<Vec<GitCommit>, AppError> {
		self.with_db(|conn| service::project::get_log(conn, profile_id, limit))
	}

	pub fn commit_diff(&self, profile_id: &str, hash: &str) -> Result<String, AppError> {
		self.with_db(|conn| service::project::get_commit_diff(conn, profile_id, hash))
	}

	pub fn commit_changes(
		&self,
		profile_id: &str,
		files: &[String],
		message: &str,
		body: Option<&str>,
	) -> Result<String, AppError> {
		self.with_db(|conn| service::project::commit_changes(conn, profile_id, files, message, body))
	}

	pub fn discard_file(&self, profile_id: &str, paths: &[String]) -> Result<(), AppError> {
		self.with_db(|conn| service::project::discard_file_changes(conn, profile_id, paths))
	}

	pub fn git_ahead(&self, profile_id: &str) -> Result<u32, AppError> {
		self.with_db(|conn| service::project::get_ahead_count(conn, profile_id))
	}

	pub fn git_push(&self, profile_id: &str) -> Result<(), AppError> {
		self.with_db(|conn| service::project::push(conn, profile_id))
	}

	pub fn list_branches(&self, folder: &str) -> Result<Vec<GitBranchInfo>, AppError> {
		infra::git::list_branches(folder)
	}

	pub fn checkout_branch(&self, folder: &str, branch: &str) -> Result<(), AppError> {
		infra::git::checkout_branch(folder, branch)
	}

	pub fn pr_status(&self, folder: &str, branch: Option<&str>) -> Result<Option<GitPullRequestStatus>, AppError> {
		service::project::get_pull_request_status_for_folder(folder, branch)
	}

	pub fn project_config(&self, project_id: &str) -> Result<ProjectConfig, AppError> {
		let folder = self.with_db(|conn| Ok(repo::project::find_by_id(conn, project_id)?.folder))?;
		Ok(infra::config::load_project_config(&folder).unwrap_or_default())
	}

	pub fn save_project_config(&self, project_id: &str, config: &ProjectConfig) -> Result<(), AppError> {
		let folder = self.with_db(|conn| Ok(repo::project::find_by_id(conn, project_id)?.folder))?;
		infra::config::write_project_config(&folder, config)
	}

	pub fn github_avatar(&self, project_id: &str) -> Option<String> {
		self.with_db(|conn| {
			let folder = repo::project::find_by_id(conn, project_id)?.folder;
			Ok(infra::git::github_avatar_url(&folder))
		})
		.ok()
		.flatten()
	}

	pub fn list_tree_children(&self, profile_id: &str, relative: Option<&str>) -> Result<Vec<String>, AppError> {
		service::filesystem::list_file_tree_child_paths(&self.db, profile_id, relative)
	}

	pub fn tree_git_status(&self, profile_id: &str) -> Result<Vec<FileTreeGitStatusEntry>, AppError> {
		self.with_db(|conn| service::filesystem::get_file_tree_git_status(conn, profile_id))
	}

	pub fn search_files(&self, profile_id: &str, query: &str) -> Result<Vec<FileSearchResult>, AppError> {
		self.with_db(|conn| service::filesystem::search_file(conn, profile_id, query))
	}

	pub fn read_file(&self, profile_id: &str, path: &str) -> Result<String, AppError> {
		service::filesystem::read_file_content(&self.db, profile_id, path)
	}

	pub fn write_file(&self, profile_id: &str, path: &str, content: &str) -> Result<(), AppError> {
		service::filesystem::write_file_content(&self.db, profile_id, path, content)
	}

	pub fn file_preview(&self, profile_id: &str, path: &str) -> Result<FilePreview, AppError> {
		let file_cache = self.app_data_dir.join("file-preview");
		let office_cache = self.app_data_dir.join("office-preview");
		let _ = std::fs::create_dir_all(&file_cache);
		let _ = std::fs::create_dir_all(&office_cache);
		service::filesystem::get_file_preview(&self.db, profile_id, path, &file_cache, &office_cache)
	}

	pub fn create_path(&self, profile_id: &str, path: &str, is_dir: bool) -> Result<(), AppError> {
		service::filesystem::create_file_tree_path(
			&self.db,
			profile_id,
			path,
			if is_dir { "directory" } else { "file" },
		)
	}

	pub fn rename_path(&self, profile_id: &str, from: &str, to: &str) -> Result<(), AppError> {
		service::filesystem::rename_file_tree_path(&self.db, profile_id, from, to)
	}

	pub fn delete_paths(&self, profile_id: &str, paths: &[String]) -> Result<(), AppError> {
		service::filesystem::delete_file_tree_paths(&self.db, profile_id, paths)
	}

	pub fn reveal_path(&self, profile_id: &str, path: Option<&str>) -> Result<(), AppError> {
		service::filesystem::reveal_path_in_file_manager(&self.db, profile_id, path)
	}

	pub fn open_in_default_app(&self, profile_id: &str, path: &str) -> Result<(), AppError> {
		service::filesystem::open_path_in_default_app(&self.db, profile_id, path)
	}

	pub fn create_terminal(
		&self,
		profile_id: &str,
		title: &str,
		cwd: &str,
		shell: &str,
		startup_commands: Vec<String>,
	) -> Result<String, AppError> {
		let ctx = self.pty_ctx();
		service::pty::create_session(
			&ctx,
			&PtySessionMeta {
				profile_id: profile_id.to_string(),
				title: title.to_string(),
			},
			&PtyConfig {
				shell: shell.to_string(),
				cwd: cwd.to_string(),
				rows: 32,
				cols: 120,
				startup_commands,
			},
		)
	}

	pub fn write_pty(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
		pty_infra::write_to_pty(&self.sessions, session_id, data)
	}

	pub fn resize_pty(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), AppError> {
		pty_infra::resize_pty(&self.sessions, session_id, rows, cols)
	}

	pub fn close_terminal(&self, session_id: &str) -> Result<(), AppError> {
		service::pty::close_session_full(&self.sessions, &self.flush_senders, &self.output_dir, session_id)?;
		self.with_db(|conn| {
			repo::pty::mark_closed(conn, session_id);
			Ok(())
		})
	}

	pub fn find_project(&self, id: &str) -> Result<Project, AppError> {
		self.with_db(|conn| repo::project::find_by_id(conn, id))
	}

	pub fn find_profile(&self, id: &str) -> Result<Profile, AppError> {
		self.with_db(|conn| repo::profile::find_by_id(conn, id))
	}

	pub fn worktree_path(&self, profile_id: &str) -> Result<String, AppError> {
		self.with_db(|conn| Ok(repo::profile::find_by_id(conn, profile_id)?.worktree_path))
	}

	pub fn set_pinned(&self, project_id: &str, pinned: bool) -> Result<(), AppError> {
		let project = self.find_project(project_id)?;
		self.update_sidebar_layout(vec![ProjectSidebarLayoutUpdate {
			kind: "project".into(),
			id: project_id.into(),
			group_id: project.group_id,
			sort_order: Some(project.sort_order),
			pinned_order: if pinned {
				Some(project.pinned_order.unwrap_or(0))
			} else {
				None
			},
		}])
	}

	pub fn move_project(&self, project_id: &str, delta: i32) -> Result<(), AppError> {
		let projects = self.list_projects()?;
		let Some(project) = projects.iter().find(|p| p.id == project_id).cloned() else {
			return Ok(());
		};
		let mut bucket: Vec<_> = projects
			.into_iter()
			.filter(|p| {
				if project.pinned_at.is_some() {
					p.pinned_at.is_some()
				} else {
					p.pinned_at.is_none() && p.group_id == project.group_id
				}
			})
			.collect();
		if project.pinned_at.is_some() {
			bucket.sort_by_key(|p| p.pinned_order.unwrap_or(0));
		} else {
			bucket.sort_by_key(|p| p.sort_order);
		}
		let Some(ix) = bucket.iter().position(|p| p.id == project_id) else {
			return Ok(());
		};
		let next = (ix as i32 + delta).clamp(0, bucket.len() as i32 - 1) as usize;
		if next == ix {
			return Ok(());
		}
		bucket.swap(ix, next);
		let updates = bucket
			.iter()
			.enumerate()
			.map(|(i, p)| ProjectSidebarLayoutUpdate {
				kind: "project".into(),
				id: p.id.clone(),
				group_id: p.group_id.clone(),
				sort_order: Some(if p.pinned_at.is_some() { p.sort_order } else { i as i32 }),
				pinned_order: if p.pinned_at.is_some() { Some(i as i32) } else { None },
			})
			.collect();
		self.update_sidebar_layout(updates)
	}

	pub fn drop_project(&self, dragged: &str, target: Option<&str>, unpin: bool) -> Result<(), AppError> {
		let project = self.find_project(dragged)?;
		if unpin {
			return self.update_sidebar_layout(vec![ProjectSidebarLayoutUpdate {
				kind: "project".into(),
				id: project.id,
				group_id: None,
				sort_order: Some(project.sort_order),
				pinned_order: None,
			}]);
		}
		let Some(target) = target else {
			return Ok(());
		};
		if target == dragged {
			return Ok(());
		}
		let dest = self.find_project(target)?;
		self.update_sidebar_layout(vec![ProjectSidebarLayoutUpdate {
			kind: "project".into(),
			id: project.id,
			group_id: dest.group_id,
			sort_order: Some(dest.sort_order.saturating_sub(1)),
			pinned_order: dest.pinned_order,
		}])
	}

	pub fn list_sessions(&self, project_id: &str) -> Result<Vec<PtySessionRecord>, AppError> {
		self.with_db(|conn| service::pty::list_project_sessions(conn, project_id))
	}

	pub fn list_all_sessions(&self) -> Result<Vec<PtySessionRecord>, AppError> {
		let projects = self.list_projects()?;
		let mut sessions = Vec::new();
		for project in projects {
			sessions.extend(self.list_sessions(&project.id)?);
		}
		Ok(sessions)
	}

	pub fn restore_session(&self, record: &PtySessionRecord) -> Result<(String, Vec<u8>), AppError> {
		let ctx = self.pty_ctx();
		let result = service::pty::restore_session(
			&ctx,
			&record.id,
			&PtySessionMeta {
				profile_id: record.profile_id.clone(),
				title: record.title.clone(),
			},
			&PtyConfig {
				shell: record.shell.clone(),
				cwd: record.cwd.clone(),
				rows: record.rows.max(1) as u16,
				cols: record.cols.max(1) as u16,
				startup_commands: Vec::new(),
			},
		)?;
		Ok((result.new_session_id, result.history))
	}

	pub fn take_watch_events(&self) -> Vec<model::watcher::WatchEvent> {
		self.watch_events
			.lock()
			.ok()
			.map(|mut q| q.drain(..).collect())
			.unwrap_or_default()
	}

	pub fn resolve_file(&self, profile_id: &str, path: &str) -> Result<model::filesystem::ResolvedFilePath, AppError> {
		service::filesystem::resolve_terminal_file_path(&self.db, profile_id, path)
	}

	pub fn take_output(&self, session_id: &str) -> Vec<u8> {
		self.buffers
			.lock()
			.ok()
			.and_then(|mut map| map.remove(session_id))
			.unwrap_or_default()
	}

	pub fn shutdown(&self) {
		pty_infra::close_all_sessions(&self.sessions);
		pty_infra::join_all_read_threads(&self.read_threads);
		service::pty::mark_all_closed(&self.db);
	}
}

pub fn app_data_dir() -> PathBuf {
	if let Some(dir) = dirs::data_dir() {
		return dir.join("com.akrc.code");
	}
	PathBuf::from(".").join(".2code")
}

pub fn pick_folder() -> Option<String> {
	rfd::FileDialog::new()
		.set_title("Choose Folder")
		.pick_folder()
		.map(|p| p.to_string_lossy().into_owned())
}

pub fn default_shell() -> String {
	std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
}

#[allow(dead_code)]
pub fn _log_dir(backend: &Backend) -> PtyLogDir {
	PtyLogDir(backend.output_dir.clone())
}

#[allow(dead_code)]
pub fn _watch_noop() -> Box<dyn WatchEventSender> {
	Box::new(NoopWatchSender)
}

#[allow(dead_code)]
pub fn _channel<T>() -> (mpsc::Sender<T>, mpsc::Receiver<T>) {
	mpsc::channel()
}

pub fn is_previewable(path: &str) -> bool {
	let lower = path.to_ascii_lowercase();
	[
		".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".pdf", ".zip", ".tar", ".gz", ".tgz", ".docx",
		".xlsx", ".pptx",
	]
	.iter()
	.any(|ext| lower.ends_with(ext))
}

pub fn is_image(path: &str) -> bool {
	let lower = path.to_ascii_lowercase();
	[
		".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tif", ".tiff",
	]
	.iter()
	.any(|ext| lower.ends_with(ext))
}

pub fn is_markdown(path: &str) -> bool {
	let lower = path.to_ascii_lowercase();
	lower.ends_with(".md") || lower.ends_with(".mdx")
}

pub fn file_name(path: &str) -> String {
	Path::new(path)
		.file_name()
		.map(|s| s.to_string_lossy().into_owned())
		.unwrap_or_else(|| path.to_string())
}
