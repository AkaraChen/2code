//! Read-only Herdr runtime projection (Task 6).
//!
//! Bootstrap is subscribe ack → buffer → `session.snapshot` → drain,
//! then live events. Disconnect starts a new epoch so pre-disconnect
//! events are dropped. Objects are keyed by `workspace_id` / `tab_id` /
//! `pane_id`, never by display name.

use std::collections::HashMap;

use model::error::AppError;
use serde_json::Value;

/// Workspace identity in the Herdr projection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectedWorkspace {
	pub workspace_id: String,
	pub label: String,
}

/// Tab identity in the Herdr projection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectedTab {
	pub tab_id: String,
	pub workspace_id: String,
	pub label: String,
}

/// Pane identity in the Herdr projection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectedPane {
	pub pane_id: String,
	pub tab_id: String,
	pub workspace_id: String,
	pub terminal_id: String,
	pub revision: u64,
}

/// Result of applying one subscribe event.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApplyOutcome {
	Applied,
	IgnoredStale,
	Ignored,
}

/// In-memory Herdr runtime cache. Not persisted.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RuntimeProjection {
	workspaces: HashMap<String, ProjectedWorkspace>,
	tabs: HashMap<String, ProjectedTab>,
	panes: HashMap<String, ProjectedPane>,
}

impl RuntimeProjection {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn workspace(&self, workspace_id: &str) -> Option<&ProjectedWorkspace> {
		self.workspaces.get(workspace_id)
	}

	pub fn tab(&self, tab_id: &str) -> Option<&ProjectedTab> {
		self.tabs.get(tab_id)
	}

	pub fn pane(&self, pane_id: &str) -> Option<&ProjectedPane> {
		self.panes.get(pane_id)
	}

	pub fn workspace_ids(&self) -> Vec<String> {
		sorted_keys(&self.workspaces)
	}

	pub fn tab_ids(&self) -> Vec<String> {
		sorted_keys(&self.tabs)
	}

	pub fn pane_ids(&self) -> Vec<String> {
		sorted_keys(&self.panes)
	}

	/// Replace the projection from `session.snapshot` (`result` or the
	/// inner `snapshot` object). Objects missing from the snapshot are
	/// dropped, not recreated.
	pub fn apply_snapshot(&mut self, result: &Value) -> Result<(), AppError> {
		let snap = extract_snapshot(result)?;
		self.workspaces = parse_workspaces(snap);
		self.tabs = parse_tabs(snap);
		self.panes = parse_panes(snap);
		Ok(())
	}

	pub fn apply_event(&mut self, event: &str, data: &Value) -> ApplyOutcome {
		let kind = event.replace('.', "_");
		match kind.as_str() {
			"workspace_created"
			| "workspace_updated"
			| "workspace_metadata_updated"
			| "worktree_created"
			| "worktree_opened" => self.upsert_workspace(data),
			"workspace_renamed" => self.rename_workspace(data),
			"workspace_closed" | "worktree_removed" => {
				self.close_workspace(data)
			}
			"tab_created" => self.upsert_tab(data),
			"tab_renamed" => self.rename_tab(data),
			"tab_closed" => self.close_tab(data),
			"pane_created" => self.create_pane(data),
			"pane_updated" | "pane_moved" => self.update_pane(data),
			"pane_closed" => self.close_pane(data),
			_ => ApplyOutcome::Ignored,
		}
	}

	fn upsert_workspace(&mut self, data: &Value) -> ApplyOutcome {
		let Some(workspace) = nested_or_self(data, "workspace") else {
			return ApplyOutcome::Ignored;
		};
		let Some(record) = workspace_from_value(workspace) else {
			return ApplyOutcome::IgnoredStale;
		};
		self.workspaces.insert(record.workspace_id.clone(), record);
		ApplyOutcome::Applied
	}

	fn rename_workspace(&mut self, data: &Value) -> ApplyOutcome {
		let Some(id) = event_id(data, "workspace_id") else {
			return ApplyOutcome::Ignored;
		};
		let Some(workspace) = self.workspaces.get_mut(id) else {
			return ApplyOutcome::IgnoredStale;
		};
		if let Some(label) = data.get("label").and_then(Value::as_str) {
			workspace.label = label.to_string();
		}
		ApplyOutcome::Applied
	}

	fn close_workspace(&mut self, data: &Value) -> ApplyOutcome {
		let Some(id) = event_id(data, "workspace_id") else {
			return ApplyOutcome::Ignored;
		};
		if self.workspaces.remove(id).is_none()
			&& !self.tabs.values().any(|tab| tab.workspace_id == id)
			&& !self.panes.values().any(|pane| pane.workspace_id == id)
		{
			return ApplyOutcome::Ignored;
		}
		self.tabs.retain(|_, tab| tab.workspace_id != id);
		self.panes.retain(|_, pane| pane.workspace_id != id);
		ApplyOutcome::Applied
	}

	fn upsert_tab(&mut self, data: &Value) -> ApplyOutcome {
		let Some(tab) = nested_or_self(data, "tab") else {
			return ApplyOutcome::Ignored;
		};
		let Some(record) = tab_from_value(tab) else {
			return ApplyOutcome::IgnoredStale;
		};
		self.tabs.insert(record.tab_id.clone(), record);
		ApplyOutcome::Applied
	}

	fn rename_tab(&mut self, data: &Value) -> ApplyOutcome {
		let Some(id) = event_id(data, "tab_id") else {
			return ApplyOutcome::Ignored;
		};
		let Some(tab) = self.tabs.get_mut(id) else {
			return ApplyOutcome::IgnoredStale;
		};
		if let Some(label) = data.get("label").and_then(Value::as_str) {
			tab.label = label.to_string();
		}
		ApplyOutcome::Applied
	}

	fn close_tab(&mut self, data: &Value) -> ApplyOutcome {
		let Some(id) = event_id(data, "tab_id") else {
			return ApplyOutcome::Ignored;
		};
		if self.tabs.remove(id).is_none()
			&& !self.panes.values().any(|pane| pane.tab_id == id)
		{
			return ApplyOutcome::Ignored;
		}
		self.panes.retain(|_, pane| pane.tab_id != id);
		ApplyOutcome::Applied
	}

	fn create_pane(&mut self, data: &Value) -> ApplyOutcome {
		let Some(pane) = nested_or_self(data, "pane") else {
			return ApplyOutcome::Ignored;
		};
		let Some(record) = pane_from_value(pane) else {
			return ApplyOutcome::IgnoredStale;
		};
		self.panes.insert(record.pane_id.clone(), record);
		ApplyOutcome::Applied
	}

	fn update_pane(&mut self, data: &Value) -> ApplyOutcome {
		let Some(pane) = nested_or_self(data, "pane") else {
			return ApplyOutcome::Ignored;
		};
		let Some(record) = pane_from_value(pane) else {
			return ApplyOutcome::IgnoredStale;
		};
		match self.panes.get(&record.pane_id) {
			None => ApplyOutcome::IgnoredStale,
			Some(existing) if existing.revision > record.revision => {
				ApplyOutcome::IgnoredStale
			}
			Some(_) => {
				self.panes.insert(record.pane_id.clone(), record);
				ApplyOutcome::Applied
			}
		}
	}

	fn close_pane(&mut self, data: &Value) -> ApplyOutcome {
		let Some(id) = event_id(data, "pane_id") else {
			return ApplyOutcome::Ignored;
		};
		if self.panes.remove(id).is_some() {
			ApplyOutcome::Applied
		} else {
			ApplyOutcome::Ignored
		}
	}
}

/// One `{event, data}` line from `events.subscribe`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeEvent {
	pub event: String,
	pub data: Value,
	pub generation: u64,
}

impl RuntimeEvent {
	pub fn new(generation: u64, event: impl Into<String>, data: Value) -> Self {
		Self {
			event: event.into(),
			data,
			generation,
		}
	}
}

/// Recoverable projection: subscribe epoch, snapshot replace, drain.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RuntimeReconciler {
	projection: RuntimeProjection,
	generation: u64,
}

impl RuntimeReconciler {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn generation(&self) -> u64 {
		self.generation
	}

	pub fn projection(&self) -> &RuntimeProjection {
		&self.projection
	}

	/// Begin a subscribe epoch. Tag buffered/live events with the
	/// returned id. Previous ids become stale.
	pub fn start_epoch(&mut self) -> u64 {
		self.generation = self.generation.wrapping_add(1);
		self.generation
	}

	/// Apply `session.snapshot`, then buffered events from this subscribe.
	pub fn commit_snapshot(
		&mut self,
		snapshot: &Value,
		buffered: &[RuntimeEvent],
	) -> Result<(), AppError> {
		self.projection.apply_snapshot(snapshot)?;
		for event in buffered {
			self.projection.apply_event(&event.event, &event.data);
		}
		Ok(())
	}

	/// Subscribe ack, buffer, snapshot, drain — verified bootstrap.
	pub fn bootstrap(
		&mut self,
		snapshot: &Value,
		buffered: &[RuntimeEvent],
	) -> Result<u64, AppError> {
		let generation = self.start_epoch();
		self.commit_snapshot(snapshot, buffered)?;
		Ok(generation)
	}

	/// Disconnect recovery: new subscribe epoch, fresh snapshot.
	pub fn rebuild(
		&mut self,
		snapshot: &Value,
		buffered: &[RuntimeEvent],
	) -> Result<u64, AppError> {
		self.bootstrap(snapshot, buffered)
	}

	pub fn apply_event(&mut self, event: &RuntimeEvent) -> ApplyOutcome {
		if event.generation != self.generation {
			return ApplyOutcome::IgnoredStale;
		}
		self.projection.apply_event(&event.event, &event.data)
	}
}

fn extract_snapshot(result: &Value) -> Result<&Value, AppError> {
	if result.get("type").and_then(Value::as_str) == Some("session_snapshot") {
		result.get("snapshot").ok_or_else(|| {
			AppError::HerdrTransport("session.snapshot missing snapshot".into())
		})
	} else if result.get("workspaces").is_some() {
		Ok(result)
	} else {
		Err(AppError::HerdrTransport(
			"not a session.snapshot result".into(),
		))
	}
}

fn parse_workspaces(snap: &Value) -> HashMap<String, ProjectedWorkspace> {
	let mut out = HashMap::new();
	for item in snap["workspaces"]
		.as_array()
		.map(|a| a.as_slice())
		.unwrap_or(&[])
	{
		if let Some(record) = workspace_from_value(item) {
			out.insert(record.workspace_id.clone(), record);
		}
	}
	out
}

fn parse_tabs(snap: &Value) -> HashMap<String, ProjectedTab> {
	let mut out = HashMap::new();
	for item in snap["tabs"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
		if let Some(record) = tab_from_value(item) {
			out.insert(record.tab_id.clone(), record);
		}
	}
	out
}

fn parse_panes(snap: &Value) -> HashMap<String, ProjectedPane> {
	let mut out = HashMap::new();
	for item in snap["panes"]
		.as_array()
		.map(|a| a.as_slice())
		.unwrap_or(&[])
	{
		if let Some(record) = pane_from_value(item) {
			out.insert(record.pane_id.clone(), record);
		}
	}
	out
}

fn workspace_from_value(value: &Value) -> Option<ProjectedWorkspace> {
	Some(ProjectedWorkspace {
		workspace_id: value.get("workspace_id")?.as_str()?.to_string(),
		label: value
			.get("label")
			.and_then(Value::as_str)
			.unwrap_or("")
			.to_string(),
	})
}

fn tab_from_value(value: &Value) -> Option<ProjectedTab> {
	Some(ProjectedTab {
		tab_id: value.get("tab_id")?.as_str()?.to_string(),
		workspace_id: value.get("workspace_id")?.as_str()?.to_string(),
		label: value
			.get("label")
			.and_then(Value::as_str)
			.unwrap_or("")
			.to_string(),
	})
}

fn pane_from_value(value: &Value) -> Option<ProjectedPane> {
	Some(ProjectedPane {
		pane_id: value.get("pane_id")?.as_str()?.to_string(),
		tab_id: value.get("tab_id")?.as_str()?.to_string(),
		workspace_id: value.get("workspace_id")?.as_str()?.to_string(),
		terminal_id: value
			.get("terminal_id")
			.and_then(Value::as_str)
			.unwrap_or("")
			.to_string(),
		revision: value.get("revision").and_then(Value::as_u64).unwrap_or(0),
	})
}

fn nested_or_self<'a>(data: &'a Value, key: &str) -> Option<&'a Value> {
	data.get(key)
		.or(Some(data))
		.filter(|value| value.is_object())
}

fn event_id<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
	data.get(key).and_then(Value::as_str).or_else(|| {
		["pane", "tab", "workspace"].iter().find_map(|wrap| {
			data.get(*wrap)
				.and_then(|obj| obj.get(key))
				.and_then(Value::as_str)
		})
	})
}

fn sorted_keys<V>(map: &HashMap<String, V>) -> Vec<String> {
	let mut keys: Vec<String> = map.keys().cloned().collect();
	keys.sort();
	keys
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	fn snapshot(workspaces: Value, tabs: Value, panes: Value) -> Value {
		json!({
			"type": "session_snapshot",
			"snapshot": {
				"version": "0.9.0",
				"protocol": 22,
				"workspaces": workspaces,
				"tabs": tabs,
				"panes": panes,
				"layouts": [],
				"agents": []
			}
		})
	}

	fn workspace(id: &str, label: &str) -> Value {
		json!({
			"workspace_id": id,
			"number": 1,
			"label": label,
			"focused": false,
			"pane_count": 1,
			"tab_count": 1,
			"active_tab_id": format!("{id}:t1"),
			"agent_status": "unknown"
		})
	}

	fn tab(id: &str, workspace_id: &str, label: &str) -> Value {
		json!({
			"tab_id": id,
			"workspace_id": workspace_id,
			"number": 1,
			"label": label,
			"focused": false,
			"pane_count": 1,
			"agent_status": "unknown"
		})
	}

	fn pane(
		id: &str,
		tab_id: &str,
		workspace_id: &str,
		term: &str,
		rev: u64,
	) -> Value {
		json!({
			"pane_id": id,
			"tab_id": tab_id,
			"workspace_id": workspace_id,
			"terminal_id": term,
			"focused": false,
			"agent_status": "unknown",
			"revision": rev
		})
	}

	#[test]
	fn snapshot_keys_ids_never_labels() {
		let mut proj = RuntimeProjection::new();
		proj.apply_snapshot(&snapshot(
			json!([workspace("w1", "App"), workspace("w2", "App")]),
			json!([tab("w1:t1", "w1", "App"), tab("w2:t1", "w2", "App")]),
			json!([
				pane("w1:p1", "w1:t1", "w1", "term_a", 1),
				pane("w2:p1", "w2:t1", "w2", "term_b", 1)
			]),
		))
		.unwrap();
		assert_eq!(proj.workspace_ids(), vec!["w1", "w2"]);
		assert_eq!(proj.tab_ids(), vec!["w1:t1", "w2:t1"]);
		assert_eq!(proj.pane_ids(), vec!["w1:p1", "w2:p1"]);
		assert_eq!(proj.workspace("App"), None);
		assert_eq!(proj.workspace("w1").unwrap().label, "App");
		assert_eq!(
			proj.apply_event(
				"workspace_renamed",
				&json!({"workspace_id": "w1", "label": "Other"}),
			),
			ApplyOutcome::Applied
		);
		assert_eq!(proj.workspace("Other"), None);
		assert_eq!(proj.workspace("w1").unwrap().label, "Other");
		assert!(proj.workspace("w2").is_some());
	}

	#[test]
	fn snapshot_drops_disappeared_panes_without_recreating() {
		let mut proj = RuntimeProjection::new();
		proj.apply_snapshot(&snapshot(
			json!([workspace("w1", "App")]),
			json!([tab("w1:t1", "w1", "App")]),
			json!([
				pane("w1:p1", "w1:t1", "w1", "term_a", 1),
				pane("w1:p2", "w1:t1", "w1", "term_b", 1)
			]),
		))
		.unwrap();
		proj.apply_snapshot(&snapshot(
			json!([workspace("w1", "App")]),
			json!([tab("w1:t1", "w1", "App")]),
			json!([pane("w1:p1", "w1:t1", "w1", "term_a2", 2)]),
		))
		.unwrap();
		assert_eq!(proj.pane_ids(), vec!["w1:p1"]);
		assert_eq!(proj.pane("w1:p1").unwrap().terminal_id, "term_a2");
		assert_eq!(
			proj.apply_event(
				"pane_updated",
				&json!({"pane": pane("w1:p2", "w1:t1", "w1", "term_b", 3)}),
			),
			ApplyOutcome::IgnoredStale
		);
		assert!(proj.pane("w1:p2").is_none());
	}

	#[test]
	fn stale_update_does_not_recreate_missing_objects() {
		let mut proj = RuntimeProjection::new();
		proj.apply_snapshot(&snapshot(
			json!([workspace("w1", "App")]),
			json!([tab("w1:t1", "w1", "App")]),
			json!([pane("w1:p1", "w1:t1", "w1", "term_a", 4)]),
		))
		.unwrap();
		assert_eq!(
			proj.apply_event(
				"pane_updated",
				&json!({"pane": pane("w1:p1", "w1:t1", "w1", "term_old", 2)}),
			),
			ApplyOutcome::IgnoredStale
		);
		assert_eq!(proj.pane("w1:p1").unwrap().terminal_id, "term_a");
		assert_eq!(
			proj.apply_event(
				"tab_renamed",
				&json!({"tab_id": "missing", "workspace_id": "w1", "label": "x"}),
			),
			ApplyOutcome::IgnoredStale
		);
		assert_eq!(
			proj.apply_event("pane_closed", &json!({"pane_id": "w1:p1"})),
			ApplyOutcome::Applied
		);
		assert!(proj.pane("w1:p1").is_none());
		assert_eq!(
			proj.apply_event(
				"pane_updated",
				&json!({"pane": pane("w1:p1", "w1:t1", "w1", "term_z", 9)}),
			),
			ApplyOutcome::IgnoredStale
		);
		assert!(proj.pane("w1:p1").is_none());
	}

	#[test]
	fn externally_removed_objects_are_dropped() {
		let mut proj = RuntimeProjection::new();
		proj.apply_snapshot(&snapshot(
			json!([workspace("w1", "App")]),
			json!([tab("w1:t1", "w1", "App")]),
			json!([
				pane("w1:p1", "w1:t1", "w1", "term_a", 1),
				pane("w1:p2", "w1:t1", "w1", "term_b", 1)
			]),
		))
		.unwrap();
		assert_eq!(
			proj.apply_event(
				"pane_closed",
				&json!({"pane_id": "w1:p2", "workspace_id": "w1"}),
			),
			ApplyOutcome::Applied
		);
		assert_eq!(proj.pane_ids(), vec!["w1:p1"]);
		assert_eq!(
			proj.apply_event(
				"workspace_closed",
				&json!({"workspace_id": "w1"}),
			),
			ApplyOutcome::Applied
		);
		assert!(proj.workspace_ids().is_empty());
		assert!(proj.tab_ids().is_empty());
		assert!(proj.pane_ids().is_empty());
	}

	fn base_snapshot(panes: Value) -> Value {
		snapshot(
			json!([workspace("w1", "App")]),
			json!([tab("w1:t1", "w1", "App")]),
			panes,
		)
	}

	#[test]
	fn bootstrap_applies_events_that_arrive_during_snapshot() {
		let mut rec = RuntimeReconciler::new();
		let gen = rec.start_epoch();
		assert_eq!(gen, 1);
		let buffered = [RuntimeEvent::new(
			gen,
			"pane_created",
			json!({"pane": pane("w1:p2", "w1:t1", "w1", "term_b", 1)}),
		)];
		rec.commit_snapshot(
			&base_snapshot(json!([pane("w1:p1", "w1:t1", "w1", "term_a", 1)])),
			&buffered,
		)
		.unwrap();
		assert_eq!(rec.projection().pane_ids(), vec!["w1:p1", "w1:p2"]);
		assert_eq!(
			rec.apply_event(&RuntimeEvent::new(
				gen,
				"pane_created",
				json!({"pane": pane("w1:p3", "w1:t1", "w1", "term_c", 1)}),
			)),
			ApplyOutcome::Applied
		);
		assert_eq!(
			rec.projection().pane_ids(),
			vec!["w1:p1", "w1:p2", "w1:p3"]
		);
	}

	#[test]
	fn stale_pre_disconnect_events_are_dropped() {
		let mut rec = RuntimeReconciler::new();
		let first = rec
			.bootstrap(
				&base_snapshot(json!([pane(
					"w1:p1", "w1:t1", "w1", "term_a", 1
				)])),
				&[],
			)
			.unwrap();
		assert_eq!(
			rec.apply_event(&RuntimeEvent::new(
				first,
				"pane_created",
				json!({"pane": pane("w1:p2", "w1:t1", "w1", "term_b", 1)}),
			)),
			ApplyOutcome::Applied
		);
		let second = rec
			.rebuild(
				&base_snapshot(json!([pane(
					"w1:p1", "w1:t1", "w1", "term_a", 2
				)])),
				&[],
			)
			.unwrap();
		assert_ne!(first, second);
		assert_eq!(rec.projection().pane_ids(), vec!["w1:p1"]);
		assert_eq!(
			rec.apply_event(&RuntimeEvent::new(
				first,
				"pane_created",
				json!({"pane": pane("w1:p2", "w1:t1", "w1", "term_b", 1)}),
			)),
			ApplyOutcome::IgnoredStale
		);
		assert!(rec.projection().pane("w1:p2").is_none());
		assert_eq!(
			rec.apply_event(&RuntimeEvent::new(
				first,
				"pane_updated",
				json!({"pane": pane("w1:p9", "w1:t1", "w1", "term_z", 9)}),
			)),
			ApplyOutcome::IgnoredStale
		);
		assert!(rec.projection().pane("w1:p9").is_none());
	}

	#[test]
	fn rebuild_snapshot_drops_externally_removed_objects() {
		let mut rec = RuntimeReconciler::new();
		rec.bootstrap(
			&base_snapshot(json!([
				pane("w1:p1", "w1:t1", "w1", "term_a", 1),
				pane("w1:p2", "w1:t1", "w1", "term_b", 1)
			])),
			&[],
		)
		.unwrap();
		rec.rebuild(
			&base_snapshot(json!([pane("w1:p1", "w1:t1", "w1", "term_a", 2)])),
			&[RuntimeEvent::new(
				99,
				"pane_updated",
				json!({"pane": pane("w1:p2", "w1:t1", "w1", "term_b", 3)}),
			)],
		)
		.unwrap();
		assert_eq!(rec.projection().pane_ids(), vec!["w1:p1"]);
		assert!(rec.projection().pane("w1:p2").is_none());
	}
}
