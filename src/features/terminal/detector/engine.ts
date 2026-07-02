import type { Terminal as XTerm } from "@xterm/xterm";
import type { AgentStatus } from "../store";
import { MANIFESTS } from "./rules";
import type {
	AgentDetectionResult,
	AgentId,
	AgentSemanticState,
	DetectionInput,
	Gate,
	Manifest,
	RegionName,
	Rule,
	RuleMatch,
} from "./types";

const DETECTION_ROWS = 80;
const IDLE_CONFIRMATIONS = 3;
const IDLE_CONFIRM_CAP_MS = 700;
const PROMPT_MARKERS = ["❯", "❭", "›"];
const SPINNER_TITLE_REGEX = /^[\u2800-\u28FF] /u;
const MANIFEST_BY_ID = new Map(MANIFESTS.map((manifest) => [manifest.id, manifest]));

function normalizeText(value: string): string {
	return value.toLocaleLowerCase();
}

function getBottomLines(text: string, count: number, nonEmpty: boolean): string {
	const lines = text.split(/\r?\n/u);
	const selected = nonEmpty ? lines.filter((line) => line.trim() !== "") : lines;
	return selected.slice(-count).join("\n");
}

function afterLastHorizontalRule(text: string): string {
	const lines = text.split(/\r?\n/u);
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		if (/^\s*[─━═-]{3,}\s*$/u.test(lines[i])) {
			return lines.slice(i + 1).join("\n");
		}
	}
	return text;
}

function afterLastPromptMarker(text: string): string {
	const lines = text.split(/\r?\n/u);
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		if (PROMPT_MARKERS.some((marker) => lines[i].includes(marker))) {
			return lines.slice(i).join("\n");
		}
	}
	return text;
}

function promptBoxBody(text: string): string {
	const afterRule = afterLastHorizontalRule(text);
	const promptBody = afterLastPromptMarker(afterRule);
	return getBottomLines(promptBody, 12, false);
}

function selectRegion(input: DetectionInput, region: RegionName): string {
	if (region === "osc_title") return input.oscTitle ?? "";
	if (region === "osc_progress") return input.oscProgress ?? "";
	if (region === "after_last_horizontal_rule") {
		return afterLastHorizontalRule(input.screen);
	}
	if (region === "after_last_prompt_marker") {
		return afterLastPromptMarker(input.screen);
	}
	if (region === "prompt_box_body") return promptBoxBody(input.screen);

	const bottomNonEmpty = /^bottom_non_empty_lines\((\d+)\)$/u.exec(region);
	if (bottomNonEmpty) {
		return getBottomLines(input.screen, Number(bottomNonEmpty[1]), true);
	}

	const bottom = /^bottom_lines\((\d+)\)$/u.exec(region);
	if (bottom) return getBottomLines(input.screen, Number(bottom[1]), false);

	return input.screen;
}

function gateMatches(gate: Gate, text: string): boolean {
	const lowerText = normalizeText(text);
	const lines = text.split(/\r?\n/u);

	if (gate.contains) {
		for (const needle of gate.contains) {
			if (!lowerText.includes(normalizeText(needle))) return false;
		}
	}

	if (gate.regex) {
		for (const regex of gate.regex) {
			if (!regex.test(text)) return false;
		}
	}

	if (gate.lineRegex) {
		for (const regex of gate.lineRegex) {
			if (!lines.some((line) => regex.test(line))) return false;
		}
	}

	if (gate.all && !gate.all.every((item) => gateMatches(item, text))) {
		return false;
	}

	if (gate.any && !gate.any.some((item) => gateMatches(item, text))) {
		return false;
	}

	if (gate.not && gate.not.some((item) => gateMatches(item, text))) {
		return false;
	}

	return true;
}

function manifestNames(manifest: Manifest): string[] {
	return [manifest.id, ...(manifest.aliases ?? [])];
}

function textMentionsManifest(text: string, manifest: Manifest): boolean {
	const normalized = normalizeText(text);
	return manifestNames(manifest).some((name) =>
		normalized.includes(normalizeText(name)),
	);
}

function inferAgents(input: DetectionInput): AgentId[] {
	const oscTitle = input.oscTitle ?? "";
	const bottomLines = getBottomLines(input.screen, 20, true);
	const haystack = [
		oscTitle,
		input.oscProgress ?? "",
		bottomLines,
	].join("\n");
	if (normalizeText(oscTitle).includes("action required")) {
		return ["codex"];
	}
	const namedAgents = MANIFESTS
		.filter((manifest) => textMentionsManifest(haystack, manifest))
		.map((manifest) => manifest.id);
	if (namedAgents.length > 0) return namedAgents;
	if (SPINNER_TITLE_REGEX.test(oscTitle)) return ["claude", "codex"];
	return [];
}

function evaluateManifest(manifest: Manifest, input: DetectionInput): RuleMatch | null {
	let best: RuleMatch | null = null;
	for (const candidateRule of manifest.rules) {
		const text = selectRegion(input, candidateRule.region);
		if (!gateMatches(candidateRule.gate, text)) continue;
		if (!best || candidateRule.priority > best.rule.priority) {
			best = { agentId: manifest.id, rule: candidateRule };
		}
	}
	return best;
}

function findBestMatch(
	input: DetectionInput,
	currentAgentId: AgentId | null,
	inferredAgentIds: AgentId[],
): RuleMatch | null {
	const candidates = new Set<AgentId>();
	if (currentAgentId) candidates.add(currentAgentId);
	for (const agentId of inferredAgentIds) candidates.add(agentId);

	if (candidates.size === 0) return null;

	const manifests = [...candidates].flatMap((agentId) => {
		const manifest = MANIFEST_BY_ID.get(agentId);
		return manifest ? [manifest] : [];
	});

	let best: RuleMatch | null = null;
	for (const manifest of manifests) {
		const match = evaluateManifest(manifest, input);
		if (!match) continue;
		if (!best || match.rule.priority > best.rule.priority) {
			best = match;
		}
	}
	return best;
}

function statusForState(state: AgentSemanticState): AgentStatus | null {
	if (state === "blocked") return "waiting";
	if (state === "working") return "running";
	return null;
}

export class AgentStatusDetector {
	private agentId: AgentId | null = null;
	private state: AgentSemanticState = "unknown";
	private pendingIdleSince: number | null = null;
	private pendingIdleCount = 0;

	detect(input: DetectionInput): AgentDetectionResult {
		const inferredAgentIds = inferAgents(input);
		const match = findBestMatch(input, this.agentId, inferredAgentIds);
		if (!match) {
			if (!this.agentId && inferredAgentIds.length === 1) {
				this.agentId = inferredAgentIds[0];
			}
			if (this.agentId) {
				this.state = "idle";
			}
			this.pendingIdleSince = null;
			this.pendingIdleCount = 0;
			return {
				agentId: this.agentId,
				ruleId: null,
				state: this.state,
				status: statusForState(this.state),
			};
		}

		this.agentId = match.agentId;
		if (match.rule.skipStateUpdate) {
			return {
				agentId: this.agentId,
				ruleId: match.rule.id,
				state: this.state,
				status: statusForState(this.state),
			};
		}

		const nextState = this.confirmIdleTransition(match.rule, input);
		if (!nextState) {
			return {
				agentId: this.agentId,
				ruleId: match.rule.id,
				state: this.state,
				status: statusForState(this.state),
			};
		}

		this.state = nextState;
		const nextStatus = statusForState(nextState);

		return {
			agentId: this.agentId,
			ruleId: match.rule.id,
			state: nextState,
			status: nextStatus,
		};
	}

	private confirmIdleTransition(rule: Rule, input: DetectionInput): AgentSemanticState | null {
		if (rule.state !== "idle" || this.state !== "working" || rule.visibleIdle) {
			this.pendingIdleSince = null;
			this.pendingIdleCount = 0;
			return rule.state;
		}

		const now = input.now ?? performance.now();
		if (this.pendingIdleSince === null) {
			this.pendingIdleSince = now;
			this.pendingIdleCount = 1;
			return null;
		}

		this.pendingIdleCount += 1;
		const elapsed = now - this.pendingIdleSince;
		if (
			this.pendingIdleCount >= IDLE_CONFIRMATIONS
			|| elapsed >= IDLE_CONFIRM_CAP_MS
		) {
			this.pendingIdleSince = null;
			this.pendingIdleCount = 0;
			return "idle";
		}

		return null;
	}
}

export function createAgentStatusDetector(): AgentStatusDetector {
	return new AgentStatusDetector();
}

export function detectAgentStatus(input: DetectionInput): AgentDetectionResult {
	return createAgentStatusDetector().detect(input);
}

export function readTerminalDetectionScreen(terminal: XTerm): string {
	const buffer = terminal.buffer.active;
	const end = buffer.length;
	const rowCount = Math.max(1, terminal.rows || DETECTION_ROWS);
	const start = Math.max(0, end - rowCount);
	const lines: string[] = [];

	for (let i = start; i < end; i += 1) {
		const line = buffer.getLine(i);
		if (line) lines.push(line.translateToString(true));
	}

	return lines.join("\n");
}
