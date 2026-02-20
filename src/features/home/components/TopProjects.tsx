import { Card, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import type { ProjectActivitySummary } from "@/generated/types";
import { useProjects } from "@/features/projects/hooks";

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const h = Math.floor(seconds / 3600);
	const min = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${min}m`;
	return `${min}m`;
}

export function TopProjects({
	projects: topProjects,
}: {
	projects: ProjectActivitySummary[];
}) {
	const navigate = useNavigate();
	const { data: allProjects } = useProjects();

	const projectById = useMemo(
		() => new Map(allProjects.map((p) => [p.id, p])),
		[allProjects],
	);

	if (topProjects.length === 0) return null;

	return (
		<VStack align="stretch" gap="3" flex="1">
			<Text fontSize="sm" fontWeight="medium" color="fg.muted">
				{m.statsTopProjects()}
			</Text>
			{topProjects.map((p) => {
				const project = projectById.get(p.projectId);
				const defaultProfile = project?.profiles.find(
					(pr) => pr.is_default,
				);

				return (
					<Card.Root
						key={p.projectId}
						size="sm"
						cursor={defaultProfile ? "pointer" : "default"}
						_hover={defaultProfile ? { bg: "bg.subtle" } : undefined}
						onClick={() => {
							if (defaultProfile) {
								navigate(
									`/projects/${p.projectId}/profiles/${defaultProfile.id}`,
								);
							}
						}}
					>
						<Card.Body py="2" px="3">
							<HStack justify="space-between">
								<Text fontSize="sm" fontWeight="medium" truncate>
									{p.projectName}
								</Text>
								<HStack gap="3">
									<Text fontSize="xs" color="fg.muted">
										{m.statsSessions({ n: String(p.sessionCount) })}
									</Text>
									<Text fontSize="xs" color="fg.muted">
										{formatDuration(p.totalSeconds)}
									</Text>
								</HStack>
							</HStack>
						</Card.Body>
					</Card.Root>
				);
			})}
		</VStack>
	);
}
