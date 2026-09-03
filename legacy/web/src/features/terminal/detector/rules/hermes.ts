import { defineRule, type Manifest } from "../types";

const hermes: Manifest = {
	id: "hermes",
	aliases: ["hermes-agent"],
	rules: [
		defineRule("dangerous_command_approval", "blocked", 300, "whole_recent", {
			any: [
				{ contains: ["dangerous command"] },
				{ contains: ["allow once", "allow for this session", "deny"] },
			],
			all: [
				{
					any: [
						{ contains: ["enter to confirm"] },
						{ contains: ["↑/↓ to select"] },
						{ contains: ["show full command"] },
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("interrupt_status_working", "working", 100, "whole_recent", {
			any: [
				{ contains: ["msg=interrupt"] },
				{ contains: ["ctrl+c cancel"] },
			],
		}, { visibleWorking: true }),
	],
};

export default hermes;
