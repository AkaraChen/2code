import {
	Box,
	Button,
	Center,
	EmptyState,
	Flex,
	HStack,
	Menu,
	Portal,
	Stack,
	Text,
	VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { FiChevronDown, FiPlus, FiTerminal } from "react-icons/fi";
import { Navigate, useParams } from "react-router";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import FileTreePanel from "@/features/projects/FileTreePanel";
import {
	useProject,
	useProjectConfigQuery,
	useProjectProfiles,
} from "@/features/projects/hooks";
import { useFileTreeStore } from "@/features/projects/fileTreeStore";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import { useTerminalTemplatesStore } from "@/features/settings/stores/terminalTemplatesStore";
import { useCreateTerminalTab } from "@/features/terminal/hooks";
import { useTerminalStore } from "@/features/terminal/store";
import {
	resolveGlobalTerminalTemplate,
	resolveProjectTerminalTemplate,
	type GlobalTerminalTemplate,
	type ProjectTerminalTemplate,
} from "@/features/terminal/templates";
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

	const fileTreeOpen = useFileTreeStore((s) => s.isOpen(profileId ?? ""));
	const toggleFileTree = useFileTreeStore((s) => s.toggle);

	const hasTabs = useTerminalStore(
		(s) => (s.profiles[profileId ?? ""]?.tabs.length ?? 0) > 0,
	);
	const hasFileTabs = useFileViewerTabsStore(
		(s) => (s.profiles[profileId ?? ""]?.tabs.length ?? 0) > 0,
	);
	const openFileTab = useFileViewerTabsStore((s) => s.openFile);
	const createTab = useCreateTerminalTab();
	const projectConfig = useProjectConfigQuery(project?.id ?? "");
	const globalTemplates = useTerminalTemplatesStore((s) => s.templates);
	const projectTemplates = projectConfig.data?.terminal_templates ?? [];
	const hasTemplates = projectTemplates.length > 0 || globalTemplates.length > 0;

	async function handleTemplateClick(
		template: GlobalTerminalTemplate | ProjectTerminalTemplate,
		scope: "global" | "project",
	) {
		if (!profile) return;
		const resolvedTemplate =
			scope === "project"
				? await resolveProjectTerminalTemplate(
						template as ProjectTerminalTemplate,
						profile.worktree_path,
					)
				: resolveGlobalTerminalTemplate(
						template as GlobalTerminalTemplate,
						profile.worktree_path,
					);
		await createTab.mutateAsync({
			profileId: profile.id,
			cwd: resolvedTemplate.cwd,
			title: resolvedTemplate.name,
			startupCommands: resolvedTemplate.commands,
		});
	}

	if (!project || !profile) {
		return <Navigate to="/" replace />;
	}

	// TerminalLayer handles rendering when any tab (terminal or file) is open
	if (hasTabs || hasFileTabs) return null;

	return (
		<Flex direction="column" h="full">
			<ProjectTopBar
				projectId={project.id}
				projectName={project.name}
				profile={profile}
				isActive
				isFileTreeOpen={fileTreeOpen}
				onToggleFileTree={() => toggleFileTree(profileId ?? "")}
			/>
			<Flex flex="1" overflow="hidden">
			<FileTreePanel
				rootPath={profile.worktree_path}
				isOpen={fileTreeOpen}
				onOpenFile={(filePath) => openFileTab(profile.id, filePath)}
			/>
			<Center flex="1">
					<EmptyState.Root>
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
								onClick={() =>
									createTab.mutate({
										profileId: profile.id,
										cwd: profile.worktree_path,
									})
								}
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
											<Menu.Content minW="56">
												{projectTemplates.length > 0 && (
													<>
														<Box
															px="3"
															pt="2"
															pb="1"
															fontSize="xs"
															fontWeight="semibold"
															color="fg.muted"
															textTransform="uppercase"
														>
															{m.projectTerminalTemplates()}
														</Box>
														{projectTemplates.map((template) => (
															<Menu.Item
																key={template.id}
																value={template.id}
																onClick={() => {
																	void handleTemplateClick(
																		template,
																		"project",
																	);
																}}
															>
																<Stack gap="0.5" align="start">
																	<Text fontSize="sm">
																		{template.name}
																	</Text>
																	{template.cwd.trim() && (
																		<Text
																			fontSize="xs"
																			color="fg.muted"
																		>
																			{template.cwd.trim()}
																		</Text>
																	)}
																</Stack>
															</Menu.Item>
														))}
													</>
												)}
												{projectTemplates.length > 0 &&
													globalTemplates.length > 0 && (
														<Menu.Separator />
													)}
												{globalTemplates.length > 0 && (
													<>
														<Box
															px="3"
															pt="2"
															pb="1"
															fontSize="xs"
															fontWeight="semibold"
															color="fg.muted"
															textTransform="uppercase"
														>
															{m.globalTerminalTemplates()}
														</Box>
														{globalTemplates.map((template) => (
															<Menu.Item
																key={template.id}
																value={template.id}
																onClick={() => {
																	void handleTemplateClick(
																		template,
																		"global",
																	);
																}}
															>
																<Text fontSize="sm">
																	{template.name}
																</Text>
															</Menu.Item>
														))}
													</>
												)}
											</Menu.Content>
										</Menu.Positioner>
									</Portal>
								</Menu.Root>
							)}
						</HStack>
					</EmptyState.Content>
				</EmptyState.Root>
			</Center>
			</Flex>
		</Flex>
	);
}
