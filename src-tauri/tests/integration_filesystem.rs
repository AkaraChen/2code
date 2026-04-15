mod common;

use common::{cleanup, create_project_with_git_repo, setup_db};

#[test]
fn search_file_prefers_file_name_matches() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	std::fs::create_dir_all(dir.join("src/components")).unwrap();
	std::fs::write(dir.join("src/index.ts"), "export const main = true;\n")
		.unwrap();
	std::fs::write(
		dir.join("src/components/feature.ts"),
		"export const feature = true;\n",
	)
	.unwrap();

	let results = service::filesystem::search_file(
		&mut conn,
		&default_profile.id,
		"index",
	)
	.unwrap();

	assert!(!results.is_empty());
	assert_eq!(results[0].name, "index.ts");
	assert_eq!(results[0].relative_path, "src/index.ts");

	cleanup(&dir);
}

#[test]
fn search_file_respects_gitignore_rules() {
	let mut conn = setup_db();
	let (_project, default_profile, dir) =
		create_project_with_git_repo(&mut conn);

	std::fs::write(dir.join(".gitignore"), "node_modules/\nignored.log\n")
		.unwrap();
	std::fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
	std::fs::write(dir.join("node_modules/pkg/index.ts"), "ignored\n").unwrap();
	std::fs::write(dir.join("src-index.ts"), "visible\n").unwrap();
	std::fs::write(dir.join("ignored.log"), "ignored\n").unwrap();

	let results = service::filesystem::search_file(
		&mut conn,
		&default_profile.id,
		"index",
	)
	.unwrap();

	assert!(!results.is_empty());
	assert!(results.iter().all(|entry| entry.name != "ignored.log"));
	assert!(results
		.iter()
		.all(|entry| !entry.relative_path.contains("node_modules")));
	assert!(results.iter().any(|entry| entry.name == "src-index.ts"));

	cleanup(&dir);
}

#[test]
fn search_file_returns_error_for_missing_profile() {
	let mut conn = setup_db();
	let error =
		service::filesystem::search_file(&mut conn, "missing-profile", "main")
			.expect_err("missing profile should error");

	assert!(error.to_string().contains("Profile: missing-profile"));
}
