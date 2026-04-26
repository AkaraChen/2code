// Hand-written bindings for the Phase 2 backend commands until the next
// `cargo tauri-typegen generate` lands the typed versions in @/generated.
// Keep these in lockstep with src-tauri/src/handler/project.rs.

import { invoke } from "@tauri-apps/api/core";

export type GitChangeKind =
	| "added"
	| "modified"
	| "deleted"
	| "renamed"
	| "copied"
	| "untracked"
	| "type_changed"
	| "unmerged";

export interface IndexEntry {
	path: string;
	original_path: string | null;
	kind: GitChangeKind;
}

export interface IndexStatus {
	staged: IndexEntry[];
	unstaged: IndexEntry[];
}

export const getGitIndexStatus = (args: { profileId: string }) =>
	invoke<IndexStatus>("get_git_index_status", args);

export const isGitRepo = (args: { profileId: string }) =>
	invoke<boolean>("is_git_repo", args);

export const getGitFilePatch = (args: {
	profileId: string;
	path: string;
	staged: boolean;
}) => invoke<string>("get_git_file_patch", args);

export const stageGitFiles = (args: {
	profileId: string;
	paths: string[];
}) => invoke<void>("stage_git_files", args);

export const unstageGitFiles = (args: {
	profileId: string;
	paths: string[];
}) => invoke<void>("unstage_git_files", args);

export const stageGitHunk = (args: {
	profileId: string;
	fileHeader: string;
	hunks: string[];
}) => invoke<void>("stage_git_hunk", args);

export const unstageGitHunk = (args: {
	profileId: string;
	fileHeader: string;
	hunks: string[];
}) => invoke<void>("unstage_git_hunk", args);

export const stageGitLines = (args: {
	profileId: string;
	fileHeader: string;
	hunk: string;
	selectedIndices: number[];
}) => invoke<void>("stage_git_lines", args);

export const unstageGitLines = (args: {
	profileId: string;
	fileHeader: string;
	hunk: string;
	selectedIndices: number[];
}) => invoke<void>("unstage_git_lines", args);

// --- identity ---

export interface Identity {
	name: string;
	email: string;
}

export type IdentityScope = "profile" | "project";

export const getGitIdentity = (args: { profileId: string }) =>
	invoke<Identity | null>("get_git_identity", args);

export const setGitIdentityCmd = (args: {
	profileId: string;
	identity: Identity;
	scope: IdentityScope;
}) => invoke<void>("set_git_identity", args);

export const unsetGitIdentityCmd = (args: {
	profileId: string;
	scope: IdentityScope;
}) => invoke<void>("unset_git_identity", args);

// --- history rewrite ---

export type CommitAction =
	| { type: "keep" }
	| { type: "reword"; message: string }
	| { type: "squash" }
	| { type: "fixup" }
	| {
			type: "set_identity";
			author: Identity | null;
			committer: Identity | null;
	  }
	| { type: "drop" };

export interface RewritePlan {
	base: string;
	actions: Array<[string, CommitAction]>;
	create_backup_branch: boolean;
}

export interface RewriteOutcome {
	new_head: string;
	backup_branch: string | null;
	force_push_required: boolean;
}

export const amendHeadCommitMessage = (args: {
	profileId: string;
	message: string;
}) => invoke<string>("amend_head_commit_message", args);

export const rewriteGitCommits = (args: {
	profileId: string;
	plan: RewritePlan;
}) => invoke<RewriteOutcome>("rewrite_git_commits", args);

export const rewriteForcePushRequired = (args: {
	profileId: string;
	plan: RewritePlan;
}) => invoke<boolean>("rewrite_force_push_required", args);
