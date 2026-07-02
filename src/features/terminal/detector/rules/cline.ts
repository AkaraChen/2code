import { defineRule, type Manifest } from "../types";

const cline: Manifest = {
	id: "cline",
	rules: [
		defineRule("tool_permission", "blocked", 300, "whole_recent", {
			any: [
				{ contains: ["let cline use this tool"] },
				{ contains: ["[act mode]", "execute command?", "yes"] },
				{ contains: ["[act mode]", "use this tool?", "yes"] },
				{ contains: ["[plan mode]", "execute command?", "yes"] },
				{ contains: ["[plan mode]", "use this tool?", "yes"] },
			],
		}, { visibleBlocker: true }),
		defineRule("default_cline_working", "working", -10, "whole_recent", {
			regex: [/[\s\S]+/u],
		}, { visibleWorking: true }),
	],
};

export default cline;
