import type { AgentStatus } from "./store";

interface AgentStatusDotProps {
	status: AgentStatus;
}

export function AgentStatusDot({ status }: AgentStatusDotProps) {
	return (
		<span
			aria-hidden="true"
			className={[
				"self-center size-2 shrink-0 rounded-full",
				status === "waiting" ? "bg-yellow-400" : "bg-green-500",
				status === "running" ? "agent-status-dot--running" : "",
			].join(" ")}
		/>
	);
}
