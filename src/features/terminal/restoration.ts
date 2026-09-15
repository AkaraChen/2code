import consola from "consola";
import {
	closePtySession,
	deletePtySessionRecord,
	getSessionBackend,
	restorePtySession,
} from "@/generated";
import { removeTerminalBuffer, removeTerminalStorage } from "./lib";
import {
	useTerminalStore,
	type PendingTerminalRestore,
	type TerminalTab,
} from "./store";

/**
 * Transient scrollback data for restored Local sessions.
 * Written during restoration, consumed once by Terminal.tsx on mount, then deleted.
 * Herdr reopen attaches the live pane instead and never populates this map.
 */
export const sessionHistory = new Map<string, Uint8Array>();

const pendingRestores = new Map<string, Promise<void>>();

export type RestorableSession = {
	id: string;
	profile_id: string;
	title: string;
	shell: string;
	cwd: string;
	rows: number;
	cols: number;
};

/**
 * Rebuild tabs from `list_project_sessions`. Herdr ids become live tabs on the
 * same 2code session id (attach on mount). Local ids keep the pending-restore
 * path that calls `restorePtySession`.
 */
export async function hydrateRestorableSessions(
	sessions: RestorableSession[],
): Promise<void> {
	for (const session of sessions) {
		let backend: "local" | "herdr";
		try {
			backend = await getSessionBackend({ sessionId: session.id });
		} catch (error) {
			consola.error(
				`[pty-restore] failed to resolve backend for ${session.id}`,
				error,
			);
			continue;
		}

		if (backend === "herdr") {
			reattachHerdrSession(session);
			continue;
		}

		useTerminalStore.getState().addRestoringTab(
			session.profile_id,
			session.id,
			session.title,
			{
				oldSessionId: session.id,
				shell: session.shell,
				cwd: session.cwd,
				rows: session.rows,
				cols: session.cols,
			},
		);
	}
}

function reattachHerdrSession(session: RestorableSession) {
	removeTerminalBuffer(session.id);
	const existing = useTerminalStore
		.getState()
		.profiles[session.profile_id]?.tabs.some((tab) => tab.id === session.id);
	if (existing) return;
	useTerminalStore
		.getState()
		.addTab(session.profile_id, session.id, session.title);
}

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
	const backend = await getSessionBackend({
		sessionId: restore.oldSessionId,
	});
	if (backend === "herdr") {
		removeTerminalBuffer(restore.oldSessionId);
		if (!isPendingRestoreStillOpen(profileId, restore.oldSessionId)) {
			return;
		}
		useTerminalStore
			.getState()
			.finishRestoringTab(
				profileId,
				restore.oldSessionId,
				restore.oldSessionId,
			);
		return;
	}

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
