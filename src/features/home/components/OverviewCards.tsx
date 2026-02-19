import { Card, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import type { HomepageStats } from "@/generated/types";

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const h = Math.floor(seconds / 3600);
	const min = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${min}m`;
	return `${min}m`;
}

interface StatCardProps {
	label: string;
	value: string | number;
}

function StatCard({ label, value }: StatCardProps) {
	return (
		<Card.Root size="sm">
			<Card.Body>
				<VStack gap="1" align="start">
					<Text fontSize="sm" color="fg.muted">
						{label}
					</Text>
					<Text fontSize="2xl" fontWeight="bold">
						{value}
					</Text>
				</VStack>
			</Card.Body>
		</Card.Root>
	);
}

export function OverviewCards({ stats }: { stats: HomepageStats }) {
	return (
		<SimpleGrid columns={4} gap="4">
			<StatCard
				label={m.statsTotalProjects()}
				value={stats.totalProjects}
			/>
			<StatCard
				label={m.statsSessionsToday()}
				value={stats.sessionsToday}
			/>
			<StatCard
				label={m.statsActiveTime()}
				value={formatDuration(stats.activeTimeTodaySeconds)}
			/>
			<StatCard
				label={m.statsStreak()}
				value={m.statsStreakDays({ n: String(stats.currentStreakDays) })}
			/>
		</SimpleGrid>
	);
}
