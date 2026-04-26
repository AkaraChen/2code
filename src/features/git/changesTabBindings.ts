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

export const gitInitRepo = (args: { profileId: string }) =>
	invoke<void>("git_init_repo", args);

export const addGitRemote = (args: {
	profileId: string;
	name: string;
	url: string;
}) => invoke<void>("add_git_remote", args);

export const getGitFilePatch = (args: {
	profileId: string;
	path: string;
	staged: boolean;
}) => invoke<string>("get_git_file_patch", args);

export interface FileDiffSides {
	original: string | null;
	modified: string | null;
	too_large: boolean;
}

export const getGitFileDiffSides = (args: {
	profileId: string;
	path: string;
	staged: boolean;
}) => invoke<FileDiffSides>("get_git_file_diff_sides", args);

export const getCommitFiles = (args: {
	profileId: string;
	commitHash: string;
}) => invoke<IndexEntry[]>("get_commit_files", args);

export const getCommitFileDiffSides = (args: {
	profileId: string;
	commitHash: string;
	path: string;
	mergedWith: string | null;
}) => invoke<FileDiffSides>("get_commit_file_diff_sides", args);

export const revertFileInCommit = (args: {
	profileId: string;
	commitHash: string;
	path: string;
}) => invoke<void>("revert_file_in_commit", args);

// ── Phase 3: log graph ──

export interface LogFilter {
	branch?: string | null;
	author?: string | null;
	since?: string | null;
	until?: string | null;
	path?: string | null;
	text_query?: string | null;
	content_query?: string | null;
	limit?: number | null;
}

export type CommitRef =
	| { kind: "branch"; name: string }
	| { kind: "tag"; name: string }
	| { kind: "remote_branch"; name: string }
	| { kind: "head" };

export interface GraphEdge {
	from_lane: number;
	to_lane: number;
}

export interface GraphRow {
	commit: {
		hash: string;
		full_hash: string;
		author: { name: string; email: string };
		date: string;
		message: string;
		files_changed: number;
		insertions: number;
		deletions: number;
	};
	parents: string[];
	lane: number;
	color: number;
	edges_down: GraphEdge[];
	refs: CommitRef[];
	needs_push: boolean;
	signed: boolean;
}

export const getCommitGraph = (args: {
	profileId: string;
	filter: LogFilter;
}) => invoke<GraphRow[]>("get_commit_graph", args);

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
