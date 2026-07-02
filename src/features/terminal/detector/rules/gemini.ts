import { defineRule, type Manifest } from "../types";

const gemini: Manifest = {
	id: "gemini",
	rules: [
		defineRule("apply_or_allow_change", "blocked", 300, "whole_recent", {
			any: [
				{ contains: ["│ Apply this change"] },
				{ contains: ["│ Allow execution"] },
				{
					all: [{ contains: ["yes"] }],
					any: [
						{ contains: ["waiting for user confirmation"] },
						{ contains: ["│ Do you want to proceed"] },
						{ contains: ["do you want to proceed?"] },
					],
				},
				{ lineRegex: [/^\s*❯.*(yes|allow)/iu] },
			],
		}, { visibleBlocker: true }),
		defineRule("esc_cancel_working", "working", 100, "whole_recent", {
			contains: ["esc to cancel"],
		}, { visibleWorking: true }),
	],
};

export default gemini;
