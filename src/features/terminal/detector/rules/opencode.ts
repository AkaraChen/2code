import { defineRule, type Manifest } from "../types";

const opencode: Manifest = {
	id: "opencode",
	aliases: ["open-code", "herdr:opencode"],
	rules: [
		defineRule("permission_required", "blocked", 300, "whole_recent", {
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
		defineRule("interrupt_hint_working", "working", 110, "whole_recent", {
			any: [
				{ contains: ["esc to interrupt"] },
				{ contains: ["ctrl+c to interrupt"] },
				{ contains: ["press esc to interrupt"] },
				{ lineRegex: [/.*opencode.*esc (again to )?interrupt/iu] },
			],
		}, { visibleWorking: true }),
		defineRule("progress_bar_working", "working", 100, "whole_recent", {
			regex: [/(■|⬝){4,}/u],
		}, { visibleWorking: true }),
	],
};

export default opencode;
