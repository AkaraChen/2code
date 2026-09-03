import { defineRule, type Manifest } from "../types";

const amp: Manifest = {
	id: "amp",
	aliases: ["amp-local"],
	rules: [
		defineRule("approval_footer", "blocked", 300, "whole_recent", {
			any: [
				{ contains: ["waiting for approval"] },
				{ contains: ["invoke tool"] },
				{ contains: ["run this command?"] },
				{ contains: ["allow editing file:"] },
				{ contains: ["allow creating file:"] },
				{ contains: ["confirm tool call"] },
				{
					contains: ["approve"],
					any: [
						{ contains: ["allow all for this session"] },
						{ contains: ["allow all for every session"] },
						{ contains: ["allow file for every session"] },
						{ contains: ["deny with feedback"] },
					],
				},
			],
		}, { visibleBlocker: true }),
		defineRule("esc_cancel_working", "working", 100, "whole_recent", {
			contains: ["esc to cancel"],
		}, { visibleWorking: true }),
	],
};

export default amp;
