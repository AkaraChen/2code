use std::path::Path;
use std::process::Command;

use model::error::AppError;
pub use model::project::ProjectConfig;

pub fn load_project_config(
	project_folder: &str,
) -> Result<ProjectConfig, AppError> {
	let config_path = Path::new(project_folder).join("2code.json");
	if !config_path.exists() {
		return Ok(ProjectConfig::default());
	}

	let content = std::fs::read_to_string(&config_path)?;
	serde_json::from_str(&content).map_err(|e| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::InvalidData,
			format!("Failed to parse 2code.json: {e}"),
		))
	})
}

pub fn write_project_config(
	project_folder: &str,
	config: &ProjectConfig,
) -> Result<(), AppError> {
	let config_path = Path::new(project_folder).join("2code.json");
	let content = serde_json::to_string_pretty(config).map_err(|e| {
		AppError::IoError(std::io::Error::new(
			std::io::ErrorKind::InvalidData,
			format!("Failed to serialize 2code.json: {e}"),
		))
	})?;
	std::fs::write(&config_path, content)?;
	Ok(())
}

pub fn execute_scripts(scripts: &[String], cwd: &Path) {
	if !cwd.exists() {
		tracing::warn!("Script cwd does not exist: {}", cwd.display());
		return;
	}

	for script in scripts {
		let result = Command::new("sh")
			.arg("-c")
			.arg(script)
			.current_dir(cwd)
			.output();

		match result {
			Ok(output) if !output.status.success() => {
				let stderr = String::from_utf8_lossy(&output.stderr);
				tracing::warn!("Script failed: {script} — {stderr}");
				return;
			}
			Err(e) => {
				tracing::warn!("Script execution error: {script} — {e}");
				return;
			}
			_ => {}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;
	use tempfile::TempDir;

	fn setup_config(dir: &Path, content: &str) {
		fs::write(dir.join("2code.json"), content).unwrap();
	}

	#[test]
	fn load_valid_config() {
		let dir = TempDir::new().unwrap();
		setup_config(
			dir.path(),
			r#"{"setup_script": ["npm install"], "teardown_script": ["rm -rf node_modules"]}"#,
		);

		let config = load_project_config(dir.path().to_str().unwrap()).unwrap();
		assert_eq!(config.setup_script, vec!["npm install"]);
		assert_eq!(config.teardown_script, vec!["rm -rf node_modules"]);
	}

	#[test]
	fn load_missing_file() {
		let dir = TempDir::new().unwrap();
		let config = load_project_config(dir.path().to_str().unwrap()).unwrap();
		assert_eq!(config, ProjectConfig::default());
	}

	#[test]
	fn load_missing_fields() {
		let dir = TempDir::new().unwrap();
		setup_config(dir.path(), r#"{"setup_script": ["echo hi"]}"#);

		let config = load_project_config(dir.path().to_str().unwrap()).unwrap();
		assert_eq!(config.setup_script, vec!["echo hi"]);
		assert!(config.teardown_script.is_empty());
	}

	#[test]
	fn load_empty_object() {
		let dir = TempDir::new().unwrap();
		setup_config(dir.path(), "{}");

		let config = load_project_config(dir.path().to_str().unwrap()).unwrap();
		assert!(config.setup_script.is_empty());
		assert!(config.teardown_script.is_empty());
		assert!(config.init_script.is_empty());
	}

	#[test]
	fn load_init_script() {
		let dir = TempDir::new().unwrap();
		setup_config(
			dir.path(),
			r#"{"init_script": ["echo hello", "export FOO=bar"]}"#,
		);

		let config = load_project_config(dir.path().to_str().unwrap()).unwrap();
		assert_eq!(config.init_script, vec!["echo hello", "export FOO=bar"]);
		assert!(config.setup_script.is_empty());
	}

	#[test]
	fn load_invalid_json() {
		let dir = TempDir::new().unwrap();
		setup_config(dir.path(), "not json");

		let result = load_project_config(dir.path().to_str().unwrap());
		assert!(result.is_err());
	}

	#[test]
	fn execute_scripts_success() {
		let dir = TempDir::new().unwrap();
		let scripts = vec!["echo hello".to_string()];
		execute_scripts(&scripts, dir.path());
	}

	#[test]
	fn execute_scripts_missing_cwd() {
		let scripts = vec!["echo hello".to_string()];
		execute_scripts(&scripts, Path::new("/nonexistent/path"));
	}

	#[test]
	fn execute_scripts_failing_script() {
		let dir = TempDir::new().unwrap();
		let scripts = vec!["exit 1".to_string()];
		execute_scripts(&scripts, dir.path());
	}

	#[test]
	fn execute_scripts_stops_on_first_failure() {
		let dir = TempDir::new().unwrap();
		let marker = dir.path().join("marker.txt");
		let scripts = vec![
			"exit 1".to_string(),
			format!("touch {}", marker.display()),
		];
		execute_scripts(&scripts, dir.path());
		assert!(
			!marker.exists(),
			"second script should not execute after first fails"
		);
	}

	#[test]
	fn execute_scripts_empty_list() {
		let dir = TempDir::new().unwrap();
		execute_scripts(&[], dir.path());
	}

	#[test]
	fn write_config_round_trip() {
		let dir = TempDir::new().unwrap();
		let config = ProjectConfig {
			setup_script: vec!["npm install".to_string()],
			teardown_script: vec!["rm -rf node_modules".to_string()],
			init_script: vec!["echo ready".to_string()],
		};

		write_project_config(dir.path().to_str().unwrap(), &config).unwrap();

		let loaded = load_project_config(dir.path().to_str().unwrap()).unwrap();
		assert_eq!(loaded, config);
	}
}
