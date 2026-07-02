import { defineRule, type Manifest } from "../types";

const devin: Manifest = {
	id: "devin",
	aliases: ["devin-cli", "devin cli"],
	rules: [
		defineRule("workspace_trust_prompt", "blocked", 300, "bottom_non_empty_lines(8)", {
			contains: [
				"do you trust the authors of this directory?",
				"with untrusted content.",
				"yes, trust ",
			],
		}, { visibleBlocker: true }),
		defineRule("permission_prompt", "blocked", 290, "bottom_non_empty_lines(8)", {
			contains: ["approve once", "select", "confirm", "esc cancel"],
		}, { visibleBlocker: true }),
		defineRule("running_tools_footer", "working", 200, "bottom_non_empty_lines(8)", {
			contains: ["running tools", "esc to interrupt"],
			not: [{ contains: ["approve once", "esc cancel"] }],
		}, { visibleWorking: true }),
		defineRule("guide_while_working", "working", 190, "bottom_non_empty_lines(6)", {
			contains: ["guide devin while it works"],
			not: [{ contains: ["approve once", "esc cancel"] }],
		}, { visibleWorking: true }),
		defineRule("tool_reading_timeout", "working", 180, "bottom_non_empty_lines(8)", {
			contains: ["reading shell ", "timeout:"],
			not: [{ contains: ["approve once", "esc cancel"] }],
		}, { visibleWorking: true }),
		defineRule("welcome_prompt_footer", "idle", 120, "bottom_non_empty_lines(8)", {
			contains: ["ask devin to build", "features, fix bugs", "your code"],
			lineRegex: [/^\s*❭ Ask Devin to build/u],
			not: [
				{ contains: ["approve once", "esc cancel"] },
				{ contains: ["running tools", "esc to interrupt"] },
				{ contains: ["guide devin while it works"] },
			],
		}, { visibleIdle: true }),
		defineRule("live_prompt_footer", "idle", 100, "bottom_non_empty_lines(6)", {
			contains: ["context:"],
			lineRegex: [/^\s*❭/u],
			not: [
				{ contains: ["approve once", "esc cancel"] },
				{ contains: ["running tools", "esc to interrupt"] },
				{ contains: ["guide devin while it works"] },
			],
		}, { visibleIdle: true }),
	],
};

export default devin;
