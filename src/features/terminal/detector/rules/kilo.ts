import { defineRule, type Manifest } from "../types";

const kilo: Manifest = {
	id: "kilo",
	aliases: ["kilo-code", "kilo code", "herdr:kilo"],
	rules: [
		defineRule("opencode_permission", "blocked", 300, "whole_recent", {
			any: [
				{ contains: ["△ Permission required"] },
				{
					contains: ["esc dismiss"],
					any: [
						{ contains: ["enter confirm"] },
						{ contains: ["enter submit"] },
						{ contains: ["enter toggle"] },
					],
					all: [
						{
							any: [
								{ contains: ["↑↓ select"] },
								{ contains: ["⇆ tab"] },
							],
						},
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("esc_interrupt_working", "working", 100, "whole_recent", {
			contains: ["esc interrupt"],
		}, { visibleWorking: true }),
	],
};

export default kilo;
