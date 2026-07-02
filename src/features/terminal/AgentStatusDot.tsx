import { cn } from "@/lib/utils";
import type { AgentCompletionNotification, AgentStatus } from "./store";

interface AgentStatusDotProps {
	status: AgentStatus | AgentCompletionNotification;
}

export function AgentStatusDot({ status }: AgentStatusDotProps) {
	return (
		<span
			aria-hidden="true"
			data-agent-status={status}
			className={cn(
				"self-center size-2 shrink-0 rounded-full",
				status === "waiting" && "bg-yellow-400",
				status === "completed" && "bg-green-500",
				status === "running"
					&& "bg-emerald-400 shadow-[0_0_0_0_rgba(52,211,153,0.45)] agent-status-dot--running",
			)}
		/>
	);
}
