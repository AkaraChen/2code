use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub type WatcherShutdownFlag = Arc<AtomicBool>;

pub fn create_shutdown_flag() -> WatcherShutdownFlag {
	Arc::new(AtomicBool::new(false))
}
