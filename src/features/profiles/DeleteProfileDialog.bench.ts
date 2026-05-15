import type { Profile } from "@/generated";
import { bench, describe } from "vitest";
import { getFallbackProfile } from "./DeleteProfileDialog";

const profiles: Profile[] = Array.from({ length: 10_000 }, (_, index) => ({
	id: `profile-${index}`,
	project_id: "project-1",
	branch_name: `branch-${index}`,
	worktree_path: `/repo/profile-${index}`,
	created_at: "2026-05-15T00:00:00Z",
	is_default: index === 8_500,
}));
const deletedProfileId = "profile-2_500".replace("_", "");
let sink = "";

function getFallbackProfileWithFind(
	profiles: readonly Profile[] | undefined,
	deletedProfileId: string,
) {
	return (
		profiles?.find(
			(item) => item.id !== deletedProfileId && item.is_default,
		) ?? profiles?.find((item) => item.id !== deletedProfileId)
	);
}

describe("delete profile fallback profile", () => {
	bench("two find fallback", () => {
		const profile = getFallbackProfileWithFind(profiles, deletedProfileId);
		sink = profile?.id ?? "";
		if (sink === "__never__") throw new Error("unreachable");
	});

	bench("single pass fallback", () => {
		const profile = getFallbackProfile(profiles, deletedProfileId);
		sink = profile?.id ?? "";
		if (sink === "__never__") throw new Error("unreachable");
	});
});
