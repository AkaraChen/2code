use diesel::dsl::max;
use diesel::prelude::*;

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use model::error::AppError;
use model::profile::Profile;
use model::project::{
	NewProject, Project, ProjectSidebarLayoutUpdate, ProjectWithProfiles,
	UpdateProject,
};
use model::schema::{profiles, projects};

pub fn insert(
	conn: &mut SqliteConnection,
	id: &str,
	name: &str,
	folder: &str,
) -> Result<Project, AppError> {
	let sort_order = next_top_level_sort_order(conn)?;
	diesel::insert_into(projects::table)
		.values(&NewProject {
			id,
			name,
			folder,
			group_id: None,
			sort_order,
		})
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	projects::table
		.find(id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn list_all(conn: &mut SqliteConnection) -> Result<Vec<Project>, AppError> {
	projects::table
		.order((projects::sort_order.asc(), projects::created_at.asc()))
		.select(Project::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn next_top_level_sort_order(
	conn: &mut SqliteConnection,
) -> Result<i32, AppError> {
	let current_max: Option<i32> = projects::table
		.filter(projects::group_id.is_null())
		.filter(projects::pinned_order.is_null())
		.select(max(projects::sort_order))
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	Ok(current_max.unwrap_or(0) + 1000)
}

pub fn find_by_id(
	conn: &mut SqliteConnection,
	id: &str,
) -> Result<Project, AppError> {
	projects::table
		.find(id)
		.select(Project::as_select())
		.first(conn)
		.map_err(|_| AppError::NotFound(format!("Project: {id}")))
}

pub fn list_all_with_profiles(
	conn: &mut SqliteConnection,
) -> Result<Vec<ProjectWithProfiles>, AppError> {
	let all_projects: Vec<Project> = projects::table
		.order((projects::sort_order.asc(), projects::created_at.asc()))
		.select(Project::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	let all_profiles: Vec<Profile> = profiles::table
		.select(Profile::as_select())
		.load(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	let mut profile_map: HashMap<String, Vec<Profile>> = HashMap::new();
	for profile in all_profiles {
		profile_map
			.entry(profile.project_id.clone())
			.or_default()
			.push(profile);
	}

	let result = all_projects
		.into_iter()
		.map(|project| {
			let profiles = profile_map.remove(&project.id).unwrap_or_default();
			ProjectWithProfiles {
				id: project.id,
				name: project.name,
				folder: project.folder,
				created_at: project.created_at,
				group_id: project.group_id,
				sort_order: project.sort_order,
				pinned_at: project.pinned_at,
				pinned_order: project.pinned_order,
				profiles,
			}
		})
		.collect();

	Ok(result)
}

pub fn update(
	conn: &mut SqliteConnection,
	id: &str,
	name: Option<String>,
	folder: Option<String>,
) -> Result<Project, AppError> {
	let target = projects::table.find(id);

	if name.is_none() && folder.is_none() {
		return target
			.select(Project::as_select())
			.first(conn)
			.map_err(|_| AppError::NotFound(format!("Project: {id}")));
	}

	let changeset = UpdateProject { name, folder };
	let rows = diesel::update(target)
		.set(&changeset)
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	if rows == 0 {
		return Err(AppError::NotFound(format!("Project: {id}")));
	}

	target
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn delete(conn: &mut SqliteConnection, id: &str) -> Result<(), AppError> {
	let rows = diesel::delete(projects::table.find(id))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;
	if rows == 0 {
		return Err(AppError::NotFound(format!("Project: {id}")));
	}
	Ok(())
}

pub fn set_group(
	conn: &mut SqliteConnection,
	id: &str,
	group_id: Option<&str>,
) -> Result<Project, AppError> {
	let target = projects::table.find(id);
	let rows = diesel::update(target)
		.set((
			projects::group_id.eq(group_id),
			projects::pinned_at.eq::<Option<String>>(None),
			projects::pinned_order.eq::<Option<i32>>(None),
		))
		.execute(conn)
		.map_err(|e| AppError::DbError(e.to_string()))?;

	if rows == 0 {
		return Err(AppError::NotFound(format!("Project: {id}")));
	}

	target
		.select(Project::as_select())
		.first(conn)
		.map_err(|e| AppError::DbError(e.to_string()))
}

pub fn update_sidebar_layout(
	conn: &mut SqliteConnection,
	updates: &[ProjectSidebarLayoutUpdate],
) -> Result<(), AppError> {
	for update in updates {
		match update.kind.as_str() {
			"group" => {
				return Err(AppError::DbError(format!(
					"Group updates must be handled by project_group repo: {}",
					update.id
				)));
			}
			"project" => {
				let pinned_at = if update.pinned_order.is_some() {
					Some(sidebar_timestamp())
				} else {
					None
				};
				let rows = if let Some(sort_order) = update.sort_order {
					diesel::update(projects::table.find(&update.id))
						.set((
							projects::group_id.eq(update.group_id.as_deref()),
							projects::sort_order.eq(sort_order),
							projects::pinned_at.eq(pinned_at),
							projects::pinned_order.eq(update.pinned_order),
						))
						.execute(conn)
						.map_err(|e| AppError::DbError(e.to_string()))?
				} else {
					diesel::update(projects::table.find(&update.id))
						.set((
							projects::group_id.eq(update.group_id.as_deref()),
							projects::pinned_at.eq(pinned_at),
							projects::pinned_order.eq(update.pinned_order),
						))
						.execute(conn)
						.map_err(|e| AppError::DbError(e.to_string()))?
				};

				if rows == 0 {
					return Err(AppError::NotFound(format!(
						"Project: {}",
						update.id
					)));
				}
			}
			other => {
				return Err(AppError::DbError(format!(
					"Unsupported sidebar layout update kind: {other}"
				)));
			}
		}
	}

	Ok(())
}

fn sidebar_timestamp() -> String {
	let seconds = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_secs())
		.unwrap_or_default();
	seconds.to_string()
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::test_utils::setup_db;
	use model::profile::NewProfile;
	use model::pty::NewPtySessionRecord;
	use model::schema::{profiles, project_groups, pty_sessions};

	#[test]
	fn insert_and_fetch() {
		let mut conn = setup_db();
		let project =
			insert(&mut conn, "p1", "Test", "/tmp/test").expect("insert");
		assert_eq!(project.id, "p1");
		assert_eq!(project.name, "Test");
		assert_eq!(project.folder, "/tmp/test");
		assert_eq!(project.group_id, None);
	}

	#[test]
	fn insert_duplicate_id() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "A", "/a").unwrap();
		let err = insert(&mut conn, "p1", "B", "/b");
		assert!(err.is_err());
	}

	#[test]
	fn find_existing_project() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Test", "/tmp/test").unwrap();
		let project = find_by_id(&mut conn, "p1").unwrap();
		assert_eq!(project.name, "Test");
	}

	#[test]
	fn find_missing_project() {
		let mut conn = setup_db();
		let result = find_by_id(&mut conn, "missing");
		assert!(result.is_err());
	}

	#[test]
	fn list_empty() {
		let mut conn = setup_db();
		let list = list_all(&mut conn).unwrap();
		assert!(list.is_empty());
	}

	#[test]
	fn list_multiple() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "A", "/a").unwrap();
		insert(&mut conn, "p2", "B", "/b").unwrap();
		let list = list_all(&mut conn).unwrap();
		assert_eq!(list.len(), 2);
	}

	#[test]
	fn update_name() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Old", "/f").unwrap();
		let project =
			update(&mut conn, "p1", Some("New".into()), None).unwrap();
		assert_eq!(project.name, "New");
		assert_eq!(project.folder, "/f");
	}

	#[test]
	fn update_folder() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Name", "/old").unwrap();
		let project =
			update(&mut conn, "p1", None, Some("/new".into())).unwrap();
		assert_eq!(project.folder, "/new");
	}

	#[test]
	fn update_nonexistent() {
		let mut conn = setup_db();
		let result = update(&mut conn, "nope", Some("X".into()), None);
		assert!(result.is_err());
	}

	#[test]
	fn delete_success() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Del", "/d").unwrap();
		delete(&mut conn, "p1").unwrap();
		let list = list_all(&mut conn).unwrap();
		assert!(list.is_empty());
	}

	#[test]
	fn delete_nonexistent() {
		let mut conn = setup_db();
		let result = delete(&mut conn, "nope");
		assert!(result.is_err());
	}

	#[test]
	fn set_group_assigns_and_clears_project_group() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Project", "/p").unwrap();
		diesel::insert_into(project_groups::table)
			.values((
				project_groups::id.eq("g1"),
				project_groups::name.eq("Work"),
				project_groups::sort_order.eq(1000),
			))
			.execute(&mut conn)
			.unwrap();

		let assigned = set_group(&mut conn, "p1", Some("g1")).unwrap();
		assert_eq!(assigned.group_id.as_deref(), Some("g1"));

		let cleared = set_group(&mut conn, "p1", None).unwrap();
		assert_eq!(cleared.group_id, None);
	}

	#[test]
	fn deleting_group_clears_project_group_id() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Project", "/p").unwrap();
		diesel::insert_into(project_groups::table)
			.values((
				project_groups::id.eq("g1"),
				project_groups::name.eq("Work"),
				project_groups::sort_order.eq(1000),
			))
			.execute(&mut conn)
			.unwrap();

		set_group(&mut conn, "p1", Some("g1")).unwrap();
		diesel::delete(project_groups::table.find("g1"))
			.execute(&mut conn)
			.unwrap();

		let project = find_by_id(&mut conn, "p1").unwrap();
		assert_eq!(project.group_id, None);
	}

	#[test]
	fn list_with_profiles_empty() {
		let mut conn = setup_db();
		let result = list_all_with_profiles(&mut conn).unwrap();
		assert!(result.is_empty());
	}

	#[test]
	fn list_with_profiles_includes_default() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Test", "/tmp/test").unwrap();
		diesel::insert_into(profiles::table)
			.values(&NewProfile {
				id: "default-p1",
				project_id: "p1",
				branch_name: "main",
				worktree_path: "/tmp/test",
				is_default: true,
			})
			.execute(&mut conn)
			.unwrap();

		let result = list_all_with_profiles(&mut conn).unwrap();
		assert_eq!(result.len(), 1);
		assert_eq!(result[0].id, "p1");
		assert_eq!(result[0].profiles.len(), 1);
		assert!(result[0].profiles[0].is_default);
	}

	#[test]
	fn list_with_profiles_multiple() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Test", "/tmp/test").unwrap();
		diesel::insert_into(profiles::table)
			.values(&NewProfile {
				id: "default-p1",
				project_id: "p1",
				branch_name: "main",
				worktree_path: "/tmp/test",
				is_default: true,
			})
			.execute(&mut conn)
			.unwrap();
		diesel::insert_into(profiles::table)
			.values(&NewProfile {
				id: "feat-p1",
				project_id: "p1",
				branch_name: "feature/x",
				worktree_path: "/w/feat",
				is_default: false,
			})
			.execute(&mut conn)
			.unwrap();

		let result = list_all_with_profiles(&mut conn).unwrap();
		assert_eq!(result[0].profiles.len(), 2);
	}

	#[test]
	fn cascade_delete_removes_sessions() {
		let mut conn = setup_db();
		insert(&mut conn, "p1", "Cascade", "/c").unwrap();

		// Create default profile (in real app, service layer does this)
		diesel::insert_into(profiles::table)
			.values(&NewProfile {
				id: "default-p1",
				project_id: "p1",
				branch_name: "main",
				worktree_path: "/c",
				is_default: true,
			})
			.execute(&mut conn)
			.unwrap();

		// Sessions belong to profiles; cascade: project → profile → session
		diesel::insert_into(pty_sessions::table)
			.values(&NewPtySessionRecord {
				id: "s1",
				profile_id: "default-p1",
				title: "bash",
				shell: "/bin/bash",
				cwd: "/c",
				cols: 80,
				rows: 24,
			})
			.execute(&mut conn)
			.unwrap();

		delete(&mut conn, "p1").unwrap();

		let sessions: Vec<String> = pty_sessions::table
			.select(pty_sessions::id)
			.load(&mut conn)
			.unwrap();
		assert!(sessions.is_empty());
	}
}
