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
