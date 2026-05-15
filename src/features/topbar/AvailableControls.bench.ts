import { bench, describe } from "vitest";
import { getAvailableControlIds } from "./AvailableControls";
import type { ControlId } from "./types";

const supportedControls = Array.from(
	{ length: 2_000 },
	(_, index) => `control-${index}` as ControlId,
);
const activeControls = supportedControls.filter((_, index) => index % 3 !== 0);
let sink = 0;

function getAvailableControlIdsWithIncludes(
	activeControls: readonly ControlId[],
	supportedControls: readonly ControlId[],
) {
	return supportedControls.filter((id) => !activeControls.includes(id));
}

describe("topbar available controls", () => {
	bench("filter with includes", () => {
		const available = getAvailableControlIdsWithIncludes(
			activeControls,
			supportedControls,
		);
		sink = available.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("filter with active set", () => {
		const available = getAvailableControlIds(
			activeControls,
			supportedControls,
		);
		sink = available.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
