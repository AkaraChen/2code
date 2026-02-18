import { Badge } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import type { ToolCallStatus } from "../types";

interface StatusBadgeProps {
	status: ToolCallStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
	const statusConfig = {
		pending: {
			label: m.agentStatusPending(),
			colorPalette: "gray" as const,
		},
		in_progress: {
			label: m.agentStatusInProgress(),
			colorPalette: "blue" as const,
		},
		completed: {
			label: m.agentStatusCompleted(),
			colorPalette: "green" as const,
		},
		failed: {
			label: m.agentStatusFailed(),
			colorPalette: "red" as const,
		},
	};

	const config = statusConfig[status];

	return (
		<Badge size="xs" colorPalette={config.colorPalette} variant="subtle">
			{config.label}
		</Badge>
	);
}
