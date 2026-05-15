import type { PtySessionRecord } from "@/generated";

export function collectProjectSessions(
	projectSessions: readonly { sessions: readonly PtySessionRecord[] }[],
): PtySessionRecord[] {
	let sessionCount = 0;
	for (const item of projectSessions) {
		sessionCount += item.sessions.length;
	}

	const sessions = new Array<PtySessionRecord>(sessionCount);
	let index = 0;
	for (const item of projectSessions) {
		for (const session of item.sessions) {
			sessions[index] = session;
			index += 1;
		}
	}
	return sessions;
}
