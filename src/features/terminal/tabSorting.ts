export const TERMINAL_SORTABLE_PREFIX = "terminal";
export const FILE_SORTABLE_PREFIX = "file";

export type SortableTabKind =
	| typeof TERMINAL_SORTABLE_PREFIX
	| typeof FILE_SORTABLE_PREFIX;

export interface SortableTabIdentity {
	kind: SortableTabKind;
	value: string;
}

export interface SortableReorderRequest {
	kind: SortableTabKind;
	fromIndex: number;
	toIndex: number;
}

export function buildSortableId(
	kind: SortableTabKind,
	value: string,
): string {
	return `${kind}:${encodeURIComponent(value)}`;
}

export function parseSortableId(id: string): SortableTabIdentity | null {
	const separatorIndex = id.indexOf(":");
	if (separatorIndex === -1) return null;

	const kind = id.slice(0, separatorIndex);
	if (
		kind !== TERMINAL_SORTABLE_PREFIX &&
		kind !== FILE_SORTABLE_PREFIX
	) {
		return null;
	}

	return {
		kind,
		value: decodeURIComponent(id.slice(separatorIndex + 1)),
	};
}

export function resolveSortableReorder(
	activeId: string,
	overId: string,
	terminalTabIds: readonly string[],
	fileTabIds: readonly string[],
): SortableReorderRequest | null {
	const activeItem = parseSortableId(activeId);
	const overItem = parseSortableId(overId);
	if (!activeItem || !overItem) return null;

	if (activeItem.kind === overItem.kind) {
		if (activeItem.kind === TERMINAL_SORTABLE_PREFIX) {
			const fromIndex = terminalTabIds.findIndex((id) => id === activeItem.value);
			const toIndex = terminalTabIds.findIndex((id) => id === overItem.value);
			return fromIndex === -1 || toIndex === -1
				? null
				: {
						kind: TERMINAL_SORTABLE_PREFIX,
						fromIndex,
						toIndex,
					};
		}

		const fromIndex = fileTabIds.findIndex((id) => id === activeItem.value);
		const toIndex = fileTabIds.findIndex((id) => id === overItem.value);
		return fromIndex === -1 || toIndex === -1
			? null
			: {
					kind: FILE_SORTABLE_PREFIX,
					fromIndex,
					toIndex,
				};
	}

	if (
		activeItem.kind === TERMINAL_SORTABLE_PREFIX &&
		overItem.kind === FILE_SORTABLE_PREFIX &&
		terminalTabIds.length > 0
	) {
		const fromIndex = terminalTabIds.findIndex((id) => id === activeItem.value);
		return fromIndex === -1
			? null
			: {
					kind: TERMINAL_SORTABLE_PREFIX,
					fromIndex,
					toIndex: terminalTabIds.length - 1,
				};
	}

	if (
		activeItem.kind === FILE_SORTABLE_PREFIX &&
		overItem.kind === TERMINAL_SORTABLE_PREFIX &&
		fileTabIds.length > 0
	) {
		const fromIndex = fileTabIds.findIndex((id) => id === activeItem.value);
		return fromIndex === -1
			? null
			: {
					kind: FILE_SORTABLE_PREFIX,
					fromIndex,
					toIndex: 0,
				};
	}

	return null;
}
