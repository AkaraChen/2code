import consola from "consola";
import {
	closePtySession,
	deletePtySessionRecord,
	restorePtySession,
} from "@/generated";
import { removeTerminalStorage } from "./lib";
import {
	useTerminalStore,
	type PendingTerminalRestore,
	type TerminalTab,
} from "./store";

/**
 * Transient scrollback data for restored sessions.
 * Written during restoration, consumed once by Terminal.tsx on mount, then deleted.
 */
export const sessionHistory = new Map<string, Uint8Array>();

const pendingRestores = new Map<string, Promise<void>>();

export function restorePendingTerminalTab(
	profileId: string,
	tab: TerminalTab,
): Promise<void> {
	if (!tab.restore) return Promise.resolve();

	const restore = tab.restore;
	const key = `${profileId}:${restore.oldSessionId}`;
	const existing = pendingRestores.get(key);
	if (existing) return existing;

	const promise = runRestore(profileId, tab.title, restore)
		.catch((error) => {
			consola.error(`[pty-restore] failed: ${restore.oldSessionId}`, error);
			useTerminalStore.getState().closeTab(profileId, restore.oldSessionId);
		})
		.finally(() => {
			pendingRestores.delete(key);
		});
	pendingRestores.set(key, promise);
	return promise;
}

async function runRestore(
	profileId: string,
	title: string,
	restore: PendingTerminalRestore,
) {
	const result = await restorePtySession({
		oldSessionId: restore.oldSessionId,
		meta: { profileId, title },
		config: {
			shell: restore.shell,
			cwd: restore.cwd,
			rows: restore.rows,
			cols: restore.cols,
			startupCommands: [],
		},
	});

	removeTerminalStorage(restore.oldSessionId);

	if (!isPendingRestoreStillOpen(profileId, restore.oldSessionId)) {
		await Promise.allSettled([
			closePtySession({ sessionId: result.newSessionId }),
			deletePtySessionRecord({ sessionId: result.newSessionId }),
		]);
		return;
	}

	if (result.history.length > 0) {
		sessionHistory.set(result.newSessionId, new Uint8Array(result.history));
	}

	useTerminalStore
		.getState()
		.finishRestoringTab(profileId, restore.oldSessionId, result.newSessionId);
}

function isPendingRestoreStillOpen(profileId: string, oldSessionId: string) {
	return !!useTerminalStore
		.getState()
		.profiles[profileId]?.tabs.some(
			(tab) => tab.id === oldSessionId && tab.restore,
		);
}
