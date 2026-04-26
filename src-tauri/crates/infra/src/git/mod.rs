pub mod audit;
pub mod backend;
pub mod branches;
pub mod cancel;
pub mod cli;
pub mod gix;
pub mod graph;
pub mod identity;
pub mod inprogress;
pub mod rewrite;
pub mod stash;
pub mod watcher;

pub use backend::{default_backend, CliBackend, GitBackend, GixBackend};
pub use branches::{
	checkout_branch, create_branch, delete_branch, list_branches,
	list_remotes, list_tags, rename_branch,
};
pub use cancel::{run_cancellable, CancelToken};
pub use cli::*;
pub use graph::get_commit_graph;
pub use identity::{Identity, IdentityScope};
pub use rewrite::{
	amend_head_message, compute_force_push_required, rewrite_commits_safe,
};
pub use inprogress::{
	abort_op, continue_op, get_conflict_state, get_in_progress_op,
	mark_conflict_resolved, ConflictState, InProgressKind, InProgressOp,
};
pub use stash::{
	stash_apply, stash_drop, stash_list, stash_pop, stash_push,
};
pub use watcher::{watch_git_dir, WatchHandle};
