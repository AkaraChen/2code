import { Badge, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import { useProjects } from "@/features/projects/hooks";
import type { ProjectWithProfiles } from "@/generated/types";

function ProjectRow({ project }: { project: ProjectWithProfiles }) {
	const navigate = useNavigate();
	const defaultProfile = project.profiles.find((p) => p.is_default);

	return (
		<Card.Root
			size="sm"
			cursor="pointer"
			_hover={{ bg: "bg.subtle" }}
			onClick={() => {
				if (defaultProfile) {
					navigate(
						`/projects/${project.id}/profiles/${defaultProfile.id}`,
					);
				}
			}}
		>
			<Card.Body py="2" px="3">
				<HStack justify="space-between">
					<HStack gap="3">
						<Text fontSize="sm" fontWeight="medium">
							{project.name}
						</Text>
						<Text fontSize="xs" color="fg.muted" truncate maxW="300px">
							{project.folder}
						</Text>
					</HStack>
					<HStack gap="2">
						<Badge size="sm" variant="subtle" colorPalette="gray">
							{project.profiles.length}{" "}
							{m.profiles()}
						</Badge>
					</HStack>
				</HStack>
			</Card.Body>
		</Card.Root>
	);
}

export function ProjectList() {
	const { data: projects } = useProjects();

	if (projects.length === 0) return null;

	return (
		<VStack align="stretch" gap="3">
			<Text fontSize="sm" fontWeight="medium" color="fg.muted">
				{m.allProjects()}
			</Text>
			{projects.map((project) => (
				<ProjectRow key={project.id} project={project} />
			))}
		</VStack>
	);
}
