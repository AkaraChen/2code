import consola from "consola";
import type { SessionAgentStatus } from "@/generated";
import type { AgentStatus } from "../store";

const unrecognized = new Set<string>();

/**
 * Map documented Herdr `agent_status` onto 2code store values.
 * Unrecognized strings are idle with no detector fallback.
 */
export function mapHerdrAgentStatus(status: string): AgentStatus | "idle" {
	switch (status) {
		case "working":
			return "running";
		case "blocked":
			return "waiting";
		case "unknown":
		case "idle":
		case "done":
			return "idle";
		default:
			if (!unrecognized.has(status)) {
				unrecognized.add(status);
				consola.warn(
					"[2code-agent-status] unrecognized Herdr agent status",
					{ status },
				);
			}
			return "idle";
	}
}

export function herdrAgentPublishStatus(dto: SessionAgentStatus | null): {
	status: AgentStatus | null;
	agentName: string | null;
} {
	if (dto == null) {
		return { status: null, agentName: null };
	}
	const mapped = mapHerdrAgentStatus(dto.status);
	const agentName = dto.agentName?.trim() ? dto.agentName : null;
	return {
		status: mapped === "idle" ? null : mapped,
		agentName,
	};
}
