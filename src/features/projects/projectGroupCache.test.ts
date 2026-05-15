import { describe, expect, it } from "vitest";
import type { ProjectGroup } from "@/generated";
import { upsertProjectGroup } from "./projectGroupCache";

const groupA: ProjectGroup = {
	id: "a",
	name: "A",
	created_at: "2026-01-01T00:00:00Z",
};

const groupB: ProjectGroup = {
	id: "b",
	name: "B",
	created_at: "2026-01-01T00:00:00Z",
};

describe("upsertProjectGroup", () => {
	it("creates the first cached group", () => {
		expect(upsertProjectGroup(undefined, groupA)).toEqual([groupA]);
	});

	it("replaces an existing group", () => {
		const updated = { ...groupB, name: "Updated" };
		expect(upsertProjectGroup([groupA, groupB], updated)).toEqual([
			groupA,
			updated,
		]);
	});

	it("appends a new group", () => {
		expect(upsertProjectGroup([groupA], groupB)).toEqual([groupA, groupB]);
	});
});
