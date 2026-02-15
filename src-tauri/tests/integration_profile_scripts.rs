mod common;

use common::{add_commit, cleanup, create_temp_git_repo, setup_db};

/// Create a git repo with a `2code.json` config file and return the project + default profile.
fn create_project_with_config(
	conn: &mut diesel::SqliteConnection,
	config_json: &str,
) -> (model::project::Project, model::profile::Profile, std::path::PathBuf)
{
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "Initial commit");

	// Write 2code.json AFTER the initial commit so worktrees inherit it
	std::fs::write(dir.join("2code.json"), config_json).unwrap();
	add_commit(&dir, "2code.json", config_json, "Add 2code.json");

	let folder = dir.to_string_lossy().to_string();
	let project =
		service::project::create_from_folder(conn, "Test Project", &folder)
			.expect("create project from folder");

	let list = service::project::list(conn).expect("list projects");
	let pwp = list
		.into_iter()
		.find(|p| p.id == project.id)
		.expect("find project");
	let default_profile = pwp
		.profiles
		.into_iter()
		.find(|p| p.is_default)
		.expect("find default profile");

	(project, default_profile, dir)
}

// ============================================================
// Profile Creation with 2code.json Scripts
// ============================================================

#[test]
fn profile_create_runs_setup_script() {
	let mut conn = setup_db();
	let config = r#"{"setup_script": ["touch marker.txt"]}"#;
	let (project, _default, dir) =
		create_project_with_config(&mut conn, config);

	let profile =
		service::profile::create(&mut conn, &project.id, "setup-test")
			.unwrap();

	// The setup script should have created marker.txt in the worktree
	let worktree = std::path::Path::new(&profile.worktree_path);
	assert!(
		worktree.join("marker.txt").exists(),
		"setup_script should have created marker.txt in worktree: {}",
		profile.worktree_path
	);

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}

#[test]
fn profile_create_no_config_still_succeeds() {
	let mut conn = setup_db();
	let dir = create_temp_git_repo();
	add_commit(&dir, "README.md", "# Test", "Initial commit");

	let folder = dir.to_string_lossy().to_string();
	let project =
		service::project::create_from_folder(&mut conn, "No Config", &folder)
			.unwrap();

	// No 2code.json exists — profile creation should still work
	let profile =
		service::profile::create(&mut conn, &project.id, "no-config-branch")
			.unwrap();

	assert!(!profile.id.is_empty());
	assert_eq!(profile.branch_name, "no-config-branch");

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}

#[test]
fn profile_delete_runs_teardown_script() {
	let mut conn = setup_db();

	// Use a unique temp file path for the teardown marker
	let marker_path = std::env::temp_dir().join(format!(
		"2code-teardown-marker-{}",
		uuid::Uuid::new_v4()
	));
	let marker_str = marker_path.to_string_lossy().to_string();

	let config = format!(r#"{{"teardown_script": ["touch {marker_str}"]}}"#);
	let (project, _default, dir) =
		create_project_with_config(&mut conn, &config);

	let profile =
		service::profile::create(&mut conn, &project.id, "teardown-test")
			.unwrap();

	// Delete triggers teardown_script
	service::profile::delete(&mut conn, &profile.id).unwrap();

	assert!(
		marker_path.exists(),
		"teardown_script should have created marker at {}",
		marker_str
	);

	// Cleanup marker
	let _ = std::fs::remove_file(&marker_path);
	cleanup(&dir);
}

#[test]
fn profile_create_setup_script_failure_no_block() {
	let mut conn = setup_db();
	let config = r#"{"setup_script": ["exit 1"]}"#;
	let (project, _default, dir) =
		create_project_with_config(&mut conn, config);

	// Even though setup_script exits with error, profile creation should succeed
	let profile =
		service::profile::create(&mut conn, &project.id, "fail-script")
			.unwrap();

	assert!(!profile.id.is_empty());
	assert_eq!(profile.branch_name, "fail-script");

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}

#[test]
fn profile_create_with_init_script_not_executed() {
	let mut conn = setup_db();

	let marker_path = std::env::temp_dir().join(format!(
		"2code-init-marker-{}",
		uuid::Uuid::new_v4()
	));
	let marker_str = marker_path.to_string_lossy().to_string();

	let config = format!(r#"{{"init_script": ["touch {marker_str}"]}}"#);
	let (project, _default, dir) =
		create_project_with_config(&mut conn, &config);

	let profile =
		service::profile::create(&mut conn, &project.id, "init-test").unwrap();

	// init_script should NOT be executed during profile creation
	// (it's only for terminal sessions via ZDOTDIR)
	assert!(
		!marker_path.exists(),
		"init_script should not run during profile creation"
	);

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}

#[test]
fn profile_create_multiple_setup_scripts() {
	let mut conn = setup_db();
	let config =
		r#"{"setup_script": ["touch first.txt", "touch second.txt"]}"#;
	let (project, _default, dir) =
		create_project_with_config(&mut conn, config);

	let profile =
		service::profile::create(&mut conn, &project.id, "multi-script")
			.unwrap();

	let worktree = std::path::Path::new(&profile.worktree_path);
	assert!(
		worktree.join("first.txt").exists(),
		"first setup script should have run"
	);
	assert!(
		worktree.join("second.txt").exists(),
		"second setup script should have run"
	);

	service::profile::delete(&mut conn, &profile.id).unwrap();
	cleanup(&dir);
}
