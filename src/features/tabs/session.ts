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

	/** Close the backend session and clean up resources. */
	abstract close(): Promise<void>;

	/** Convert to a serializable tab descriptor for the Zustand store. */
	abstract toTab(): ProfileTab;
}
