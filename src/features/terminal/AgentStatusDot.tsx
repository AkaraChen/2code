import { Circle } from "@chakra-ui/react";
import type { AgentStatus } from "./store";

interface AgentStatusDotProps {
	status: AgentStatus;
}

export function AgentStatusDot({ status }: AgentStatusDotProps) {
	return (
		<Circle
			aria-hidden="true"
			size="2"
			bg={status === "waiting" ? "yellow.400" : "green.500"}
			alignSelf="center"
			flexShrink={0}
			className={status === "running" ? "agent-status-dot--running" : undefined}
		/>
	);
}
