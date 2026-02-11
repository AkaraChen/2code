import { invoke } from "@tauri-apps/api/core";
import type { PtySessionRecord } from "@/types";

export const ptyApi = {
	createSession: (
		projectId: string,
		title: string,
		shell: string,
		cwd: string,
		rows: number,
		cols: number,
	) =>
		invoke<string>("create_pty_session", {
			projectId,
			title,
			shell,
			cwd,
			rows,
			cols,
		}),

	write: (sessionId: string, data: string) =>
		invoke<void>("write_to_pty", { sessionId, data }),

	resize: (sessionId: string, rows: number, cols: number) =>
		invoke<void>("resize_pty", { sessionId, rows, cols }),

	close: (sessionId: string) =>
		invoke<void>("close_pty_session", { sessionId }),

	listActiveSessions: (projectId: string) =>
		invoke<PtySessionRecord[]>("list_active_sessions", { projectId }),

	getHistory: (sessionId: string) =>
		invoke<number[]>("get_pty_session_history", { sessionId }),

	deleteRecord: (sessionId: string) =>
		invoke<void>("delete_pty_session_record", { sessionId }),
};
