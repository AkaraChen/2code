import type { Profile } from "@/generated";
import { describe, expect, it } from "vitest";
import { getFallbackProfile } from "./DeleteProfileDialog";

function makeProfile(id: string, isDefault = false): Profile {
	return {
		id,
		project_id: "project-1",
		branch_name: id,
		worktree_path: `/repo/${id}`,
		created_at: "2026-05-15T00:00:00Z",
		is_default: isDefault,
	};
}

describe("getFallbackProfile", () => {
	it("prefers a remaining default profile", () => {
		const profiles = [
			makeProfile("delete-me"),
			makeProfile("first"),
			makeProfile("default", true),
		];

		expect(getFallbackProfile(profiles, "delete-me")).toBe(profiles[2]);
	});

	it("falls back to the first remaining profile", () => {
		const profiles = [makeProfile("delete-me"), makeProfile("first")];

		expect(getFallbackProfile(profiles, "delete-me")).toBe(profiles[1]);
	});
});
