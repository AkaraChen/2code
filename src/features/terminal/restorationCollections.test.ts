import { describe, expect, it } from "vitest";
import type { PtySessionRecord } from "@/generated";
import { collectProjectSessions } from "./restorationCollections";

const session: PtySessionRecord = {
	id: "session-1",
	profile_id: "profile-1",
	title: "Terminal",
	shell: "/bin/zsh",
	cwd: "/repo/project-1",
	cols: 120,
	rows: 30,
	created_at: "2026-01-01T00:00:00Z",
	closed_at: null,
};

describe("terminal restoration collections", () => {
	it("flattens project sessions", () => {
		expect(collectProjectSessions([{ sessions: [session] }])).toEqual([
			session,
		]);
	});
});
