import { Box, Heading, EmptyState, VStack, Center } from "@chakra-ui/react";
import { RiFolderAddLine } from "react-icons/ri";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import { useProjects } from "@/features/projects/hooks";
import { TourOnboarding } from "./TourOnboarding";

export default function HomePage() {
	const { data: projects } = useProjects();
	const navigate = useNavigate();
	const hasNoProjects = projects.length === 0;

	// Auto-navigate to first project's default profile if projects exist
	useEffect(() => {
		if (projects.length > 0) {
			const firstProject = projects[0];
			const defaultProfile = firstProject.profiles.find((p) => p.is_default);
			if (defaultProfile) {
				navigate(`/projects/${firstProject.id}/profiles/${defaultProfile.id}`, {
					replace: true,
				});
			}
		}
	}, [projects, navigate]);

	return (
		<Box p="8" pt="16" h="full">
			<Heading size="2xl" fontWeight="bold">
				{m.home()}
			</Heading>

			{hasNoProjects && (
				<Center h="calc(100vh - 200px)">
					<EmptyState.Root>
						<EmptyState.Content>
							<EmptyState.Indicator>
								<RiFolderAddLine />
							</EmptyState.Indicator>
							<VStack textAlign="center">
								<EmptyState.Title>{m.emptyProjectsTitle()}</EmptyState.Title>
								<EmptyState.Description>
									{m.emptyProjectsDesc()}
								</EmptyState.Description>
							</VStack>
						</EmptyState.Content>
					</EmptyState.Root>
				</Center>
			)}

			<TourOnboarding isEnabled={hasNoProjects} />
		</Box>
	);
}
