import { describe, expect, it } from "vitest";
import { createAgentStatusDetector, detectAgentStatus } from "..";
import type { AgentDetectionResult, AgentId, DetectionInput } from "..";
import { MANIFESTS } from ".";

interface RuleFixture {
	ruleId: string;
	input: DetectionInput;
	status?: AgentDetectionResult["status"];
	seed?: DetectionInput;
}

function input(agentId: AgentId, lines: string[], rest: Omit<DetectionInput, "screen"> = {}): DetectionInput {
	return {
		screen: [agentId, ...lines].join("\n"),
		...rest,
	};
}

function horizontalRuleInput(agentId: AgentId, lines: string[]): DetectionInput {
	return input(agentId, ["before", "────────────────", ...lines]);
}

function promptInput(agentId: AgentId, lines: string[]): DetectionInput {
	return input(agentId, ["❯ prompt", ...lines]);
}

function workingSeed(agentId: Extract<AgentId, "claude" | "codex">): DetectionInput {
	return input(agentId, [], { oscTitle: "⠋ thinking" });
}

function expectedStatus(ruleId: string): AgentDetectionResult["status"] {
	for (const manifest of MANIFESTS) {
		const rule = manifest.rules.find((item) => item.id === ruleId);
		if (!rule) continue;
		if (rule.state === "blocked") return "waiting";
		if (rule.state === "working") return "running";
		return null;
	}
	throw new Error(`Unknown rule fixture: ${ruleId}`);
}

function testManifest(agentId: AgentId, fixtures: RuleFixture[], negativeInput: DetectionInput = input(agentId, ["plain idle prompt"])) {
	const manifest = MANIFESTS.find((item) => item.id === agentId);
	if (!manifest) throw new Error(`Missing manifest: ${agentId}`);

	it("has one fixture for every rule", () => {
		const covered = new Set(fixtures.map((fixture) => fixture.ruleId));

		expect(manifest.rules.map((rule) => rule.id).sort()).toEqual(
			[...covered].sort(),
		);
	});

	it.each(fixtures)("$ruleId", (fixture) => {
		const detector = fixture.seed ? createAgentStatusDetector() : null;
		if (fixture.seed) detector?.detect(fixture.seed);

		const result = detector
			? detector.detect(fixture.input)
			: detectAgentStatus(fixture.input);

		expect(result.agentId).toBe(agentId);
		expect(result.ruleId).toBe(fixture.ruleId);
		expect(result.status).toBe(fixture.status ?? expectedStatus(fixture.ruleId));
	});

	it("ignores non-matching text", () => {
		const result = detectAgentStatus(negativeInput);

		expect(result.ruleId).toBeNull();
		expect(result.status).toBeNull();
	});
}

describe("agy", () => {
	testManifest("agy", [
		{
			ruleId: "permission_prompt",
			input: input("agy", ["requesting permission for:", "do you want to proceed?"]),
		},
		{
			ruleId: "spinner_working",
			input: input("agy", ["⠋ Processing"]),
		},
		{
			ruleId: "background_tasks_working",
			input: input("agy", ["· 2 tasks"]),
		},
	]);
});

describe("amp", () => {
	testManifest("amp", [
		{
			ruleId: "approval_footer",
			input: input("amp", ["waiting for approval"]),
		},
		{
			ruleId: "esc_cancel_working",
			input: input("amp", ["esc to cancel"]),
		},
	]);
});

describe("claude", () => {
	testManifest("claude", [
		{
			ruleId: "osc_title_working",
			input: input("claude", [], { oscTitle: "⠋ thinking" }),
		},
		{
			ruleId: "transcript_viewer",
			input: input("claude", [
				"showing detailed transcript",
				"ctrl+o to toggle",
			]),
			seed: workingSeed("claude"),
			status: "running",
		},
		{
			ruleId: "live_blocked_form",
			input: horizontalRuleInput("claude", [
				"enter to select",
				"esc to cancel",
				"arrow keys to navigate",
			]),
		},
		{
			ruleId: "dynamic_workflow_prompt",
			input: input("claude", ["run a dynamic workflow?", "esc to cancel"]),
		},
		{
			ruleId: "live_prompt_box",
			input: horizontalRuleInput("claude", ["❯ "]),
		},
		{
			ruleId: "model_picker_menu",
			input: input("claude", [
				"select model",
				"enter to set as default",
				"esc to cancel",
			]),
			seed: workingSeed("claude"),
			status: "running",
		},
		{
			ruleId: "bash_permission_prompt",
			input: input("claude", [
				"do you want to proceed?",
				"bash command",
				"1. Yes",
			]),
		},
		{
			ruleId: "generic_permission_prompt",
			input: horizontalRuleInput("claude", [
				"do you want to proceed?",
				"esc to cancel",
				"1. Yes",
			]),
		},
		{
			ruleId: "legacy_no_prompt_blocker",
			input: input("claude", ["waiting for permission"]),
		},
		{
			ruleId: "osc_title_idle",
			input: input("claude", [], { oscTitle: "✳ idle" }),
		},
		{
			ruleId: "osc_progress_idle",
			input: input("claude", [], { oscProgress: "4;0;0" }),
		},
	]);
});

describe("cline", () => {
	testManifest("cline", [
		{
			ruleId: "tool_permission",
			input: input("cline", ["let cline use this tool"]),
		},
		{
			ruleId: "default_cline_working",
			input: input("cline", ["thinking"]),
		},
	], { screen: "" });
});

describe("codex", () => {
	testManifest("codex", [
		{
			ruleId: "osc_title_blocked",
			input: { screen: "", oscTitle: "Action Required" },
		},
		{
			ruleId: "osc_title_working",
			input: input("codex", [], { oscTitle: "⠋ thinking" }),
		},
		{
			ruleId: "transcript_viewer",
			input: promptInput("codex", [
				"↑/↓ to scroll",
				"pgup/pgdn to page",
				"home/end to jump",
				"q to quit",
				"esc to edit prev",
			]),
			seed: workingSeed("codex"),
			status: "running",
		},
		{
			ruleId: "live_strong_blocker",
			input: promptInput("codex", ["allow command?"]),
		},
		{
			ruleId: "weak_blocker",
			input: input("codex", ["do you want to continue?", "yes"]),
		},
		{
			ruleId: "osc_title_idle",
			input: input("codex", [], { oscTitle: "codex" }),
		},
	]);
});

describe("copilot", () => {
	testManifest("copilot", [
		{
			ruleId: "selection_blocker",
			input: input("copilot", ["esc to cancel", "enter to select"]),
		},
		{
			ruleId: "working_cancel_hint",
			input: input("copilot", ["esc again to cancel"]),
		},
	]);
});

describe("cursor", () => {
	testManifest("cursor", [
		{
			ruleId: "write_file_approval",
			input: input("cursor", [
				"write to this file?",
				"proceed (y)",
				"reject & propose changes",
			]),
		},
		{
			ruleId: "approval_prompt",
			input: input("cursor", ["waiting for approval", "run this command?", "run (once) (y)"]),
		},
		{
			ruleId: "stop_hint_working",
			input: input("cursor", ["ctrl+c to stop"]),
		},
		{
			ruleId: "background_task_status_working",
			input: input("cursor", ["2 background tasks"]),
		},
		{
			ruleId: "spinner_working",
			input: input("cursor", ["⠋ Indexing"]),
		},
	]);
});

describe("devin", () => {
	testManifest("devin", [
		{
			ruleId: "workspace_trust_prompt",
			input: input("devin", [
				"do you trust the authors of this directory?",
				"with untrusted content.",
				"yes, trust workspace",
			]),
		},
		{
			ruleId: "permission_prompt",
			input: input("devin", ["approve once", "select", "confirm", "esc cancel"]),
		},
		{
			ruleId: "running_tools_footer",
			input: input("devin", ["running tools", "esc to interrupt"]),
		},
		{
			ruleId: "guide_while_working",
			input: input("devin", ["guide devin while it works"]),
		},
		{
			ruleId: "tool_reading_timeout",
			input: input("devin", ["reading shell command", "timeout: 30s"]),
		},
		{
			ruleId: "welcome_prompt_footer",
			input: input("devin", [
				"ask devin to build",
				"features, fix bugs",
				"your code",
				"❭ Ask Devin to build",
			]),
		},
		{
			ruleId: "live_prompt_footer",
			input: input("devin", ["context:", "❭ "]),
		},
	]);
});

describe("droid", () => {
	testManifest("droid", [
		{
			ruleId: "execute_selection_blocker",
			input: input("droid", [
				"enter to select",
				"esc to cancel",
				"↑↓ to navigate",
				"> yes, allow",
			]),
		},
		{
			ruleId: "selection_menu_blocker",
			input: input("droid", ["enter select", "esc cancel", "↑/↓ navigate"]),
		},
		{
			ruleId: "spinner_stop_working",
			input: input("droid", ["⠋", "esc to stop"]),
		},
		{
			ruleId: "stop_hint_working",
			input: input("droid", ["esc to stop"]),
		},
	]);
});

describe("gemini", () => {
	testManifest("gemini", [
		{
			ruleId: "apply_or_allow_change",
			input: input("gemini", ["│ Apply this change"]),
		},
		{
			ruleId: "esc_cancel_working",
			input: input("gemini", ["esc to cancel"]),
		},
	]);
});

describe("grok", () => {
	testManifest("grok", [
		{
			ruleId: "permission_scope_selector",
			input: input("grok", [
				"yes, proceed",
				"no, reject",
				"use ← → to choose permission whitelist scope",
			]),
		},
		{
			ruleId: "waiting_tool_working",
			input: input("grok", ["ctrl+c:cancel", "ctrl+enter:interject", "waiting"]),
		},
	]);
});

describe("hermes", () => {
	testManifest("hermes", [
		{
			ruleId: "dangerous_command_approval",
			input: input("hermes", ["dangerous command", "enter to confirm"]),
		},
		{
			ruleId: "interrupt_status_working",
			input: input("hermes", ["msg=interrupt"]),
		},
	]);
});

describe("kilo", () => {
	testManifest("kilo", [
		{
			ruleId: "opencode_permission",
			input: input("kilo", ["△ Permission required"]),
		},
		{
			ruleId: "esc_interrupt_working",
			input: input("kilo", ["esc interrupt"]),
		},
	]);
});

describe("kimi", () => {
	testManifest("kimi", [
		{
			ruleId: "current_approval_panel",
			input: input("kimi", [
				"↵ confirm",
				"run this command?",
				" choose",
				"approve",
			]),
		},
		{
			ruleId: "question_panel",
			input: input("kimi", [
				"question",
				"? choose a path",
				"↑↓ select",
				"esc cancel",
				"↵ choose",
			]),
		},
		{
			ruleId: "legacy_approval_panel",
			input: input("kimi", ["requesting approval", "reject", "approve once", "↵ confirm"]),
		},
		{
			ruleId: "background_agent_status_working",
			input: input("kimi", ["kimi-agent thinking [2 agents running]"]),
		},
		{
			ruleId: "moon_spinner_working",
			input: input("kimi", ["🌕"]),
		},
		{
			ruleId: "braille_spinner_working",
			input: input("kimi", ["⠋ thinking..."]),
		},
	]);
});

describe("kiro", () => {
	testManifest("kiro", [
		{
			ruleId: "tool_approval",
			input: input("kiro", ["requires approval", "yes, single permission"]),
		},
		{
			ruleId: "subagent_approval",
			input: input("kiro", [
				"pending from subagents",
				"tool approvals",
				"approve all pending",
			]),
		},
		{
			ruleId: "kiro_working_marker",
			input: input("kiro", ["kiro is working"]),
		},
		{
			ruleId: "tool_spinner_working",
			input: input("kiro", ["◔ Reading", "esc to cancel"]),
		},
	]);
});

describe("opencode", () => {
	testManifest("opencode", [
		{
			ruleId: "permission_required",
			input: input("opencode", ["△ Permission required"]),
		},
		{
			ruleId: "interrupt_hint_working",
			input: input("opencode", ["press esc to interrupt"]),
		},
		{
			ruleId: "progress_bar_working",
			input: input("opencode", ["■■■■⬝⬝"]),
		},
	]);
});

describe("pi", () => {
	testManifest("pi", [
		{
			ruleId: "working_literal",
			input: input("pi", ["Working..."]),
		},
	]);
});

describe("qodercli", () => {
	testManifest("qodercli", [
		{
			ruleId: "confirmation_or_input_blocker",
			input: input("qodercli", ["waiting for user confirmation", "yes"]),
		},
		{
			ruleId: "cancel_hint_working",
			input: input("qodercli", ["(esc to cancel, ctrl+c to quit)"]),
		},
		{
			ruleId: "spinner_working",
			input: input("qodercli", ["⠋ Reading"]),
		},
	]);
});
