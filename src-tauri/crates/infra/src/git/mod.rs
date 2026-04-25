pub mod audit;
pub mod backend;
pub mod cli;
pub mod gix;
pub mod identity;
pub mod watcher;

pub use backend::{default_backend, CliBackend, GitBackend, GixBackend};
pub use cli::*;
pub use identity::{Identity, IdentityScope};
pub use watcher::{watch_git_dir, WatchHandle};
