use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub type WatcherShutdownFlag = Arc<AtomicBool>;

pub fn create_shutdown_flag() -> WatcherShutdownFlag {
	Arc::new(AtomicBool::new(false))
}

#[cfg(test)]
mod tests {
	use std::sync::atomic::Ordering;

	use super::create_shutdown_flag;

	#[test]
	fn create_shutdown_flag_starts_cleared() {
		let flag = create_shutdown_flag();
		assert!(!flag.load(Ordering::Relaxed));
	}

	#[test]
	fn cloned_flags_share_the_same_shutdown_state() {
		let flag = create_shutdown_flag();
		let cloned = flag.clone();

		cloned.store(true, Ordering::Relaxed);

		assert!(flag.load(Ordering::Relaxed));
	}
}
