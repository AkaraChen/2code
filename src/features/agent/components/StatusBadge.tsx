import { Badge } from "@chakra-ui/react";
import type { ToolCallStatus } from "../types";

interface StatusBadgeProps {
	status: ToolCallStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
	const statusConfig = {
		pending: {
			label: "Pending",
			colorPalette: "gray" as const,
		},
		in_progress: {
			label: "In Progress",
			colorPalette: "blue" as const,
		},
		completed: {
			label: "Completed",
			colorPalette: "green" as const,
		},
		failed: {
			label: "Failed",
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
