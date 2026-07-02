import { defineRule, type Manifest } from "../types";

const claude: Manifest = {
	id: "claude",
	aliases: ["claude-code"],
	rules: [
		defineRule("osc_title_working", "working", 1100, "osc_title", {
			regex: [/^[\u2800-\u28FF] /u],
		}, { visibleWorking: true }),
		defineRule("transcript_viewer", "unknown", 1000, "bottom_non_empty_lines(3)", {
			contains: ["showing detailed transcript"],
			any: [
				{ contains: ["ctrl+o", "to toggle"] },
				{ contains: ["ctrl+e", "show all"] },
				{ contains: ["ctrl+e", "collapse"] },
				{ contains: ["↑↓ scroll"] },
				{ contains: ["? for shortcuts"] },
			],
		}, { skipStateUpdate: true }),
		defineRule("live_blocked_form", "blocked", 980, "after_last_horizontal_rule", {
			contains: ["enter to select", "esc to cancel"],
			any: [
				{ contains: ["tab/arrow keys to navigate"] },
				{ contains: ["arrow keys to navigate"] },
				{ contains: ["arrows to navigate"] },
				{ contains: ["↑/↓ to navigate"] },
				{ contains: ["↑↓ to navigate"] },
			],
		}, { visibleBlocker: true }),
		defineRule("dynamic_workflow_prompt", "blocked", 980, "whole_recent", {
			contains: ["run a dynamic workflow?", "esc to cancel"],
		}, { visibleBlocker: true }),
		defineRule("live_prompt_box", "idle", 950, "prompt_box_body", {
			lineRegex: [/^\s*❯/u],
			not: [
				{ contains: ["enter to select"] },
				{ contains: ["esc to cancel"] },
				{ contains: ["tab/arrow keys"] },
				{ contains: ["arrow keys to navigate"] },
				{ contains: ["↑/↓ to navigate"] },
			],
		}, { visibleIdle: true }),
		defineRule("model_picker_menu", "unknown", 900, "whole_recent", {
			contains: ["select model", "enter to set as default", "esc to cancel"],
			not: [
				{ contains: ["do you want to proceed?"] },
				{ contains: ["enter to select"] },
			],
		}, { skipStateUpdate: true }),
		defineRule("bash_permission_prompt", "blocked", 850, "whole_recent", {
			contains: ["do you want to proceed?"],
			any: [
				{ contains: ["bash command"] },
				{ contains: ["bash("] },
				{ contains: ["contains expansion"] },
				{ contains: ["tab to amend"] },
				{ contains: ["ctrl+e to explain"] },
			],
			all: [
				{
					any: [
						{ lineRegex: [/^\s*(?:❯\s*)?yes\b/iu] },
						{ lineRegex: [/^\s*1\.\s*yes\b/iu] },
						{ lineRegex: [/^\s*2\.\s*no\b/iu] },
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("generic_permission_prompt", "blocked", 840, "after_last_horizontal_rule", {
			contains: ["do you want to proceed?", "esc to cancel"],
			all: [
				{
					any: [
						{ lineRegex: [/^\s*(?:❯\s*)?1\.\s*yes\b/iu] },
						{ lineRegex: [/^\s*2\.\s*yes\b/iu] },
						{ lineRegex: [/^\s*2\.\s*no\b/iu] },
						{ lineRegex: [/^\s*3\.\s*no\b/iu] },
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("legacy_no_prompt_blocker", "blocked", 300, "whole_recent", {
			any: [
				{
					contains: ["do you want to"],
					any: [{ contains: ["yes"] }, { contains: ["❯"] }],
				},
				{
					contains: ["would you like to"],
					any: [{ contains: ["yes"] }, { contains: ["❯"] }],
				},
				{ contains: ["waiting for permission"] },
				{ contains: ["do you want to allow this connection?"] },
				{ contains: ["tab to amend"] },
				{ contains: ["ctrl+e to explain"] },
				{ contains: ["do you want to proceed?", "esc to cancel"] },
				{ contains: ["review your answers"] },
				{ contains: ["skip interview and plan immediately"] },
			],
			not: [{ regex: [/^\s*❯\s*$/mu] }],
		}),
		defineRule("osc_title_idle", "idle", 250, "osc_title", {
			regex: [/^\u2733 /u],
		}, { visibleIdle: true }),
		defineRule("osc_progress_idle", "idle", 250, "osc_progress", {
			regex: [/^4;0/u],
		}),
	],
};

export default claude;
