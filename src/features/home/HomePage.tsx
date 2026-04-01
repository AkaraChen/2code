import { Box, Heading, EmptyState, VStack, Center } from "@chakra-ui/react";
import { RiFolderAddLine } from "react-icons/ri";
import * as m from "@/paraglide/messages.js";
import { useProjects } from "@/features/projects/hooks";
import { TourOnboarding } from "./TourOnboarding";

export default function HomePage() {
	const { data: projects } = useProjects();
	const hasNoProjects = projects.length === 0;

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
