import {
	closePtySession,
	createPtySession,
	deletePtySessionRecord,
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

	async close(): Promise<void> {
		await Promise.all([
			closePtySession({ sessionId: this.id }),
			deletePtySessionRecord({ sessionId: this.id }),
		]);
	}

	toTab(): TerminalTab {
		return {
			type: "terminal",
			id: this.id,
			title: this.title,
			panes: [{ sessionId: this.id, title: this.title }],
			activePaneId: this.id,
		};
	}
}
