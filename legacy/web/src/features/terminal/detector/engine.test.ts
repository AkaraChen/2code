import { describe, expect, it } from "vitest";
import {
	createAgentStatusDetector,
	detectAgentStatus,
	readTerminalDetectionScreen,
} from ".";

describe("agent status detector", () => {
	it("detects Codex blocked state from OSC title", () => {
		const result = detectAgentStatus({
			screen: "",
			oscTitle: "Action Required",
		});

		expect(result.agentId).toBe("codex");
		expect(result.ruleId).toBe("osc_title_blocked");
		expect(result.status).toBe("waiting");
	});

	it("detects Codex working state from braille OSC title", () => {
		const result = detectAgentStatus({
			screen: "codex",
			oscTitle: "⠋ thinking",
		});

		expect(result.agentId).toBe("codex");
		expect(result.ruleId).toBe("osc_title_working");
		expect(result.status).toBe("running");
	});

	it("does not infer Codex from the prompt marker alone", () => {
		const result = detectAgentStatus({
			screen: "› ",
			oscTitle: "",
		});

		expect(result.agentId).toBeNull();
		expect(result.ruleId).toBeNull();
		expect(result.status).toBeNull();
	});

	it("detects spinner-only agent working title", () => {
		const result = detectAgentStatus({
			screen: "",
			oscTitle: "⠋ thinking",
		});

		expect(result.ruleId).toBe("osc_title_working");
		expect(result.status).toBe("running");
	});

	it("keeps the previous state for Codex transcript viewer", () => {
		const detector = createAgentStatusDetector();
		const working = detector.detect({
			screen: "codex",
			oscTitle: "⠋ thinking",
		});
		const transcript = detector.detect({
			screen: [
				"❯ previous prompt",
				"↑/↓ to scroll",
				"pgup/pgdn to page",
				"home/end to jump",
				"q to quit",
				"esc to edit prev",
			].join("\n"),
			oscTitle: "",
		});

		expect(working.status).toBe("running");
		expect(transcript.ruleId).toBe("transcript_viewer");
		expect(transcript.status).toBe("running");
	});

	it("detects Claude permission prompt after a horizontal rule", () => {
		const result = detectAgentStatus({
			screen: [
				"Claude Code",
				"────────────────",
				"Do you want to proceed?",
				"❯ 1. Yes",
				"2. No",
				"esc to cancel",
			].join("\n"),
		});

		expect(result.agentId).toBe("claude");
		expect(result.ruleId).toBe("generic_permission_prompt");
		expect(result.status).toBe("waiting");
	});

	it("detects Claude idle from prompt box", () => {
		const detector = createAgentStatusDetector();
		detector.detect({
			screen: "Claude Code\n⠋ thinking",
			oscTitle: "⠋ thinking",
		});
		const result = detector.detect({
			screen: "Claude Code\n────────────────\n❯ ",
			oscTitle: "",
		});

		expect(result.ruleId).toBe("live_prompt_box");
		expect(result.status).toBeNull();
	});

	it("detects OpenCode permission and progress", () => {
		const blocked = detectAgentStatus({
			screen: "opencode\n△ Permission required",
		});
		const working = detectAgentStatus({
			screen: "opencode\n■■■■⬝⬝",
		});

		expect(blocked.ruleId).toBe("permission_required");
		expect(blocked.status).toBe("waiting");
		expect(working.ruleId).toBe("progress_bar_working");
		expect(working.status).toBe("running");
	});

	it("detects Claude idle progress through a remembered agent", () => {
		const detector = createAgentStatusDetector();
		detector.detect({
			screen: "claude",
			oscTitle: "⠋ thinking",
		});
		const pending = detector.detect({
			screen: "",
			oscProgress: "4;0;0",
			now: 0,
		});
		const result = detector.detect({
			screen: "",
			oscProgress: "4;0;0",
			now: 700,
		});

		expect(pending.status).toBe("running");
		expect(result.ruleId).toBe("osc_progress_idle");
		expect(result.status).toBeNull();
	});

	it("returns the current status on repeated checks", () => {
		const detector = createAgentStatusDetector();
		const first = detector.detect({
			screen: "opencode\nesc to interrupt",
		});
		const second = detector.detect({
			screen: "opencode\npress esc to interrupt",
		});

		expect(first.status).toBe("running");
		expect(second.status).toBe("running");
	});

	it("falls back to idle when a known agent has no matching live rule", () => {
		const detector = createAgentStatusDetector();
		const working = detector.detect({
			screen: "opencode\nesc to interrupt",
		});
		const idle = detector.detect({
			screen: "opencode\n>",
		});

		expect(working.status).toBe("running");
		expect(idle.agentId).toBe("opencode");
		expect(idle.ruleId).toBeNull();
		expect(idle.status).toBeNull();
	});

	it("reads recent xterm buffer lines for detection", () => {
		const terminal = {
			rows: 2,
			buffer: {
				active: {
					length: 4,
					getLine(index: number) {
						const lines = [
							"old",
							"opencode esc to interrupt",
							"current prompt",
							">",
						];
						return {
							translateToString: () => lines[index],
						};
					},
				},
			},
		};

		expect(readTerminalDetectionScreen(terminal as never)).toBe(
			"current prompt\n>",
		);
	});
});
