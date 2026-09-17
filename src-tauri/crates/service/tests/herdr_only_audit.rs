//! Repo-walk lock: GUI runtime stays Herdr-only.
//!
//! Scan exclusions (same tree as the evidence command in the Task 3 reply):
//! `src-tauri/migrations/`, `src-tauri/tests/integration_migrations.rs`,
//! the `drop_profiles_migration_copies_notes_and_keeps_projects` seed in
//! `db.rs`, `**/target/**`, lockfiles, `node_modules/`, `src/generated/`,
//! `src/paraglide/`, `src-tauri/binaries/`, `openspec/`, `website/`.
//! Gitignored local planning notes (`plans/`), `dist/`, `coverage/`,
//! and `*.log` are skipped so the walker matches `rg` (the evidence
//! command). `.git/` is skipped by the walker. Current-state docs, AGENTS.md,
//! production comments, and non-history tests are included.
//!
//! Needles are constructed at runtime so this file does not reintroduce
//! the vocabulary it forbids.

use std::fs;
use std::path::{Path, PathBuf};

fn session_layer_token() -> String {
	format!("{}ty", "p")
}

fn deleted_env_name() -> String {
	format!("{}_{}", "TWOCODE", "RUNTIME")
}

fn deleted_cli_flag() -> String {
	format!("--{}-{}", "twocode", "runtime")
}

fn local_adapter() -> String {
	["Local", "Adapter"].concat()
}

fn runtime_backend_local() -> String {
	format!("RuntimeBackend::{}", "Local")
}

fn mod_local() -> String {
	format!("mod {}", "local")
}

fn portable_spawn_crate() -> String {
	format!("portable-{}", session_layer_token())
}

fn native_spawn_fn() -> String {
	format!("native_{}_system", session_layer_token())
}

fn con_host() -> String {
	format!("{}PTY", "Con")
}

fn insert_profiles_sql() -> String {
	format!("INSERT INTO {}", "profiles")
}

fn repo_root() -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR"))
		.join("../../..")
		.canonicalize()
		.expect("repo root")
}

fn posix(rel: &Path) -> String {
	rel.to_string_lossy().replace('\\', "/")
}

fn is_lockfile(name: &str) -> bool {
	name.ends_with(".lock")
		|| name.ends_with(".lockb")
		|| name == "package-lock.json"
		|| name == "pnpm-lock.yaml"
		|| name == "bun.lock"
}

fn excluded_rel(rel: &Path) -> bool {
	let s = posix(rel);
	if s == ".git" || s.starts_with(".git/") {
		return true;
	}
	if s == "target" || s.starts_with("target/") || s.contains("/target/") {
		return true;
	}
	if s == "node_modules"
		|| s.starts_with("node_modules/")
		|| s.contains("/node_modules/")
	{
		return true;
	}
	if s == "src/generated" || s.starts_with("src/generated/") {
		return true;
	}
	if s == "src/paraglide" || s.starts_with("src/paraglide/") {
		return true;
	}
	if s == "src-tauri/binaries" || s.starts_with("src-tauri/binaries/") {
		return true;
	}
	if s == "src-tauri/migrations" || s.starts_with("src-tauri/migrations/") {
		return true;
	}
	if s == "openspec" || s.starts_with("openspec/") {
		return true;
	}
	if s == "website" || s.starts_with("website/") {
		return true;
	}
	if s == "plans" || s.starts_with("plans/") {
		return true;
	}
	if s == "dist"
		|| s.starts_with("dist/")
		|| s == "dist-ssr"
		|| s.starts_with("dist-ssr/")
	{
		return true;
	}
	if s == "coverage"
		|| s.starts_with("coverage/")
		|| s == "src-tauri/coverage"
		|| s.starts_with("src-tauri/coverage/")
	{
		return true;
	}
	if s == "e2e-tests/artifacts" || s.starts_with("e2e-tests/artifacts/") {
		return true;
	}
	if s == "logs" || s.starts_with("logs/") {
		return true;
	}
	if Path::new(&s)
		.file_name()
		.and_then(|n| n.to_str())
		.is_some_and(|name| name.ends_with(".log"))
	{
		return true;
	}
	if s == "src-tauri/tests/integration_migrations.rs" {
		return true;
	}
	if Path::new(&s)
		.file_name()
		.and_then(|n| n.to_str())
		.is_some_and(is_lockfile)
	{
		return true;
	}
	false
}

fn skip_named_fn(src: &str, fn_name: &str) -> String {
	let sig = format!("fn {fn_name}");
	let Some(sig_at) = src.find(&sig) else {
		return src.to_string();
	};
	let line_start = src[..sig_at].rfind('\n').map(|i| i + 1).unwrap_or(0);
	let Some(brace_rel) = src[sig_at..].find('{') else {
		return src.to_string();
	};
	let brace = sig_at + brace_rel;
	let bytes = src.as_bytes();
	let mut depth = 0_i32;
	let mut i = brace;
	while i < bytes.len() {
		match bytes[i] {
			b'{' => depth += 1,
			b'}' => {
				depth -= 1;
				if depth == 0 {
					return format!("{}{}", &src[..line_start], &src[i + 1..]);
				}
			}
			_ => {}
		}
		i += 1;
	}
	src.to_string()
}

fn scan_contents(rel: &Path, text: &str) -> String {
	let s = posix(rel);
	if s == "src-tauri/crates/infra/src/db.rs" {
		return skip_named_fn(
			text,
			"drop_profiles_migration_copies_notes_and_keeps_projects",
		);
	}
	text.to_string()
}

fn ident_continue(b: u8) -> bool {
	b.is_ascii_alphanumeric() || b == b'_'
}

fn contains_ident_phrase(text: &str, phrase: &str) -> bool {
	let bytes = text.as_bytes();
	let needle = phrase.as_bytes();
	let mut i = 0;
	while i + needle.len() <= bytes.len() {
		if &bytes[i..i + needle.len()] == needle {
			let next = bytes.get(i + needle.len()).copied();
			if next.is_none_or(|b| !ident_continue(b)) {
				return true;
			}
		}
		i += 1;
	}
	false
}

fn session_layer_hits(text: &str, token: &str) -> Vec<usize> {
	let mut lines = Vec::new();
	let needle = token.as_bytes();
	for (idx, line) in text.lines().enumerate() {
		let bytes = line.as_bytes();
		let mut i = 0;
		while i + needle.len() <= bytes.len() {
			if &bytes[i..i + needle.len()] == needle {
				let prev_ok = i == 0 || !bytes[i - 1].is_ascii_alphabetic();
				if prev_ok {
					lines.push(idx + 1);
					break;
				}
			}
			i += 1;
		}
	}
	lines
}

fn record(hits: &mut Vec<String>, rel: &Path, line: usize, why: &str) {
	hits.push(format!("{}:{}: {why}", posix(rel), line));
}

fn record_file(hits: &mut Vec<String>, rel: &Path, why: &str) {
	hits.push(format!("{}: {why}", posix(rel)));
}

fn diesel_table_names(schema: &str) -> Vec<String> {
	let mut names = Vec::new();
	let marker = "diesel::table!";
	let mut rest = schema;
	while let Some(idx) = rest.find(marker) {
		let after = rest[idx + marker.len()..].trim_start();
		let after = after.strip_prefix('{').unwrap_or(after).trim_start();
		let name: String = after
			.chars()
			.take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
			.collect();
		if !name.is_empty() {
			names.push(name);
		}
		rest = &rest[idx + marker.len()..];
	}
	names
}

fn slice_between<'a>(src: &'a str, start: &str, end: &str) -> &'a str {
	src.split(start)
		.nth(1)
		.unwrap_or("")
		.split(end)
		.next()
		.unwrap_or("")
}

fn assert_no_env_backend_selection(
	src: &str,
	label: &str,
	hits: &mut Vec<String>,
) {
	for needle in ["std::env::var", "std::env::var_os", "std::env::args"] {
		if src.contains(needle) {
			hits.push(format!(
				"{label}: runtime backend must not be selected via {needle}"
			));
		}
	}
}

fn scan_file(path: &Path, rel: &Path, hits: &mut Vec<String>) {
	let Ok(bytes) = fs::read(path) else {
		return;
	};
	if bytes.contains(&0) || bytes.len() > 2_000_000 {
		return;
	}
	let Ok(raw) = std::str::from_utf8(&bytes) else {
		return;
	};
	let text = scan_contents(rel, raw);
	let token = session_layer_token();
	for line in session_layer_hits(&text, &token) {
		record(hits, rel, line, "live session-layer token");
	}
	if let Some(line) =
		text.lines().position(|l| l.contains(&deleted_env_name()))
	{
		record(hits, rel, line + 1, "deleted runtime env name");
	}
	if let Some(line) =
		text.lines().position(|l| l.contains(&deleted_cli_flag()))
	{
		record(hits, rel, line + 1, "deleted runtime CLI flag");
	}
	if contains_ident_phrase(&text, &local_adapter()) {
		record_file(hits, rel, "Local adapter type");
	}
	if contains_ident_phrase(&text, &runtime_backend_local()) {
		record_file(hits, rel, "Local runtime backend variant");
	}
	if contains_ident_phrase(&text, &mod_local()) {
		record_file(hits, rel, "Local runtime module");
	}
	if text.contains(&portable_spawn_crate()) {
		record_file(hits, rel, "portable spawn crate");
	}
	if text.contains(&native_spawn_fn()) {
		record_file(hits, rel, "native spawn helper");
	}
	let s = posix(rel);
	if s.ends_with(".rs")
		&& s != "src-tauri/src/handler/shell.rs"
		&& text.contains(&con_host())
	{
		record_file(hits, rel, "host spawn path");
	}
	if text.contains(&insert_profiles_sql()) {
		record_file(hits, rel, "sqlite profiles INSERT as authority");
	}
}

fn walk(dir: &Path, root: &Path, hits: &mut Vec<String>) {
	let Ok(entries) = fs::read_dir(dir) else {
		return;
	};
	let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
	entries.sort_by_key(|e| e.file_name());
	for entry in entries {
		let path = entry.path();
		let rel = match path.strip_prefix(root) {
			Ok(rel) => rel.to_path_buf(),
			Err(_) => continue,
		};
		if excluded_rel(&rel) {
			continue;
		}
		let Ok(ft) = entry.file_type() else {
			continue;
		};
		if ft.is_dir() {
			walk(&path, root, hits);
		} else if ft.is_file() {
			scan_file(&path, &rel, hits);
		}
	}
}

#[test]
fn herdr_only_live_tree_stays_locked() {
	let root = repo_root();
	let mut hits = Vec::new();

	let local_rs = root.join("src-tauri/crates/service/src/runtime/local.rs");
	if local_rs.exists() {
		hits.push(
			"src-tauri/crates/service/src/runtime/local.rs exists".into(),
		);
	}

	let schema =
		fs::read_to_string(root.join("src-tauri/crates/model/src/schema.rs"))
			.expect("schema.rs");
	let mut tables = diesel_table_names(&schema);
	tables.sort();
	let expected = ["checkout_notes", "project_groups", "projects"];
	if tables != expected {
		hits.push(format!("schema.rs user tables {tables:?} != {expected:?}"));
	}

	let repo_src = root.join("src-tauri/crates/repo/src");
	let mut repo_files: Vec<String> = fs::read_dir(&repo_src)
		.expect("repo/src")
		.filter_map(|e| e.ok())
		.filter(|e| e.path().extension().is_some_and(|ext| ext == "rs"))
		.map(|e| e.file_name().to_string_lossy().into_owned())
		.collect();
	repo_files.sort();
	let allowed_repo = [
		"checkout_notes.rs",
		"lib.rs",
		"project.rs",
		"project_group.rs",
		"test_utils.rs",
	];
	if repo_files != allowed_repo {
		hits.push(format!(
			"repo/src modules {repo_files:?} != {allowed_repo:?}"
		));
	}

	let runtime = fs::read_to_string(
		root.join("src-tauri/crates/service/src/runtime.rs"),
	)
	.expect("runtime.rs");
	let production = runtime.split("#[cfg(test)]").next().unwrap_or(&runtime);
	assert_no_env_backend_selection(
		slice_between(
			production,
			"pub fn select_gui_backend",
			"pub struct GuiHerdrConnect",
		),
		"select_gui_backend",
		&mut hits,
	);
	assert_no_env_backend_selection(
		slice_between(
			production,
			"pub struct RuntimeSelector",
			"pub(crate) fn is_herdr_pane_id",
		),
		"RuntimeSelector",
		&mut hits,
	);
	assert_no_env_backend_selection(
		slice_between(
			production,
			"pub fn build_gui_runtime",
			"pub fn release_herdr_client_helpers",
		),
		"build_gui_runtime",
		&mut hits,
	);

	walk(&root, &root, &mut hits);
	assert!(
		hits.is_empty(),
		"Herdr-only live tree lock failed:\n{}",
		hits.join("\n")
	);
}
