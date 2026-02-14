import type { TabSession } from "./session";

/** Module-level registry of all active session instances. */
export const sessionRegistry = new Map<string, TabSession>();
