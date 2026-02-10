import { useParams, Navigate } from "react-router";
import { Button, Center, EmptyState, VStack } from "@chakra-ui/react";
import { LuPlus, LuTerminal } from "react-icons/lu";
import { useProjects } from "@/contexts/ProjectContext";
import { useTerminalStore } from "@/stores/terminalStore";
import * as m from "@/paraglide/messages.js";

export default function ProjectDetailPage() {
	const { id } = useParams<{ id: string }>();
	const { projects } = useProjects();
	const hasTabs = useTerminalStore(
		(s) => (id && s.projects[id]?.tabs.length > 0) ?? false,
	);
	const createTab = useTerminalStore((s) => s.createTab);

	const project = projects.find((p) => p.id === id);

	if (!project) {
		return <Navigate to="/" replace />;
	}

	// Terminal overlay handles rendering when tabs exist
	if (hasTabs) return null;

	return (
		<Center h="full">
			<EmptyState.Root>
				<EmptyState.Content>
					<EmptyState.Indicator>
						<LuTerminal />
					</EmptyState.Indicator>
					<VStack textAlign="center">
						<EmptyState.Title>{m.noTerminalsOpen()}</EmptyState.Title>
						<EmptyState.Description>
							{m.noTerminalsOpenDescription()}
						</EmptyState.Description>
					</VStack>
					<Button onClick={() => createTab(project.id)}>
						<LuPlus />
						{m.newTerminal()}
					</Button>
				</EmptyState.Content>
			</EmptyState.Root>
		</Center>
	);
}
