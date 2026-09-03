import { defineRule, type Manifest } from "../types";

const agy: Manifest = {
	id: "agy",
	aliases: ["antigravity", "antigravity-cli"],
	rules: [
		defineRule("permission_prompt", "blocked", 300, "whole_recent", {
			contains: ["requesting permission for:"],
			any: [
				{ contains: ["do you want to proceed?"] },
				{ contains: ["tab amend", "edit command"] },
			],
		}, { visibleBlocker: true }),
		defineRule("spinner_working", "working", 100, "whole_recent", {
			lineRegex: [/^\s*[\u2800-\u28FF]+\s+\p{Alphabetic}+(?:[\d_]\w*)?ing\b/iu],
		}, { visibleWorking: true }),
		defineRule("background_tasks_working", "working", 90, "bottom_non_empty_lines(5)", {
			lineRegex: [/·\s*[1-9]\d*\s+task/iu],
		}, { visibleWorking: true }),
	],
};

export default agy;
