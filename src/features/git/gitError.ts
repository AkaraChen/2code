// Mirror of the Rust GitError type in src-tauri/crates/model/src/git_error.rs.
// Hand-written until a Phase 2/4 command actually returns a structured GitError
// — at that point tauri-typegen will start generating these types and the
// hand-written shape can be replaced with the generated one.

import { toaster } from "@/shared/providers/Toaster";

export type GitErrorKind =
	| { kind: "non_fast_forward" }
	| { kind: "auth_failed" }
	| { kind: "merge_conflict"; details: { paths: string[] } }
	| { kind: "dirty_worktree" }
	| { kind: "detached_head" }
	| { kind: "branch_exists"; details: { branch: string } }
	| { kind: "branch_not_found"; details: { branch: string } }
	| { kind: "remote_not_found"; details: { remote: string } }
	| { kind: "not_a_repo" }
	| { kind: "other"; details: string };

export interface GitError {
	kind: GitErrorKind;
	message: string;
}

/** Type guard: is `value` a structured GitError from the backend? */
export function isGitError(value: unknown): value is GitError {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (typeof v.message !== "string") return false;
	if (!v.kind || typeof v.kind !== "object") return false;
	return typeof (v.kind as Record<string, unknown>).kind === "string";
}

/** Title + description tuned for each error variant. */
export function describeGitError(err: GitError): {
	title: string;
	description: string;
	action?: { label: string; hint: string };
} {
	switch (err.kind.kind) {
		case "non_fast_forward":
			return {
				title: "Push rejected",
				description:
					"The remote has commits you don't. Pull first, or force-push with lease.",
				action: { label: "Pull", hint: "git pull --rebase" },
			};
		case "auth_failed":
			return {
				title: "Authentication failed",
				description:
					"Check your credentials, SSH key, or git credential helper.",
			};
		case "merge_conflict": {
			const paths = err.kind.details.paths;
			return {
				title: "Merge conflict",
				description:
					paths.length === 0
						? "Resolve conflicts to continue."
						: `Resolve conflicts in: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? `, +${paths.length - 3} more` : ""}`,
			};
		}
		case "dirty_worktree":
			return {
				title: "Uncommitted changes",
				description:
					"Commit, stash, or discard your changes before continuing.",
			};
		case "detached_head":
			return {
				title: "Detached HEAD",
				description:
					"You're not on a branch. Create one or check out an existing branch.",
			};
		case "branch_exists":
			return {
				title: "Branch already exists",
				description: `'${err.kind.details.branch}' already exists.`,
			};
		case "branch_not_found":
			return {
				title: "Branch not found",
				description: `'${err.kind.details.branch}' doesn't exist.`,
			};
		case "remote_not_found":
			return {
				title: "Remote not found",
				description: `'${err.kind.details.remote}' is not configured.`,
			};
		case "not_a_repo":
			return {
				title: "Not a git repository",
				description: "This folder isn't initialized as a git repo.",
			};
		case "other":
			return {
				title: "Git error",
				description: err.message || err.kind.details,
			};
	}
}

/** Show a structured git error toast. Falls back to a generic toast for
 * unknown shapes. Returns true if the value was a recognized GitError. */
export function showGitErrorToast(err: unknown): boolean {
	if (isGitError(err)) {
		const { title, description } = describeGitError(err);
		toaster.create({ type: "error", title, description, duration: 6000 });
		return true;
	}
	const message =
		err instanceof Error
			? err.message
			: typeof err === "string"
				? err
				: "Unknown git error";
	toaster.create({
		type: "error",
		title: "Git error",
		description: message,
		duration: 6000,
	});
	return false;
}
