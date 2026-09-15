//! Read-only Herdr runtime projection (Task 6).
//!
//! Bootstrap is subscribe ack → buffer → `session.snapshot` → drain,
//! then live events. Disconnect starts a new epoch so pre-disconnect
//! events are dropped. Objects are keyed by `workspace_id` / `tab_id` /
//! `pane_id`, never by display name.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use infra::herdr::process::HerdrEndpoint;
use infra::herdr::transport::{
	HerdrClient, HerdrClientOptions, HerdrSubscription, HerdrTransportError,
	SubscriptionEvent,
};
use model::error::AppError;
use serde_json::{json, Value};

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
	Rebuilt,
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

const SUBSCRIBE_TYPES: &[&str] = &[
	"workspace.created",
	"workspace.updated",
	"workspace.metadata_updated",
	"workspace.renamed",
	"workspace.moved",
	"workspace.reordered",
	"workspace.closed",
	"workspace.focused",
	"worktree.created",
	"worktree.opened",
	"worktree.removed",
	"tab.created",
	"tab.closed",
	"tab.focused",
	"tab.renamed",
	"tab.moved",
	"pane.created",
	"pane.closed",
	"pane.updated",
	"pane.focused",
	"pane.moved",
	"pane.exited",
	"pane.agent_detected",
	"layout.updated",
];

/// `events.subscribe` params for the read-only runtime projection.
pub fn runtime_subscribe_params() -> Value {
	json!({
		"subscriptions": SUBSCRIBE_TYPES
			.iter()
			.map(|kind| json!({ "type": kind }))
			.collect::<Vec<_>>(),
	})
}

struct EventPump {
	generation: u64,
	rx: mpsc::Receiver<Result<SubscriptionEvent, HerdrTransportError>>,
	shutdown: Arc<AtomicBool>,
	join: Option<JoinHandle<()>>,
}

impl EventPump {
	fn spawn(
		mut sub: HerdrSubscription,
		generation: u64,
	) -> Result<Self, AppError> {
		let (tx, rx) = mpsc::channel();
		let shutdown = Arc::new(AtomicBool::new(false));
		let flag = Arc::clone(&shutdown);
		let join = thread::Builder::new()
			.name("herdr-runtime-sync".into())
			.spawn(move || loop {
				if flag.load(Ordering::SeqCst) {
					break;
				}
				match sub.poll_event() {
					Ok(Some(event)) => {
						if tx.send(Ok(event)).is_err() {
							break;
						}
					}
					Ok(None) => {}
					Err(err) => {
						let _ = tx.send(Err(err));
						break;
					}
				}
			})
			.map_err(AppError::from)?;
		Ok(Self {
			generation,
			rx,
			shutdown,
			join: Some(join),
		})
	}

	fn drain(&self) -> Result<Vec<RuntimeEvent>, AppError> {
		let mut buffered = Vec::new();
		loop {
			match self.rx.try_recv() {
				Ok(Ok(event)) => buffered.push(RuntimeEvent::new(
					self.generation,
					event.event,
					event.data,
				)),
				Ok(Err(err)) => return Err(err.into()),
				Err(mpsc::TryRecvError::Empty) => return Ok(buffered),
				Err(mpsc::TryRecvError::Disconnected) => {
					return Err(AppError::HerdrTransport(
						"Herdr subscribe pump stopped".into(),
					));
				}
			}
		}
	}
}

impl Drop for EventPump {
	fn drop(&mut self) {
		self.shutdown.store(true, Ordering::SeqCst);
		if let Some(join) = self.join.take() {
			let _ = join.join();
		}
	}
}

/// Read-only `events.subscribe` + `session.snapshot` client.
///
/// Linux Unix is the verified path. macOS uses the same Unix client at
/// compile time and is not claimed as executed (#401). Windows named
/// pipes are not claimed as live-verified (#399). This type never
/// creates or closes terminals, attaches CLI frames, or sends
/// `server.stop`.
pub struct HerdrRuntimeSync {
	client: HerdrClient,
	options: HerdrClientOptions,
	path: PathBuf,
	reconciler: RuntimeReconciler,
	pump: Option<EventPump>,
}

impl HerdrRuntimeSync {
	pub fn connect(endpoint: &HerdrEndpoint) -> Result<Self, AppError> {
		Self::connect_path(&endpoint.socket_path)
	}

	pub fn connect_path(path: &Path) -> Result<Self, AppError> {
		Self::connect_with(path, HerdrClientOptions::default())
	}

	pub fn connect_with(
		path: &Path,
		options: HerdrClientOptions,
	) -> Result<Self, AppError> {
		let client = HerdrClient::connect_with(path, options.clone())?;
		let mut sync = Self {
			client,
			options,
			path: path.to_path_buf(),
			reconciler: RuntimeReconciler::new(),
			pump: None,
		};
		sync.rebuild()?;
		Ok(sync)
	}

	pub fn projection(&self) -> &RuntimeProjection {
		self.reconciler.projection()
	}

	pub fn generation(&self) -> u64 {
		self.reconciler.generation()
	}

	/// Fresh subscribe + snapshot. Drops the previous event pump so
	/// pre-disconnect lines cannot be applied.
	pub fn rebuild(&mut self) -> Result<(), AppError> {
		self.pump = None;
		let generation = self.reconciler.start_epoch();
		let id = format!("sync-{generation}");
		let sub = HerdrSubscription::connect_with(
			&self.path,
			&id,
			runtime_subscribe_params(),
			self.options.clone(),
		)?;
		let pump = EventPump::spawn(sub, generation)?;
		let snap = self.client.session_snapshot()?;
		let buffered = pump.drain()?;
		self.reconciler.commit_snapshot(&snap.result, &buffered)?;
		for event in pump.drain()? {
			self.reconciler.apply_event(&event);
		}
		self.pump = Some(pump);
		Ok(())
	}

	/// Apply one live event, or resubscribe after disconnect.
	pub fn poll(
		&mut self,
		timeout: Duration,
	) -> Result<ApplyOutcome, AppError> {
		let msg = {
			let pump = self.pump.as_mut().ok_or_else(|| {
				AppError::HerdrTransport(
					"Herdr runtime sync is not subscribed".into(),
				)
			})?;
			pump.rx.recv_timeout(timeout)
		};
		match msg {
			Ok(Ok(event)) => {
				let generation =
					self.pump.as_ref().map(|pump| pump.generation).unwrap_or(0);
				Ok(self.reconciler.apply_event(&RuntimeEvent::new(
					generation,
					event.event,
					event.data,
				)))
			}
			Ok(Err(HerdrTransportError::Disconnected { .. }))
			| Err(RecvTimeoutError::Disconnected) => {
				self.rebuild()?;
				Ok(ApplyOutcome::Rebuilt)
			}
			Ok(Err(err)) => Err(err.into()),
			Err(RecvTimeoutError::Timeout) => Ok(ApplyOutcome::Ignored),
		}
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

	#[test]
	fn subscribe_params_cover_lifecycle_not_output_waits() {
		let params = runtime_subscribe_params();
		let types: Vec<&str> = params["subscriptions"]
			.as_array()
			.unwrap()
			.iter()
			.map(|item| item["type"].as_str().unwrap())
			.collect();
		assert!(types.contains(&"pane.created"));
		assert!(types.contains(&"pane.closed"));
		assert!(types.contains(&"workspace.closed"));
		assert!(types.contains(&"tab.created"));
		assert!(types.contains(&"layout.updated"));
		assert!(!types.contains(&"pane.output_matched"));
		assert!(!types.contains(&"pane.agent_status_changed"));
	}
}

#[cfg(all(test, unix))]
mod unix_tests {
	use super::*;
	use serde_json::json;
	use std::io::{BufRead, BufReader, Read, Write};
	use std::os::unix::net::{UnixListener, UnixStream};
	use std::sync::{Arc, Mutex};
	use std::thread;
	use std::time::Duration;

	use infra::herdr::transport::HerdrClientOptions;

	fn snapshot_result(panes: Value) -> Value {
		json!({
			"type": "session_snapshot",
			"snapshot": {
				"version": "0.9.0",
				"protocol": 22,
				"workspaces": [{
					"workspace_id": "w1",
					"number": 1,
					"label": "App",
					"focused": false,
					"pane_count": 1,
					"tab_count": 1,
					"active_tab_id": "w1:t1",
					"agent_status": "unknown"
				}],
				"tabs": [{
					"tab_id": "w1:t1",
					"workspace_id": "w1",
					"number": 1,
					"label": "App",
					"focused": false,
					"pane_count": 1,
					"agent_status": "unknown"
				}],
				"panes": panes,
				"layouts": [],
				"agents": []
			}
		})
	}

	fn pane_obj(id: &str, term: &str, rev: u64) -> Value {
		json!({
			"pane_id": id,
			"tab_id": "w1:t1",
			"workspace_id": "w1",
			"terminal_id": term,
			"focused": false,
			"agent_status": "unknown",
			"revision": rev
		})
	}

	fn pane_created(id: &str, term: &str, rev: u64) -> Value {
		json!({
			"event": "pane_created",
			"data": {
				"type": "pane_created",
				"pane": pane_obj(id, term, rev)
			}
		})
	}

	fn test_options() -> HerdrClientOptions {
		HerdrClientOptions {
			max_message_bytes: 64 * 1024,
			read_poll: Duration::from_millis(50),
			request_timeout: Some(Duration::from_secs(2)),
		}
	}

	struct Mock {
		methods: Arc<Mutex<Vec<String>>>,
		subscribe: Arc<Mutex<Option<UnixStream>>>,
		_dir: tempfile::TempDir,
		sock: std::path::PathBuf,
	}

	impl Mock {
		fn start(snapshots: Vec<Value>, bootstrap: Vec<Value>) -> Self {
			let dir = tempfile::tempdir().unwrap();
			let sock = dir.path().join("api.sock");
			let listener = UnixListener::bind(&sock).unwrap();
			let methods = Arc::new(Mutex::new(Vec::new()));
			let snapshots = Arc::new(Mutex::new(snapshots));
			let bootstrap = Arc::new(Mutex::new(bootstrap));
			let subscribe = Arc::new(Mutex::new(None));
			let methods_h = Arc::clone(&methods);
			let snapshots_h = Arc::clone(&snapshots);
			let bootstrap_h = Arc::clone(&bootstrap);
			let subscribe_h = Arc::clone(&subscribe);
			thread::spawn(move || {
				for stream in listener.incoming().flatten() {
					let methods = Arc::clone(&methods_h);
					let snapshots = Arc::clone(&snapshots_h);
					let bootstrap = Arc::clone(&bootstrap_h);
					let subscribe = Arc::clone(&subscribe_h);
					thread::spawn(move || {
						handle_conn(
							stream, methods, snapshots, bootstrap, subscribe,
						);
					});
				}
			});
			Self {
				methods,
				subscribe,
				_dir: dir,
				sock,
			}
		}

		fn connect(&self) -> HerdrRuntimeSync {
			HerdrRuntimeSync::connect_with(&self.sock, test_options()).unwrap()
		}

		fn methods(&self) -> Vec<String> {
			self.methods.lock().unwrap().clone()
		}
	}

	fn handle_conn(
		mut stream: UnixStream,
		methods: Arc<Mutex<Vec<String>>>,
		snapshots: Arc<Mutex<Vec<Value>>>,
		bootstrap: Arc<Mutex<Vec<Value>>>,
		subscribe: Arc<Mutex<Option<UnixStream>>>,
	) {
		let mut line = String::new();
		if BufReader::new(stream.try_clone().unwrap())
			.read_line(&mut line)
			.unwrap_or(0)
			== 0
		{
			return;
		}
		let req: Value = serde_json::from_str(&line).unwrap();
		let method = req["method"].as_str().unwrap_or("").to_string();
		methods.lock().unwrap().push(method.clone());
		assert!(
			method == "events.subscribe" || method == "session.snapshot",
			"read-only sync sent {method}"
		);
		match method.as_str() {
			"events.subscribe" => {
				let id = req["id"].as_str().unwrap();
				*subscribe.lock().unwrap() = Some(stream.try_clone().unwrap());
				writeln!(
					stream,
					"{{\"id\":\"{id}\",\"result\":{{\"type\":\"subscription_started\"}}}}"
				)
				.unwrap();
				let _ = stream.flush();
				let mut buf = [0_u8; 8];
				loop {
					match stream.read(&mut buf) {
						Ok(0) | Err(_) => break,
						Ok(_) => {}
					}
				}
			}
			"session.snapshot" => {
				if let Some(sub) = subscribe.lock().unwrap().as_mut() {
					for event in bootstrap.lock().unwrap().drain(..) {
						writeln!(sub, "{event}").unwrap();
					}
					let _ = sub.flush();
				}
				let id = req["id"].as_str().unwrap();
				let result = snapshots.lock().unwrap().remove(0);
				writeln!(stream, r#"{{"id":"{id}","result":{result}}}"#)
					.unwrap();
			}
			_ => panic!("unexpected method {method}"),
		}
	}

	#[test]
	fn subscribe_snapshot_applies_bootstrap_then_live_events() {
		let mock = Mock::start(
			vec![snapshot_result(json!([pane_obj("w1:p1", "term_a", 1)]))],
			vec![pane_created("w1:p2", "term_b", 1)],
		);
		let mut sync = mock.connect();
		if sync.projection().pane("w1:p2").is_none() {
			let _ = sync.poll(Duration::from_millis(400));
		}
		assert_eq!(sync.projection().pane_ids(), vec!["w1:p1", "w1:p2"]);
		{
			let mut slot = mock.subscribe.lock().unwrap();
			let sub = slot.as_mut().expect("subscribe stream");
			writeln!(sub, "{}", pane_created("w1:p3", "term_c", 1)).unwrap();
			let _ = sub.flush();
		}
		let mut applied = false;
		for _ in 0..10 {
			if sync.poll(Duration::from_millis(200)).unwrap()
				== ApplyOutcome::Applied
			{
				applied = true;
				break;
			}
		}
		assert!(applied);
		assert_eq!(
			sync.projection().pane_ids(),
			vec!["w1:p1", "w1:p2", "w1:p3"]
		);
		assert!(mock
			.methods()
			.iter()
			.all(|m| { m == "events.subscribe" || m == "session.snapshot" }));
	}

	#[test]
	fn disconnect_rebuilds_and_drops_stale_events() {
		let mock = Mock::start(
			vec![
				snapshot_result(json!([
					pane_obj("w1:p1", "term_a", 1),
					pane_obj("w1:p2", "term_b", 1)
				])),
				snapshot_result(json!([pane_obj("w1:p1", "term_a", 2)])),
			],
			vec![],
		);
		let mut sync = mock.connect();
		assert_eq!(sync.projection().pane_ids(), vec!["w1:p1", "w1:p2"]);
		let first_gen = sync.generation();
		{
			let mut slot = mock.subscribe.lock().unwrap();
			if let Some(sub) = slot.take() {
				let _ = sub.shutdown(std::net::Shutdown::Both);
			}
		}
		let mut rebuilt = false;
		for _ in 0..20 {
			match sync.poll(Duration::from_millis(200)).unwrap() {
				ApplyOutcome::Rebuilt => {
					rebuilt = true;
					break;
				}
				ApplyOutcome::IgnoredStale | ApplyOutcome::Ignored => {}
				other => panic!("unexpected {other:?}"),
			}
		}
		assert!(rebuilt);
		assert_ne!(sync.generation(), first_gen);
		assert_eq!(sync.projection().pane_ids(), vec!["w1:p1"]);
		assert!(sync.projection().pane("w1:p2").is_none());
		assert!(mock
			.methods()
			.iter()
			.all(|m| { m == "events.subscribe" || m == "session.snapshot" }));
		assert_eq!(
			mock.methods()
				.iter()
				.filter(|m| *m == "events.subscribe")
				.count(),
			2
		);
		assert_eq!(
			mock.methods()
				.iter()
				.filter(|m| *m == "session.snapshot")
				.count(),
			2
		);
	}
}
