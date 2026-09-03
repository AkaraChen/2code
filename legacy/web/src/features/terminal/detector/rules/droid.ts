import { defineRule, type Manifest } from "../types";

const droid: Manifest = {
	id: "droid",
	rules: [
		defineRule("execute_selection_blocker", "blocked", 300, "whole_recent", {
			contains: ["enter to select", "esc to cancel"],
			any: [
				{ contains: ["↑↓ to navigate"] },
				{ contains: ["use ↑↓ to navigate"] },
			],
			all: [
				{
					any: [
						{ contains: ["> yes, allow"] },
						{ contains: ["> no, cancel"] },
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("selection_menu_blocker", "blocked", 290, "bottom_non_empty_lines(8)", {
			contains: ["enter select", "esc cancel"],
			any: [
				{ contains: ["↑/↓ navigate"] },
				{ contains: ["↑↓ navigate"] },
			],
		}, { visibleBlocker: true }),
		defineRule("spinner_stop_working", "working", 110, "whole_recent", {
			contains: ["esc to stop"],
			lineRegex: [/^\s*[\u2800-\u28FF]/u],
		}, { visibleWorking: true }),
		defineRule("stop_hint_working", "working", 100, "whole_recent", {
			contains: ["esc to stop"],
		}, { visibleWorking: true }),
	],
};

export default droid;
