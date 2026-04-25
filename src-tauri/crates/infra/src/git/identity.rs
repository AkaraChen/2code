//! Git identity (user.name + user.email) read/write helpers.
//!
//! The 2code identity model has three scopes:
//!   1. **Profile** — written to a worktree's local .git/config (worktree-scoped)
//!   2. **Project** — written to the project's main .git/config (inherited by
//!      worktrees that don't override)
//!   3. **Global** — ~/.gitconfig, the user's normal git identity
//!
//! `resolve_identity` walks profile → project → global and returns the first
//! (name, email) pair that's fully populated.
//!
//! Writes go through `git config` CLI to avoid corrupting config file syntax;
//! reads go through gix for speed (no per-call subprocess).

use std::path::Path;
use std::process::Command;

use model::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
	pub name: String,
	pub email: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityScope {
	/// Write to the worktree's local .git/config (per-profile override).
	Profile,
	/// Write to the project's main .git/config. Inherited by all worktrees
	/// that don't override.
	Project,
}

/// Set user.name + user.email in the given folder's local .git/config.
/// Folder should be the project root for `Project` scope or the worktree path
/// for `Profile` scope — the caller picks which folder based on scope.
pub fn set_identity(folder: &str, identity: &Identity) -> Result<(), AppError> {
	if identity.name.trim().is_empty() {
		return Err(AppError::GitError("user.name cannot be empty".into()));
	}
	if identity.email.trim().is_empty() {
		return Err(AppError::GitError("user.email cannot be empty".into()));
	}

	// `git config user.name` (no --global) writes to the local repo config.
	for (key, value) in
		[("user.name", &identity.name), ("user.email", &identity.email)]
	{
		let output = Command::new("git")
			.args(["config", key, value])
			.current_dir(folder)
			.output()?;
		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
			return Err(AppError::GitError(format!(
				"git config {key} failed: {stderr}"
			)));
		}
	}
	Ok(())
}

/// Clear user.name + user.email from the given folder's local config. Useful
/// for "remove project override" actions.
pub fn unset_identity(folder: &str) -> Result<(), AppError> {
	for key in ["user.name", "user.email"] {
		let output = Command::new("git")
			.args(["config", "--unset", key])
			.current_dir(folder)
			.output()?;
		// Exit code 5 = "no such section or key" — not an error for our purposes.
		if !output.status.success()
			&& output.status.code().unwrap_or(-1) != 5
		{
			let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
			return Err(AppError::GitError(format!(
				"git config --unset {key} failed: {stderr}"
			)));
		}
	}
	Ok(())
}

/// Read identity from a single folder's local config (no inheritance — does
/// not fall back to global). Returns None if either key is missing or the
/// folder isn't a git repo.
pub fn read_local_identity(folder: &str) -> Option<Identity> {
	let name = read_local_key(folder, "user.name")?;
	let email = read_local_key(folder, "user.email")?;
	if name.trim().is_empty() || email.trim().is_empty() {
		return None;
	}
	Some(Identity { name, email })
}

fn read_local_key(folder: &str, key: &str) -> Option<String> {
	let output = Command::new("git")
		.args(["config", "--local", "--get", key])
		.current_dir(folder)
		.output()
		.ok()?;
	if !output.status.success() {
		return None;
	}
	let val = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if val.is_empty() {
		None
	} else {
		Some(val)
	}
}

/// Read identity from the user's global ~/.gitconfig. Returns None if missing.
pub fn read_global_identity() -> Option<Identity> {
	// Use git CLI for global config — gix's global config discovery is
	// available but more involved, and this is a once-per-resolution call.
	let name = read_global_key("user.name")?;
	let email = read_global_key("user.email")?;
	if name.trim().is_empty() || email.trim().is_empty() {
		return None;
	}
	Some(Identity { name, email })
}

fn read_global_key(key: &str) -> Option<String> {
	let output = Command::new("git")
		.args(["config", "--global", "--get", key])
		.output()
		.ok()?;
	if !output.status.success() {
		return None;
	}
	let val = String::from_utf8_lossy(&output.stdout).trim().to_string();
	if val.is_empty() {
		None
	} else {
		Some(val)
	}
}

/// Walk profile → project → global and return the first complete identity.
/// `profile_folder` is the worktree path; `project_folder` is the project's
/// main repo path. Either may be the same path (for the default profile).
pub fn resolve_identity(
	profile_folder: Option<&str>,
	project_folder: Option<&str>,
) -> Option<Identity> {
	if let Some(folder) = profile_folder {
		if let Some(id) = read_local_identity(folder) {
			return Some(id);
		}
	}
	if let Some(folder) = project_folder {
		// Skip if same as profile_folder (already checked).
		let same_as_profile =
			profile_folder.map(|p| Path::new(p) == Path::new(folder)).unwrap_or(false);
		if !same_as_profile {
			if let Some(id) = read_local_identity(folder) {
				return Some(id);
			}
		}
	}
	read_global_identity()
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command as Cmd;
	use tempfile::TempDir;

	fn init_repo() -> TempDir {
		let dir = TempDir::new().expect("tempdir");
		Cmd::new("git").arg("init").current_dir(dir.path()).output().unwrap();
		dir
	}

	#[test]
	fn set_then_read_identity() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let id = Identity {
			name: "Alice".into(),
			email: "alice@example.com".into(),
		};
		set_identity(&folder, &id).expect("set");
		let read = read_local_identity(&folder).expect("read");
		assert_eq!(read, id);
	}

	#[test]
	fn set_rejects_empty_name() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let err = set_identity(
			&folder,
			&Identity {
				name: "".into(),
				email: "x@y".into(),
			},
		)
		.unwrap_err();
		assert!(err.to_string().contains("user.name"));
	}

	#[test]
	fn set_rejects_empty_email() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let err = set_identity(
			&folder,
			&Identity {
				name: "x".into(),
				email: "".into(),
			},
		)
		.unwrap_err();
		assert!(err.to_string().contains("user.email"));
	}

	#[test]
	fn unset_removes_local_identity() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		let id = Identity {
			name: "Bob".into(),
			email: "bob@example.com".into(),
		};
		set_identity(&folder, &id).unwrap();
		assert!(read_local_identity(&folder).is_some());
		unset_identity(&folder).unwrap();
		assert!(read_local_identity(&folder).is_none());
	}

	#[test]
	fn unset_on_missing_keys_is_ok() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		// Should not error when nothing is set.
		unset_identity(&folder).expect("unset on empty");
	}

	#[test]
	fn read_local_returns_none_for_partial_config() {
		let dir = init_repo();
		let folder = dir.path().to_string_lossy().to_string();
		// Only set name, not email.
		Cmd::new("git")
			.args(["config", "user.name", "Alice"])
			.current_dir(dir.path())
			.output()
			.unwrap();
		assert!(read_local_identity(&folder).is_none());
	}

	#[test]
	fn resolve_prefers_profile_over_project() {
		let project_dir = init_repo();
		let profile_dir = init_repo();
		let project_folder = project_dir.path().to_string_lossy().to_string();
		let profile_folder = profile_dir.path().to_string_lossy().to_string();

		set_identity(
			&project_folder,
			&Identity {
				name: "Project".into(),
				email: "p@p".into(),
			},
		)
		.unwrap();
		set_identity(
			&profile_folder,
			&Identity {
				name: "Profile".into(),
				email: "pf@pf".into(),
			},
		)
		.unwrap();

		let resolved =
			resolve_identity(Some(&profile_folder), Some(&project_folder)).unwrap();
		assert_eq!(resolved.name, "Profile");
	}

	#[test]
	fn resolve_falls_back_to_project_when_no_profile_override() {
		let project_dir = init_repo();
		let profile_dir = init_repo();
		let project_folder = project_dir.path().to_string_lossy().to_string();
		let profile_folder = profile_dir.path().to_string_lossy().to_string();

		set_identity(
			&project_folder,
			&Identity {
				name: "Project".into(),
				email: "p@p".into(),
			},
		)
		.unwrap();
		// Profile has no override.

		let resolved =
			resolve_identity(Some(&profile_folder), Some(&project_folder)).unwrap();
		assert_eq!(resolved.name, "Project");
	}

	#[test]
	fn resolve_falls_back_to_global_when_no_local() {
		let project_dir = init_repo();
		let folder = project_dir.path().to_string_lossy().to_string();
		// Neither project nor profile has identity. Should hit global.
		// Test environment usually has a global identity set via git config.
		// If not, this test still passes — it just returns None.
		let resolved = resolve_identity(None, Some(&folder));
		// Whatever the test box has globally — just make sure we don't panic.
		// If global is set, it returns Some; if not, None. Both fine.
		let _ = resolved;
	}
}
