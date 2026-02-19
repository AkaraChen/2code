import { Box, HStack, Text, VStack, Portal, Tooltip } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import type { DailyActivity } from "@/generated/types";

const WEEKS = 13; // ~90 days
const DAYS_PER_WEEK = 7;
const CELL_SIZE = 12;
const CELL_GAP = 2;

function getIntensity(count: number): string {
	if (count === 0) return "var(--chakra-colors-bg-subtle)";
	if (count <= 2) return "var(--chakra-colors-green-200)";
	if (count <= 5) return "var(--chakra-colors-green-400)";
	if (count <= 10) return "var(--chakra-colors-green-600)";
	return "var(--chakra-colors-green-800)";
}

function buildGrid(data: DailyActivity[]) {
	const activityMap = new Map<string, DailyActivity>();
	for (const d of data) {
		const key = d.date;
		const existing = activityMap.get(key);
		if (existing) {
			existing.terminal_sessions += d.terminal_sessions;
			existing.agent_sessions += d.agent_sessions;
			existing.terminal_seconds += d.terminal_seconds;
			existing.agent_seconds += d.agent_seconds;
		} else {
			activityMap.set(key, { ...d });
		}
	}

	const today = new Date();
	const cells: Array<{
		date: string;
		total: number;
		terminal: number;
		agent: number;
	}> = [];

	const totalDays = WEEKS * DAYS_PER_WEEK;
	for (let i = totalDays - 1; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const dateStr = d.toISOString().split("T")[0];
		const activity = activityMap.get(dateStr);
		cells.push({
			date: dateStr,
			total: activity
				? activity.terminal_sessions + activity.agent_sessions
				: 0,
			terminal: activity?.terminal_sessions ?? 0,
			agent: activity?.agent_sessions ?? 0,
		});
	}

	return cells;
}

export function ActivityHeatmap({ data }: { data: DailyActivity[] }) {
	const cells = buildGrid(data);

	// Arrange into columns (weeks), each column has 7 days
	const weeks: (typeof cells)[] = [];
	for (let i = 0; i < cells.length; i += DAYS_PER_WEEK) {
		weeks.push(cells.slice(i, i + DAYS_PER_WEEK));
	}

	return (
		<VStack align="start" gap="2">
			<Text fontSize="sm" fontWeight="medium" color="fg.muted">
				{m.statsActivity()}
			</Text>
			<HStack gap={`${CELL_GAP}px`} align="start">
				{weeks.map((week, wi) => (
					<VStack key={wi} gap={`${CELL_GAP}px`}>
						{week.map((cell) => (
							<Tooltip.Root key={cell.date} openDelay={100}>
								<Tooltip.Trigger asChild>
									<Box
										width={`${CELL_SIZE}px`}
										height={`${CELL_SIZE}px`}
										borderRadius="sm"
										bg={getIntensity(cell.total)}
										cursor="default"
									/>
								</Tooltip.Trigger>
								<Portal>
									<Tooltip.Positioner>
										<Tooltip.Content>
											<Text fontSize="xs">
												{cell.date}:{" "}
												{cell.terminal} terminal,{" "}
												{cell.agent} agent
											</Text>
										</Tooltip.Content>
									</Tooltip.Positioner>
								</Portal>
							</Tooltip.Root>
						))}
					</VStack>
				))}
			</HStack>
		</VStack>
	);
}
