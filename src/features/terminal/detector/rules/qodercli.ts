import { defineRule, type Manifest } from "../types";

const qodercli: Manifest = {
	id: "qodercli",
	aliases: ["qoderclicn", "qoder", "qodercn"],
	rules: [
		defineRule("confirmation_or_input_blocker", "blocked", 300, "whole_recent", {
			any: [
				{
					contains: ["waiting for user confirmation"],
					any: [
						{ contains: ["yes"] },
						{ contains: ["no"] },
						{ contains: ["allow"] },
						{ contains: ["reject"] },
					],
				},
				{
					contains: ["awaiting approval"],
					any: [{ contains: ["allow"] }, { contains: ["reject"] }],
				},
				{ contains: ["permission required"] },
				{ contains: ["allow once or always?"] },
				{ contains: ["asking user"] },
				{ contains: ["enter your response"] },
				{ contains: ["review your answers:"] },
				{ contains: ["shell awaiting input"] },
			],
		}, { visibleBlocker: true }),
		defineRule("cancel_hint_working", "working", 100, "whole_recent", {
			contains: ["(esc to cancel,"],
		}, { visibleWorking: true }),
		defineRule("spinner_working", "working", 90, "whole_recent", {
			lineRegex: [/^\s*[\u2800-\u28FF]\s+(?:\S.*)?\p{Alphabetic}/u],
		}, { visibleWorking: true }),
	],
};

export default qodercli;
