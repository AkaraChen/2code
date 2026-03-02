import { sessionRegistry } from "./sessionRegistry";
import { useTabStore } from "./store";
import type { ProfileTab } from "./types";

/** Abstract base class for all tab session types. */
export abstract class TabSession {
	abstract readonly type: "terminal" | "agent";
	readonly id: string;
	readonly profileId: string;
	title: string;

	constructor(id: string, profileId: string, title: string) {
		this.id = id;
		this.profileId = profileId;
		this.title = title;
	}

	/** Register this session in the global runtime registry. */
	register(): void {
		sessionRegistry.set(this.id, this);
	}

	/** Remove this session from the global runtime registry. */
	unregister(): void {
		sessionRegistry.delete(this.id);
	}

	/** Access the tab store for subclass use (e.g. updating session IDs). */
	protected get tabStore() {
		return useTabStore.getState();
	}

	/** Close the backend session and clean up resources. */
	abstract close(): Promise<void>;

	/** Convert to a serializable tab descriptor for the Zustand store. */
	abstract toTab(): ProfileTab;
}
