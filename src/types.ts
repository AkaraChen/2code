export interface Project {
	id: string;
	name: string;
	folder: string;
	created_at: string;
}

export interface Profile {
	id: string;
	project_id: string;
	branch_name: string;
	worktree_path: string;
	created_at: string;
}

export interface GitAuthor {
	name: string;
	email: string;
}

export interface GitCommit {
	hash: string;
	full_hash: string;
	author: GitAuthor;
	date: string;
	message: string;
	files_changed: number;
	insertions: number;
	deletions: number;
}

export interface PtySessionRecord {
	id: string;
	project_id: string;
	title: string;
	shell: string;
	cwd: string;
	created_at: string;
	closed_at: string | null;
}
