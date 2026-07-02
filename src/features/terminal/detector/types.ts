import type { AgentStatus } from "../store";

export type AgentSemanticState = "idle" | "working" | "blocked" | "unknown";

export type AgentId =
	| "agy"
	| "amp"
	| "claude"
	| "cline"
	| "codex"
	| "copilot"
	| "cursor"
	| "devin"
	| "droid"
	| "gemini"
	| "grok"
	| "hermes"
	| "kilo"
	| "kimi"
	| "kiro"
	| "opencode"
	| "pi"
	| "qodercli";

export type RegionName =
	| "after_last_horizontal_rule"
	| "after_last_prompt_marker"
	| "osc_progress"
	| "osc_title"
	| "prompt_box_body"
	| "whole_recent"
	| `bottom_lines(${number})`
	| `bottom_non_empty_lines(${number})`;

export interface Gate {
	contains?: string[];
	regex?: RegExp[];
	lineRegex?: RegExp[];
	all?: Gate[];
	any?: Gate[];
	not?: Gate[];
}

export interface Rule {
	id: string;
	state: AgentSemanticState;
	priority: number;
	region: RegionName;
	visibleIdle?: boolean;
	visibleBlocker?: boolean;
	visibleWorking?: boolean;
	skipStateUpdate?: boolean;
	gate: Gate;
}

export interface Manifest {
	id: AgentId;
	aliases?: string[];
	rules: Rule[];
}

export interface RuleMatch {
	agentId: AgentId;
	rule: Rule;
}

export interface DetectionInput {
	screen: string;
	oscTitle?: string | null;
	oscProgress?: string | null;
	now?: number;
}

export interface AgentDetectionResult {
	agentId: AgentId | null;
	ruleId: string | null;
	state: AgentSemanticState;
	status: AgentStatus | null;
}

export function defineRule(
	id: string,
	state: AgentSemanticState,
	priority: number,
	region: RegionName,
	gate: Gate,
	options: Omit<
		Rule,
		"id" | "state" | "priority" | "region" | "gate"
	> = {},
): Rule {
	return { id, state, priority, region, gate, ...options };
}
