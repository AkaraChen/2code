const pendingDeletions = new Set<string>();

export function markPending(tabId: string): boolean {
	if (pendingDeletions.has(tabId)) return false;
	pendingDeletions.add(tabId);
	return true;
}

export function clearPending(tabId: string): void {
	pendingDeletions.delete(tabId);
}

export function isPending(tabId: string): boolean {
	return pendingDeletions.has(tabId);
}
