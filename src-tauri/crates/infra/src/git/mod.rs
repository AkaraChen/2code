pub mod backend;
pub mod cli;
pub mod gix;
pub mod identity;

pub use backend::{default_backend, CliBackend, GitBackend, GixBackend};
pub use cli::*;
pub use identity::{Identity, IdentityScope};
