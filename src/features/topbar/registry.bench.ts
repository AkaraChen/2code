import { bench } from "vitest";
import { getSupportedControlIds } from "./registry";
import type { ControlId, LaunchAppControlId } from "./types";

const CONTROL_DEFS: { id: ControlId; kind: "app" | "static" }[] = [
	{ id: "github-desktop", kind: "app" },
	{ id: "vscode", kind: "app" },
	{ id: "windsurf", kind: "app" },
	{ id: "cursor", kind: "app" },
	{ id: "zed", kind: "app" },
	{ id: "sublime-text", kind: "app" },
	{ id: "ghostty", kind: "app" },
	{ id: "iterm2", kind: "app" },
	{ id: "kitty", kind: "app" },
	{ id: "warp", kind: "app" },
	{ id: "git-diff", kind: "static" },
	{ id: "pr-status", kind: "static" },
	{ id: "reveal-in-finder", kind: "static" },
];

const SUPPORTED_APP_IDS: LaunchAppControlId[] = [
	"github-desktop",
	"vscode",
	"cursor",
	"zed",
	"ghostty",
	"warp",
];

function getSupportedControlIdsWithFilterMap(
	supportedAppIds: readonly LaunchAppControlId[],
) {
	const supportedAppIdSet = new Set(supportedAppIds);
	return CONTROL_DEFS
		.filter(
			(def) =>
				def.kind === "static" ||
				supportedAppIdSet.has(def.id as LaunchAppControlId),
		)
		.map((def) => def.id);
}

bench("filter map supported controls", () => {
	const ids = getSupportedControlIdsWithFilterMap(SUPPORTED_APP_IDS);
	if (ids.length === 0) throw new Error("unreachable");
});

bench("single pass supported controls", () => {
	const ids = getSupportedControlIds(SUPPORTED_APP_IDS);
	if (ids.length === 0) throw new Error("unreachable");
});
