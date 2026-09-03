export const BUFFER_STORAGE_PREFIX = "terminal-buffer:";
export const DIMS_STORAGE_PREFIX = "terminal-dims:";

function terminalSessionIdFromStorageKey(key: string): string | null {
	if (key.startsWith(BUFFER_STORAGE_PREFIX)) {
		return key.slice(BUFFER_STORAGE_PREFIX.length);
	}
	if (key.startsWith(DIMS_STORAGE_PREFIX)) {
		return key.slice(DIMS_STORAGE_PREFIX.length);
	}
	return null;
}

export function removeTerminalStorage(sessionId: string): void {
	try {
		localStorage.removeItem(`${BUFFER_STORAGE_PREFIX}${sessionId}`);
		localStorage.removeItem(`${DIMS_STORAGE_PREFIX}${sessionId}`);
	} catch {}
}

export function sweepTerminalStorage(liveSessionIds: Set<string>): number {
	let removed = 0;
	try {
		for (let index = localStorage.length - 1; index >= 0; index -= 1) {
			const key = localStorage.key(index);
			if (!key) continue;
			const sessionId = terminalSessionIdFromStorageKey(key);
			if (!sessionId || liveSessionIds.has(sessionId)) continue;

			localStorage.removeItem(key);
			removed += 1;
		}
	} catch {}
	return removed;
}
