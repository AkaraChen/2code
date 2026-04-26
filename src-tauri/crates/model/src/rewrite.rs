//! History rewrite types — used by the Phase 2.5 rewrite_commits engine.
//!
//! A `RewritePlan` is what the frontend sends to the backend to drive a
//! `git rebase -i` programmatically. One unified type powers all four
//! user-facing operations (edit message, squash, bulk identity rewrite, drop).

use serde::{Deserialize, Serialize};

/// Per-commit rewrite action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommitAction {
	/// Keep the commit as-is. Maps to `pick`.
	Keep,

	/// Replace the commit message. Maps to `reword` followed by an automated
	/// `git commit --amend -m <new_message>` during the rebase pause.
	Reword { message: String },

	/// Fold this commit into the previous one. Maps to `squash`. The combined
	/// message is taken from the previous commit's Reword (or the prior
	/// pick), so the caller usually pairs N-1 squashes with one final
	/// Reword on the target.
	Squash,

	/// Same as Squash but discards this commit's message entirely (uses only
	/// the previous commit's message). Maps to `fixup`.
	Fixup,

	/// Override author/committer. Internally pauses on `edit` and runs
	/// `git commit --amend --no-edit` with the right env vars.
	SetIdentity {
		author: Option<Identity>,
		committer: Option<Identity>,
	},

	/// Drop the commit entirely. Maps to `drop`.
	Drop,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
	pub name: String,
	pub email: String,
}

/// Ordered (oldest → newest) plan that drives one `git rebase -i` invocation.
///
/// `actions` is `(commit_hash, action)` pairs covering EVERY commit from
/// `base..HEAD` — including unaffected ones (which get `CommitAction::Keep`).
/// This makes the resulting rebase todo unambiguous and easy to validate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewritePlan {
	/// SHA of the commit BEFORE the oldest affected commit (the rebase base).
	/// Use the special string "--root" to rewrite from the very first commit.
	pub base: String,

	/// Ordered oldest → newest. Includes Keep entries for unaffected commits.
	pub actions: Vec<(String, CommitAction)>,

	/// If true, create `<branch>-backup-<unix-ts>` before starting.
	/// Default ON in the UI dialogs — cheap insurance.
	pub create_backup_branch: bool,
}

/// Result of a successful rewrite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewriteOutcome {
	/// The HEAD SHA after the rewrite.
	pub new_head: String,
	/// The backup branch name, if one was created.
	pub backup_branch: Option<String>,
	/// True if a force-push will be required to push the rewritten branch.
	pub force_push_required: bool,
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn commit_action_serializes_with_tag() {
		let action = CommitAction::Reword {
			message: "feat: x".into(),
		};
		let json = serde_json::to_value(&action).unwrap();
		assert_eq!(json["type"], "reword");
		assert_eq!(json["message"], "feat: x");
	}

	#[test]
	fn commit_action_keep_is_unit_tagged() {
		let json = serde_json::to_value(CommitAction::Keep).unwrap();
		assert_eq!(json["type"], "keep");
	}

	#[test]
	fn set_identity_carries_optional_fields() {
		let action = CommitAction::SetIdentity {
			author: Some(Identity {
				name: "A".into(),
				email: "a@a".into(),
			}),
			committer: None,
		};
		let json = serde_json::to_value(&action).unwrap();
		assert_eq!(json["type"], "set_identity");
		assert_eq!(json["author"]["name"], "A");
		assert!(json["committer"].is_null());
	}
}
