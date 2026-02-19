import { Badge, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import type { SessionStat } from "@/generated/types";

function formatDuration(seconds: number | null | undefined): string {
	if (!seconds || seconds <= 0) return "0s";
	const h = Math.floor(seconds / 3600);
	const min = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${min}m`;
	if (min > 0) return `${min}m`;
	return `${seconds}s`;
}

function formatRelativeTime(epochSeconds: number): string {
	const now = Math.floor(Date.now() / 1000);
	const diff = now - epochSeconds;
	if (diff < 60) return m.timeJustNow();
	if (diff < 3600) return m.timeMinutesAgo({ n: String(Math.floor(diff / 60)) });
	if (diff < 86400) return m.timeHoursAgo({ n: String(Math.floor(diff / 3600)) });
	if (diff < 2592000) return m.timeDaysAgo({ n: String(Math.floor(diff / 86400)) });
	return m.timeMonthsAgo({ n: String(Math.floor(diff / 2592000)) });
}

export function RecentSessions({
	sessions,
}: {
	sessions: SessionStat[];
}) {
	const navigate = useNavigate();

	if (sessions.length === 0) return null;

	return (
		<VStack align="stretch" gap="3" flex="1">
			<Text fontSize="sm" fontWeight="medium" color="fg.muted">
				{m.statsRecentSessions()}
			</Text>
			{sessions.map((s) => (
				<Card.Root
					key={s.id}
					size="sm"
					cursor="pointer"
					_hover={{ bg: "bg.subtle" }}
					onClick={() => navigate(`/projects/${s.project_id}/profiles/${s.profile_id}`)}
				>
					<Card.Body py="2" px="3">
						<HStack justify="space-between">
							<HStack gap="2">
								<Badge
									size="sm"
									variant="subtle"
									colorPalette={s.session_type === "terminal" ? "blue" : "purple"}
								>
									{s.session_type === "terminal"
										? m.statsTerminal()
										: m.statsAgent()}
								</Badge>
								<Text fontSize="sm" fontWeight="medium" truncate>
									{s.project_name}
								</Text>
								{s.branch_name && (
									<Text fontSize="xs" color="fg.muted">
										{s.branch_name}
									</Text>
								)}
							</HStack>
							<HStack gap="2">
								<Text fontSize="xs" color="fg.muted">
									{formatDuration(s.duration_seconds)}
								</Text>
								<Text fontSize="xs" color="fg.muted">
									{formatRelativeTime(s.created_at)}
								</Text>
							</HStack>
						</HStack>
					</Card.Body>
				</Card.Root>
			))}
		</VStack>
	);
}
