import consola from "consola";
import { getSessionBackend } from "@/generated";
import { removeTerminalBuffer } from "./lib";
import {
	useTerminalStore,
	type TerminalTab,
} from "./store";

const pendingRestores = new Map<string, Promise<void>>();

export interface RestorableSession {
	id: string;
	profile_id: string;
	title: string;
	shell: string;
	cwd: string;
	rows: number;
	cols: number;
}

/**
 * Rebuild tabs from `list_project_sessions`. Session ids are live Herdr
 * `pane_id`s and become tabs on the same identity (attach on mount).
 */
export async function hydrateRestorableSessions(
	sessions: RestorableSession[],
): Promise<void> {
	for (const session of sessions) {
		try {
			await getSessionBackend({ sessionId: session.id });
		} catch (error) {
			consola.error(
				`[pty-restore] failed to resolve backend for ${session.id}`,
				error,
			);
			continue;
		}
		reattachHerdrSession(session);
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

	const promise = runRestore(profileId, restore.oldSessionId)
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

async function runRestore(profileId: string, oldSessionId: string) {
	await getSessionBackend({ sessionId: oldSessionId });
	removeTerminalBuffer(oldSessionId);
	if (!isPendingRestoreStillOpen(profileId, oldSessionId)) {
		return;
	}
	useTerminalStore
		.getState()
		.finishRestoringTab(profileId, oldSessionId, oldSessionId);
}

function isPendingRestoreStillOpen(profileId: string, oldSessionId: string) {
	return !!useTerminalStore
		.getState()
		.profiles[profileId]?.tabs.some(
			(tab) => tab.id === oldSessionId && tab.restore,
		);
}
