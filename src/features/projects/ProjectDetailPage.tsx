import {
	Button,
	Center,
	EmptyState,
	HStack,
	Menu,
	Portal,
	VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { FiChevronDown, FiPlus, FiTerminal } from "react-icons/fi";
import { Navigate, useParams } from "react-router";
import ProfileLayout from "@/features/projects/ProfileLayout";
import { useProject, useProjectProfiles } from "@/features/projects/hooks";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import { useTerminalStore } from "@/features/terminal/store";
import { TerminalTemplateDropdownContent } from "@/features/terminal/TerminalTemplateMenu";
import { useTerminalTemplateActions } from "@/features/terminal/terminalTemplateActions";
import TerminalTabs from "@/features/terminal/TerminalTabs";
import * as m from "@/paraglide/messages.js";

export default function ProjectDetailPage() {
	const { id, profileId } = useParams<{
		id: string;
		profileId: string;
	}>();
	const project = useProject(id!);
	const profiles = useProjectProfiles(id!);
	const profile = useMemo(
		() => profiles.find((p) => p.id === profileId),
		[profiles, profileId],
	);

	const hasTabs = useTerminalStore(
		(s) => (s.profiles[profileId ?? ""]?.tabs.length ?? 0) > 0,
	);
	const hasFileTabs = useFileViewerTabsStore(
		(s) => (s.profiles[profileId ?? ""]?.tabs.length ?? 0) > 0,
	);
	const notesActive = useFileViewerTabsStore(
		(s) => s.profiles[profileId ?? ""]?.notesActive ?? false,
	);
	const terminalTemplateActions = useTerminalTemplateActions({
		profileId: profile?.id ?? "",
		cwd: profile?.worktree_path ?? "",
		projectId: project?.id ?? "",
	});
	const { createTab, hasTemplates } = terminalTemplateActions;

	if (!project) {
		return <Navigate to="/" replace />;
	}

	if (!profile) {
		const fallbackProfile =
			profiles.find((item) => item.is_default) ?? profiles[0];

		if (fallbackProfile) {
			return (
				<Navigate
					to={`/projects/${project.id}/profiles/${fallbackProfile.id}`}
					replace
				/>
			);
		}

		return <Navigate to="/" replace />;
	}

	const shouldRenderEmptyState = !hasTabs && !hasFileTabs && !notesActive;
	const emptyTerminalState = (
		<Center h="full">
			<EmptyState.Root size="sm">
				<EmptyState.Content>
					<EmptyState.Indicator>
						<FiTerminal />
					</EmptyState.Indicator>
					<VStack textAlign="center">
						<EmptyState.Title>
							{m.noTerminalsOpen()}
						</EmptyState.Title>
						<EmptyState.Description>
							{m.noTerminalsOpenDescription()}
						</EmptyState.Description>
					</VStack>
					<HStack gap="0">
						<Button
							disabled={createTab.isPending}
							borderEndRadius={hasTemplates ? "0" : undefined}
							onClick={terminalTemplateActions.createDefaultTerminal}
						>
							<FiPlus />
							{m.newTerminal()}
						</Button>
						{hasTemplates && (
							<Menu.Root>
								<Menu.Trigger asChild>
									<Button
										disabled={createTab.isPending}
										borderStartRadius="0"
										borderStartWidth="1px"
										px="2"
										aria-label="Choose template"
									>
										<FiChevronDown />
									</Button>
								</Menu.Trigger>
								<Portal>
									<Menu.Positioner>
										<Menu.Content minW="56" p="1">
											<TerminalTemplateDropdownContent
												projectTemplates={
													terminalTemplateActions.projectTemplates
												}
												globalTemplates={
													terminalTemplateActions.globalTemplates
												}
												isPending={
													terminalTemplateActions.createTab.isPending
												}
												showEmptyState={false}
												onTemplateClick={(template, scope) => {
													void terminalTemplateActions
														.createTemplateTerminal(template, scope);
												}}
											/>
										</Menu.Content>
									</Menu.Positioner>
								</Portal>
							</Menu.Root>
						)}
					</HStack>
				</EmptyState.Content>
			</EmptyState.Root>
		</Center>
	);

	return (
		<>
			{shouldRenderEmptyState ? (
				<ProfileLayout
					projectId={project.id}
					projectName={project.name}
					profile={profile}
					isActive
				>
					<TerminalTabs
						projectId={project.id}
						profileId={profile.id}
						cwd={profile.worktree_path}
						profile={profile}
						emptyFallback={emptyTerminalState}
					/>
				</ProfileLayout>
			) : null}
		</>
	);
}
