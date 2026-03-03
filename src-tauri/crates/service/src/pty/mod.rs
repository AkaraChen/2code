use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};

use infra::db::DbPool;
use infra::pty::{PtyReadThreads, PtySessionMap};

use crate::PtyEventEmitter;

pub mod persist;
pub mod sanitize;
pub mod session;

pub use persist::{create_flush_senders, flush_output};
pub use session::{
	close_session, create_session, delete_session, get_history, list_project_sessions,
	mark_all_closed, restore_all_sessions,
};

pub enum PersistMsg {
	Data(Vec<u8>),
	Flush,
	Clear,
}

pub type PtyFlushSenders = Arc<Mutex<HashMap<String, mpsc::Sender<PersistMsg>>>>;

/// All dependencies needed to create a PTY session, fully decoupled from Tauri.
pub struct PtyContext {
	pub db: DbPool,
	pub sessions: PtySessionMap,
	pub flush_senders: PtyFlushSenders,
	pub read_threads: PtyReadThreads,
	pub emitter: Arc<dyn PtyEventEmitter>,
	pub helper_url: Option<String>,
	pub helper_bin: Option<String>,
}
