import { defineRule, type Manifest } from "../types";

const grok: Manifest = {
	id: "grok",
	aliases: ["grok-build"],
	rules: [
		defineRule("permission_scope_selector", "blocked", 300, "whole_recent", {
			contains: ["yes, proceed", "no, reject"],
			any: [
				{ contains: ["use ← → to choose permission whitelist scope"] },
				{ contains: ["←/→:scope"] },
			],
		}, { visibleBlocker: true }),
		defineRule("waiting_tool_working", "working", 120, "whole_recent", {
			any: [
				{
					all: [
						{ contains: ["ctrl+c:cancel", "ctrl+enter:interject"] },
						{ contains: ["waiting"] },
					],
				},
				{ lineRegex: [/^\s*[\u2800-\u28FF]\s+(Run|Read|Search|List)\b/u] },
			],
		}, { visibleWorking: true }),
	],
};

export default grok;
