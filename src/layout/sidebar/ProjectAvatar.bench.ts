import { bench } from "vitest";
import { getProjectAvatarFallback } from "./ProjectAvatar";

const PROJECT_NAMES = [
	"2code",
	"  developer-tools",
	"🚀 Launch Pad",
	"中文项目",
	"performance-workbench",
	"Open Source Repository",
	"🧪 Experiments",
	"   ",
];

function getProjectAvatarFallbackWithArray(name: string) {
	const trimmed = name.trim();
	if (!trimmed) {
		return "?";
	}

	return Array.from(trimmed)[0]?.toUpperCase() ?? "?";
}

bench("array project avatar fallback", () => {
	let total = 0;
	for (const name of PROJECT_NAMES) {
		total += getProjectAvatarFallbackWithArray(name).length;
	}
	if (total === 0) throw new Error("unreachable");
});

bench("loop project avatar fallback", () => {
	let total = 0;
	for (const name of PROJECT_NAMES) {
		total += getProjectAvatarFallback(name).length;
	}
	if (total === 0) throw new Error("unreachable");
});
