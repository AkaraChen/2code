import { bench } from "vitest";
import { isLaunchAppControlId, launchAppControlIds } from "./types";

const IDS = [
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
	"unknown-app",
	"another-app",
];

function isLaunchAppControlIdWithIncludes(id: string) {
	return launchAppControlIds.includes(id as (typeof launchAppControlIds)[number]);
}

bench("includes launch app control id", () => {
	let count = 0;
	for (const id of IDS) {
		if (isLaunchAppControlIdWithIncludes(id)) count += 1;
	}
	if (count === 0) throw new Error("unreachable");
});

bench("set launch app control id", () => {
	let count = 0;
	for (const id of IDS) {
		if (isLaunchAppControlId(id)) count += 1;
	}
	if (count === 0) throw new Error("unreachable");
});
