/**
 * Coalesced title-change notification. The underlying value updates
 * immediately so value reads the latest; listener notification is deferred
 * at most one coalesce window after the first change in a burst.
 * Matches ghostty's 75ms coalesce window.
 */
const TITLE_COALESCE_MS = 75;

export class TitleDebouncer {
	private title: string | null = null;
	private timerId: ReturnType<typeof setTimeout> | null = null;
	private listeners = new Set<() => void>();

	get value(): string | null {
		return this.title;
	}

	set(nextTitle: string | null): void {
		if (this.title === nextTitle) return;
		this.title = nextTitle;
		if (this.timerId !== null) {
			return;
		}
		this.timerId = setTimeout(() => {
			this.timerId = null;
			this.flush();
		}, TITLE_COALESCE_MS);
	}

	private flush(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	dispose(): void {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
		this.listeners.clear();
	}
}
