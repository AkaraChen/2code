import { defineRule, type Manifest } from "../types";

const copilot: Manifest = {
	id: "copilot",
	aliases: ["github-copilot", "ghcs"],
	rules: [
		defineRule("selection_blocker", "blocked", 300, "whole_recent", {
			all: [
				{
					any: [
						{ contains: ["esc to cancel"] },
						{ contains: ["esc cancel"] },
					],
				},
				{
					any: [
						{ contains: ["enter to select"] },
						{ contains: ["enter to confirm"] },
						{ contains: ["enter to submit"] },
						{ contains: ["enter accept"] },
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("working_cancel_hint", "working", 100, "whole_recent", {
			any: [
				{ contains: ["esc to cancel"] },
				{ contains: ["esc cancel"] },
				{ contains: ["esc again to cancel"] },
			],
		}, { visibleWorking: true }),
	],
};

export default copilot;
