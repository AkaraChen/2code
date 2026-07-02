import { defineRule, type Manifest } from "../types";

const cursor: Manifest = {
	id: "cursor",
	aliases: ["cursor-agent"],
	rules: [
		defineRule("write_file_approval", "blocked", 320, "bottom_non_empty_lines(8)", {
			contains: ["write to this file?", "proceed (y)"],
			any: [
				{ contains: ["reject & propose changes"] },
				{ contains: ["esc or n or p"] },
				{ contains: ["add write("] },
			],
		}, { visibleBlocker: true }),
		defineRule("approval_prompt", "blocked", 300, "whole_recent", {
			any: [
				{
					contains: ["waiting for approval", "run this command?"],
					any: [
						{ contains: ["run (once) (y)"] },
						{ contains: ["skip (esc or n)"] },
					],
				},
				{ contains: ["(y) (enter)"] },
				{ lineRegex: [/^\s*allow .*\(y\)/iu] },
				{ contains: ["keep (n)"] },
				{ contains: ["skip (esc or n)"] },
				{ lineRegex: [/^\s*run /iu] },
				{ contains: ["(y)", "allow"] },
				{ contains: ["(y)", "run (once)"] },
				{ contains: ["(y)", "→ run"] },
			],
		}, { visibleBlocker: true }),
		defineRule("stop_hint_working", "working", 100, "bottom_non_empty_lines(6)", {
			contains: ["ctrl+c to stop"],
		}, { visibleWorking: true }),
		defineRule("background_task_status_working", "working", 95, "bottom_non_empty_lines(5)", {
			lineRegex: [/\b[1-9]\d*\s+background\s+tasks?\b/iu],
		}, { visibleWorking: true }),
		defineRule("spinner_working", "working", 90, "bottom_non_empty_lines(8)", {
			lineRegex: [/^\s*(⬡|⬢|[\u2800-\u28FF]+)\s+\p{Alphabetic}+(?:[\d_]\w*)?ing\b/iu],
		}, { visibleWorking: true }),
	],
};

export default cursor;
