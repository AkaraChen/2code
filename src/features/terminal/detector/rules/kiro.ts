import { defineRule, type Manifest } from "../types";

const kiro: Manifest = {
	id: "kiro",
	aliases: ["kiro-cli"],
	rules: [
		defineRule("tool_approval", "blocked", 300, "whole_recent", {
			contains: ["requires approval"],
			any: [
				{ contains: ["yes, single permission"] },
				{ contains: ["trust, always allow"] },
				{ contains: ["no (tab to edit)"] },
				{ contains: ["esc to close"] },
			],
		}, { visibleBlocker: true }),
		defineRule("subagent_approval", "blocked", 290, "whole_recent", {
			contains: ["pending from subagents"],
			any: [
				{ contains: ["tool approval"] },
				{ contains: ["tool approvals"] },
			],
			all: [
				{
					any: [
						{ contains: ["approve all pending"] },
						{ contains: ["configure individually"] },
						{ contains: ["exit (cancel subagents)"] },
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("kiro_working_marker", "working", 100, "whole_recent", {
			contains: ["kiro is working"],
		}, { visibleWorking: true }),
		defineRule("tool_spinner_working", "working", 90, "whole_recent", {
			contains: ["esc to cancel"],
			lineRegex: [/^\s*([◔◑◕●])\s+\p{Alphabetic}/u],
		}, { visibleWorking: true }),
	],
};

export default kiro;
