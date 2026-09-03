import { defineRule, type Manifest } from "../types";

const codex: Manifest = {
	id: "codex",
	rules: [
		defineRule("osc_title_blocked", "blocked", 1100, "osc_title", {
			contains: ["Action Required"],
		}, { visibleBlocker: true }),
		defineRule("osc_title_working", "working", 1050, "osc_title", {
			regex: [/^[\u2800-\u28FF] /u],
		}, { visibleWorking: true }),
		defineRule("transcript_viewer", "unknown", 1000, "after_last_prompt_marker", {
			contains: ["↑/↓ to scroll", "pgup/pgdn to", "home/end to jump", "q to quit"],
			any: [
				{ contains: ["esc to edit prev"] },
				{ contains: ["esc/← to edit prev"] },
			],
		}, { skipStateUpdate: true }),
		defineRule("live_strong_blocker", "blocked", 900, "after_last_prompt_marker", {
			any: [
				{ contains: ["press enter to confirm or esc to cancel"] },
				{ contains: ["enter to submit answer"] },
				{ contains: ["enter to submit all"] },
				{ contains: ["allow command?"] },
			],
		}, { visibleBlocker: true }),
		defineRule("weak_blocker", "blocked", 600, "whole_recent", {
			any: [
				{ contains: ["[y/n]"] },
				{ contains: ["yes (y)"] },
				{
					contains: ["do you want to"],
					any: [{ contains: ["yes"] }, { contains: ["❯"] }],
				},
				{
					contains: ["would you like to"],
					any: [{ contains: ["yes"] }, { contains: ["❯"] }],
				},
			],
		}),
		defineRule("osc_title_idle", "idle", 100, "osc_title", {
			regex: [/\S/u],
			not: [
				{ regex: [/^[\u2800-\u28FF]/u] },
				{ contains: ["Action Required"] },
			],
		}, { visibleIdle: true }),
	],
};

export default codex;
