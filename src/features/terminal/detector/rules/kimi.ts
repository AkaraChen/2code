import { defineRule, type Manifest } from "../types";

const kimi: Manifest = {
	id: "kimi",
	aliases: ["kimi-code", "kimi code"],
	rules: [
		defineRule("current_approval_panel", "blocked", 400, "whole_recent", {
			contains: ["↵ confirm"],
			any: [
				{ contains: ["run this command?"] },
				{ contains: ["write this file?"] },
				{ contains: ["apply these edits?"] },
				{ contains: ["stop this task?"] },
				{ contains: ["ready to build with this plan?"] },
				{ lineRegex: [/^\s*(?:▶\s*)?approve .*\?$/iu] },
			],
			all: [
				{ contains: [" choose"] },
				{
					any: [
						{ contains: ["approve"] },
						{ contains: ["reject"] },
						{ contains: ["revise"] },
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("question_panel", "blocked", 390, "whole_recent", {
			contains: ["↑↓ select", "esc cancel"],
			lineRegex: [/^\s*question\s*$/u, /^\s*\? /u],
			any: [
				{ contains: ["↵ choose"] },
				{ contains: ["↵ toggle"] },
				{ contains: ["↵ save"] },
			],
		}, { visibleBlocker: true }),
		defineRule("legacy_approval_panel", "blocked", 300, "whole_recent", {
			contains: ["requesting approval", "reject"],
			any: [
				{ contains: ["approve once"] },
				{ contains: ["approve for this session"] },
			],
			all: [
				{
					any: [
						{ contains: ["1/2/3/4 choose"] },
						{ contains: ["↵ confirm"] },
					],
				},
			],
		}),
		defineRule("background_agent_status_working", "working", 120, "bottom_non_empty_lines(3)", {
			lineRegex: [/\bkimi[-\w.]*\s+thinking\b.*\[[1-9]\d*\s+agents?\s+running\]/iu],
		}, { visibleWorking: true }),
		defineRule("moon_spinner_working", "working", 100, "whole_recent", {
			lineRegex: [/^\s*([🌕🌖🌗🌘🌑🌒🌓🌔])\s*$/u],
		}, { visibleWorking: true }),
		defineRule("braille_spinner_working", "working", 90, "whole_recent", {
			lineRegex: [/^\s*[\u2800-\u28FF]+\s*(thinking\.\.\.|working\.\.\.|using )/iu],
		}, { visibleWorking: true }),
	],
};

export default kimi;
