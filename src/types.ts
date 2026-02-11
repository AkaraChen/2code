export interface Project {
	id: string;
	name: string;
	folder: string;
	created_at: string;
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
