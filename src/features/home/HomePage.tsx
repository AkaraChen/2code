import { Box, Heading, HStack, VStack } from "@chakra-ui/react";
import { useProjects } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";
import { ActivityHeatmap } from "./components/ActivityHeatmap";
import { EmptyHomeState } from "./components/EmptyHomeState";
import { OverviewCards } from "./components/OverviewCards";
import { ProjectList } from "./components/ProjectList";
import { QuickActions } from "./components/QuickActions";
import { useHomepageStats } from "./hooks";

export default function HomePage() {
	const { data: projects } = useProjects();
	const { data: stats } = useHomepageStats();

	if (projects.length === 0) {
		return (
			<Box p="8" pt="16">
				<Heading size="2xl" fontWeight="bold">
					{m.home()}
				</Heading>
				<EmptyHomeState />
			</Box>
		);
	}

	return (
		<Box p="8" pt="16" maxW="1000px">
			<HStack justify="space-between" mb="6">
				<Heading size="2xl" fontWeight="bold">
					{m.home()}
				</Heading>
				<QuickActions />
			</HStack>

			<VStack align="stretch" gap="6">
				<OverviewCards stats={stats} />
				<ActivityHeatmap data={stats.dailyActivity} />
				<ProjectList />
			</VStack>
		</Box>
	);
}
