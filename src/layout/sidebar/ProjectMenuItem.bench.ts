import { bench, describe } from "vitest";
import { splitDefaultProfile } from "./ProjectMenuItem";

const profiles = Array.from({ length: 10_000 }, (_, index) => ({
	id: `profile-${index}`,
	is_default: index === 5_000,
}));
let sink = 0;

function splitDefaultProfileWithFindFilter<
	TProfile extends { is_default: boolean },
>(profiles: readonly TProfile[]) {
	return {
		defaultProfile: profiles.find((profile) => profile.is_default),
		nonDefaultProfiles: profiles.filter((profile) => !profile.is_default),
	};
}

describe("project menu profile split", () => {
	bench("find plus filter split", () => {
		const result = splitDefaultProfileWithFindFilter(profiles);
		sink =
			(result.defaultProfile ? 1 : 0) + result.nonDefaultProfiles.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("single pass split", () => {
		const result = splitDefaultProfile(profiles);
		sink =
			(result.defaultProfile ? 1 : 0) + result.nonDefaultProfiles.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
