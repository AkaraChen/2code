import { bench, describe } from "vitest";
import { toggleCollapsedProjectGroupId } from "./sidebarStore";

const collapsedProjectGroupIds = Array.from(
	{ length: 10_000 },
	(_, index) => `group-${index}`,
);
const targetGroupId = collapsedProjectGroupIds[7_500];
let sink = 0;

function toggleCollapsedProjectGroupIdWithFilter(
	collapsedProjectGroupIds: readonly string[],
	groupId: string,
) {
	const collapsed = collapsedProjectGroupIds.includes(groupId);
	return collapsed
		? collapsedProjectGroupIds.filter((id) => id !== groupId)
		: [...collapsedProjectGroupIds, groupId];
}

describe("sidebar collapsed project group toggles", () => {
	bench("includes plus filter toggle", () => {
		const nextIds = toggleCollapsedProjectGroupIdWithFilter(
			collapsedProjectGroupIds,
			targetGroupId,
		);
		sink = nextIds.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("indexOf plus splice toggle", () => {
		const nextIds = toggleCollapsedProjectGroupId(
			collapsedProjectGroupIds,
			targetGroupId,
		);
		sink = nextIds.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
