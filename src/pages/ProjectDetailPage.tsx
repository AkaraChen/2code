import { Button, Center, EmptyState, VStack } from "@chakra-ui/react";
import { LuPlus, LuTerminal } from "react-icons/lu";
import { Navigate, useParams } from "react-router";
import { useCreateTerminalTab } from "@/hooks/useCreateTerminalTab";
import { useProject } from "@/hooks/useProjects";
import * as m from "@/paraglide/messages.js";
import { useTerminalStore } from "@/stores/terminalStore";

export default function ProjectDetailPage() {
	const { id } = useParams<{ id: string }>();
	const project = useProject(id!);
	const hasTabs = useTerminalStore(
		(s) => (id && s.projects[id]?.tabs.length > 0) ?? false,
	);
	const createTab = useCreateTerminalTab();

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
						<EmptyState.Title>
							{m.noTerminalsOpen()}
						</EmptyState.Title>
						<EmptyState.Description>
							{m.noTerminalsOpenDescription()}
						</EmptyState.Description>
					</VStack>
					<Button
						disabled={createTab.isPending}
						onClick={() =>
							createTab.mutate({
								projectId: project.id,
								cwd: project.folder,
							})
						}
					>
						<LuPlus />
						{m.newTerminal()}
					</Button>
				</EmptyState.Content>
			</EmptyState.Root>
		</Center>
	);
}
