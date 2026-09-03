use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use infra::db::{init_db, DbPool};
use infra::pty::{create_session_map, create_thread_tracker, PtyReadThreads, PtySessionMap};
use model::error::AppError;
use model::project::{GitCommit, GitDiffStats, ProjectWithProfiles};
use model::pty::{PtyConfig, PtySessionMeta};
use service::pty::{create_flush_senders, PtyContext, PtyFlushSenders};
use service::PtyEventEmitter;

#[derive(Clone, Debug)]
pub struct ProfileVm {
	pub id: String,
	pub project_id: String,
	pub branch_name: String,
	pub worktree_path: String,
	pub is_default: bool,
}

#[derive(Clone, Debug)]
pub struct ProjectVm {
	pub id: String,
	pub name: String,
	pub folder: String,
	pub pinned_order: Option<i32>,
	pub group_id: Option<String>,
	pub profiles: Vec<ProfileVm>,
}

impl ProjectVm {
	pub fn from_project(project: ProjectWithProfiles) -> Self {
		Self {
			id: project.id,
			name: project.name,
			folder: project.folder,
			pinned_order: project.pinned_order,
			group_id: project.group_id,
			profiles: project
				.profiles
				.into_iter()
				.map(|profile| ProfileVm {
					id: profile.id,
					project_id: profile.project_id,
					branch_name: profile.branch_name,
					worktree_path: profile.worktree_path,
					is_default: profile.is_default,
				})
				.collect(),
		}
	}

	pub fn default_profile(&self) -> Option<&ProfileVm> {
		self.profiles
			.iter()
			.find(|profile| profile.is_default)
			.or_else(|| self.profiles.first())
	}
}

#[derive(Default)]
pub struct PtyBuffers {
	pub output: HashMap<String, String>,
	pub exited: Vec<String>,
}

pub struct GpuiPtyEmitter {
	buffers: Arc<Mutex<PtyBuffers>>,
}

impl PtyEventEmitter for GpuiPtyEmitter {
	fn emit_output(&self, session_id: &str, bytes: &[u8]) -> bool {
		let text = String::from_utf8_lossy(bytes);
		if let Ok(mut buffers) = self.buffers.lock() {
			buffers
				.output
				.entry(session_id.to_string())
				.or_default()
				.push_str(&text);
			true
		} else {
			false
		}
	}

	fn emit_exit(&self, session_id: &str) {
		if let Ok(mut buffers) = self.buffers.lock() {
			buffers.exited.push(session_id.to_string());
		}
	}
}

pub struct Backend {
	pub db: DbPool,
	pub sessions: PtySessionMap,
	pub flush_senders: PtyFlushSenders,
	pub read_threads: PtyReadThreads,
	pub emitter: Arc<GpuiPtyEmitter>,
	pub buffers: Arc<Mutex<PtyBuffers>>,
	pub output_dir: PathBuf,
	pub app_data_dir: PathBuf,
}

impl Backend {
	pub fn boot() -> Result<Self, String> {
		let app_data_dir = dirs::data_dir()
			.unwrap_or_else(|| PathBuf::from("."))
			.join("2code");
		let db = init_db(&app_data_dir)?;
		service::pty::mark_all_closed(&db);
		let output_dir = infra::pty_log::logs_dir(&app_data_dir);
		service::pty::gc_orphan_logs(&db, &output_dir);
		let buffers = Arc::new(Mutex::new(PtyBuffers::default()));
		let emitter = Arc::new(GpuiPtyEmitter {
			buffers: buffers.clone(),
		});
		Ok(Self {
			db,
			sessions: create_session_map(),
			flush_senders: create_flush_senders(),
			read_threads: create_thread_tracker(),
			emitter,
			buffers,
			output_dir,
			app_data_dir,
		})
	}

	fn pty_context(&self) -> PtyContext {
		PtyContext {
			db: self.db.clone(),
			sessions: self.sessions.clone(),
			flush_senders: self.flush_senders.clone(),
			read_threads: self.read_threads.clone(),
			emitter: self.emitter.clone(),
			output_dir: self.output_dir.clone(),
		}
	}

	pub fn settings_path(&self) -> PathBuf {
		self.app_data_dir.join("gpui-settings.json")
	}

	pub fn list_projects(&self) -> Result<Vec<ProjectVm>, AppError> {
		let conn = &mut *self.db.lock().map_err(|_| AppError::LockError)?;
		Ok(service::project::list(conn)?
			.into_iter()
			.map(ProjectVm::from_project)
			.collect())
	}

	pub fn create_project(
		&self,
		name: &str,
		folder: &str,
	) -> Result<ProjectVm, AppError> {
		let conn = &mut *self.db.lock().map_err(|_| AppError::LockError)?;
		let project = service::project::create_from_folder(conn, name, folder)?;
		let projects = service::project::list(conn)?;
		projects
			.into_iter()
			.find(|item| item.id == project.id)
			.map(ProjectVm::from_project)
			.ok_or_else(|| AppError::NotFound("Project".into()))
	}

	pub fn delete_project(&self, id: &str) -> Result<(), AppError> {
		service::project::delete_with_context(&self.pty_context(), id)
	}

	pub fn create_profile(
		&self,
		project_id: &str,
		branch_name: &str,
		default_worktree_dir: Option<&str>,
	) -> Result<ProfileVm, AppError> {
		let profile = service::profile::create_with_db(
			&self.db,
			project_id,
			branch_name,
			default_worktree_dir,
		)?;
		Ok(ProfileVm {
			id: profile.id,
			project_id: profile.project_id,
			branch_name: profile.branch_name,
			worktree_path: profile.worktree_path,
			is_default: profile.is_default,
		})
	}

	pub fn delete_profile(&self, id: &str) -> Result<(), AppError> {
		service::profile::delete_with_context(&self.pty_context(), id)
	}

	pub fn create_terminal(
		&self,
		profile_id: &str,
		cwd: &str,
		title: &str,
	) -> Result<String, AppError> {
		let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
		service::pty::create_session(
			&self.pty_context(),
			&PtySessionMeta {
				profile_id: profile_id.to_string(),
				title: title.to_string(),
			},
			&PtyConfig {
				shell,
				cwd: cwd.to_string(),
				rows: 32,
				cols: 120,
				startup_commands: Vec::new(),
			},
		)
	}

	pub fn write_pty(&self, session_id: &str, bytes: &[u8]) -> Result<(), AppError> {
		infra::pty::write_to_pty(&self.sessions, session_id, bytes)
	}

	pub fn close_terminal(&self, session_id: &str) -> Result<(), AppError> {
		service::pty::close_session_full(
			&self.sessions,
			&self.flush_senders,
			&self.output_dir,
			session_id,
		)
	}

	pub fn take_output(&self, session_id: &str) -> String {
		self.buffers
			.lock()
			.ok()
			.and_then(|buffers| buffers.output.get(session_id).cloned())
			.unwrap_or_default()
	}

	pub fn git_branch(&self, folder: &str) -> String {
		service::project::get_branch(folder).unwrap_or_default()
	}

	pub fn git_diff_stats(&self, profile_id: &str) -> GitDiffStats {
		let Ok(mut conn) = self.db.lock() else {
			return GitDiffStats::default();
		};
		service::project::get_diff_stats(&mut conn, profile_id).unwrap_or_default()
	}

	pub fn git_diff(&self, profile_id: &str) -> String {
		let Ok(mut conn) = self.db.lock() else {
			return String::new();
		};
		service::project::get_diff(&mut conn, profile_id).unwrap_or_default()
	}

	pub fn git_log(&self, profile_id: &str) -> Vec<GitCommit> {
		let Ok(mut conn) = self.db.lock() else {
			return Vec::new();
		};
		service::project::get_log(&mut conn, profile_id, 20).unwrap_or_default()
	}

	pub fn list_files(&self, profile_id: &str) -> Vec<String> {
		service::filesystem::list_file_tree_child_paths(&self.db, profile_id, None)
			.unwrap_or_default()
			.into_iter()
			.take(80)
			.collect()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn project_vm_prefers_default_profile() {
		let project = ProjectVm {
			id: "p1".into(),
			name: "Demo".into(),
			folder: "/tmp/demo".into(),
			pinned_order: None,
			group_id: None,
			profiles: vec![
				ProfileVm {
					id: "a".into(),
					project_id: "p1".into(),
					branch_name: "feat".into(),
					worktree_path: "/tmp/demo-feat".into(),
					is_default: false,
				},
				ProfileVm {
					id: "b".into(),
					project_id: "p1".into(),
					branch_name: "main".into(),
					worktree_path: "/tmp/demo".into(),
					is_default: true,
				},
			],
		};
		assert_eq!(project.default_profile().map(|p| p.id.as_str()), Some("b"));
	}

	#[test]
	fn pty_emitter_appends_utf8_output() {
		let buffers = Arc::new(Mutex::new(PtyBuffers::default()));
		let emitter = GpuiPtyEmitter {
			buffers: buffers.clone(),
		};
		assert!(emitter.emit_output("s1", b"hello "));
		assert!(emitter.emit_output("s1", b"world"));
		emitter.emit_exit("s1");
		let buffers = buffers.lock().unwrap();
		assert_eq!(buffers.output.get("s1").unwrap(), "hello world");
		assert_eq!(buffers.exited, vec!["s1".to_string()]);
	}
}
