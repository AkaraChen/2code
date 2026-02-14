import {
	closePtySession,
	createPtySession,
	deletePtySessionRecord,
	restorePtySession,
} from "@/generated";
import { TabSession } from "./session";
import type { TerminalTab } from "./types";

const DEFAULT_SHELL = "/bin/zsh";

export class TerminalTabSession extends TabSession {
	readonly type = "terminal" as const;

	static async create(
		profileId: string,
		cwd: string,
		title: string,
	): Promise<TerminalTabSession> {
		const sessionId = await createPtySession({
			meta: { profileId, title },
			config: { shell: DEFAULT_SHELL, cwd, rows: 24, cols: 80 },
		});
		return new TerminalTabSession(sessionId, profileId, title);
	}

	static async restore(record: {
		id: string;
		profile_id: string;
		title: string;
		shell: string;
		cwd: string;
		rows: number;
		cols: number;
	}): Promise<{ session: TerminalTabSession; history: Uint8Array }> {
		const result = await restorePtySession({
			oldSessionId: record.id,
			meta: { profileId: record.profile_id, title: record.title },
			config: {
				shell: record.shell,
				cwd: record.cwd,
				rows: record.rows,
				cols: record.cols,
			},
		});
		return {
			session: new TerminalTabSession(
				result.newSessionId,
				record.profile_id,
				record.title,
			),
			history: new Uint8Array(result.history),
		};
	}

	async close(): Promise<void> {
		await Promise.all([
			closePtySession({ sessionId: this.id }),
			deletePtySessionRecord({ sessionId: this.id }),
		]);
	}

	toTab(): TerminalTab {
		return { type: "terminal", id: this.id, title: this.title };
	}
}
