import type { TopbarApp } from "@/generated";
import { bench, describe } from "vitest";
import { getSupportedTopbarAppIds } from "./hooks";
import { isLaunchAppControlId } from "./types";

const appIds = [
	"github-desktop",
	"vscode",
	"windsurf",
	"cursor",
	"zed",
	"sublime-text",
	"ghostty",
	"iterm2",
	"kitty",
	"warp",
	"unknown",
];
const apps: TopbarApp[] = Array.from({ length: 10_000 }, (_, index) => ({
	id: appIds[index % appIds.length],
}));
let sink = 0;

function getSupportedTopbarAppIdsWithMapFilter(apps: readonly TopbarApp[]) {
	return apps.map((app) => app.id).filter(isLaunchAppControlId);
}

describe("topbar supported app ids", () => {
	bench("map then filter app ids", () => {
		const ids = getSupportedTopbarAppIdsWithMapFilter(apps);
		sink = ids.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("single pass app ids", () => {
		const ids = getSupportedTopbarAppIds(apps);
		sink = ids.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
