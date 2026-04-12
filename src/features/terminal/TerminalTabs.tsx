import {
	Box,
	Button,
	Circle,
	CloseButton,
	Flex,
	HStack,
	Portal,
	Stack,
	Tabs,
	Text,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { FiPlus, FiTerminal } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import { useProjectConfigQuery } from "@/features/projects/hooks";
import { useTerminalTemplatesStore } from "@/features/settings/stores/terminalTemplatesStore";
import * as m from "@/paraglide/messages.js";
import {
	useCloseTerminalPane,
	useCloseTerminalTab,
	useCreateTerminalTab,
	useSplitTerminalPane,
} from "./hooks";
import { Terminal } from "./Terminal";
import { useTerminalStore } from "./store";
import {
	resolveGlobalTerminalTemplate,
	resolveProjectTerminalTemplate,
	type GlobalTerminalTemplate,
	type ProjectTerminalTemplate,
} from "./templates";

interface TerminalTabsProps {
	projectId: string;
	profileId: string;
	cwd: string;
}

export default function TerminalTabs({
	projectId,
	profileId,
	cwd,
}: TerminalTabsProps) {
	const { tabs, activeTabId } = useTerminalStore(
		useShallow(
			(s) =>
				s.profiles[profileId] ?? {
					tabs: [],
					activeTabId: null,
				},
		),
	);
	const notifiedTabs = useTerminalStore((s) => s.notifiedTabs);
	const setActiveTab = useTerminalStore((s) => s.setActiveTab);
	const setActivePane = useTerminalStore((s) => s.setActivePane);
	const createTab = useCreateTerminalTab();
	const splitPane = useSplitTerminalPane();
	const closeTab = useCloseTerminalTab();
	const closePane = useCloseTerminalPane();
	const projectConfig = useProjectConfigQuery(projectId);
	const globalTemplates = useTerminalTemplatesStore((s) => s.templates);
	const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
	const [templateMenuPosition, setTemplateMenuPosition] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const newTerminalButtonRef = useRef<HTMLDivElement | null>(null);
	const closeMenuTimerRef = useRef<number | null>(null);

	const projectTemplates = projectConfig.data?.terminal_templates ?? [];
	const hasTemplates =
		projectTemplates.length > 0 || globalTemplates.length > 0;
	const activeTab =
		tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
	const activePane =
		activeTab?.panes.find(
			(pane) => pane.sessionId === activeTab.activePaneId,
		) ?? activeTab?.panes[0] ?? null;
	const canSplitActiveTab =
		Boolean(activeTab && activePane) && activeTab.panes.length < 2;

	function clearCloseMenuTimer() {
		if (closeMenuTimerRef.current !== null) {
			window.clearTimeout(closeMenuTimerRef.current);
			closeMenuTimerRef.current = null;
		}
	}

	function openTemplateMenu() {
		const rect = newTerminalButtonRef.current?.getBoundingClientRect();
		if (!rect) return;
		clearCloseMenuTimer();
		setTemplateMenuPosition({
			top: rect.bottom + 8,
			left: rect.left,
			width: rect.width,
		});
		setIsTemplateMenuOpen(true);
	}

	function scheduleTemplateMenuClose() {
		clearCloseMenuTimer();
		closeMenuTimerRef.current = window.setTimeout(() => {
			setIsTemplateMenuOpen(false);
		}, 120);
	}

	useEffect(() => {
		return () => clearCloseMenuTimer();
	}, []);

	async function handleTemplateClick(
		template: GlobalTerminalTemplate | ProjectTerminalTemplate,
		scope: "global" | "project",
	) {
		setIsTemplateMenuOpen(false);

		const resolvedTemplate =
			scope === "project"
				? await resolveProjectTerminalTemplate(
						template as ProjectTerminalTemplate,
						cwd,
					)
				: resolveGlobalTerminalTemplate(
						template as GlobalTerminalTemplate,
						cwd,
					);

		await createTab.mutateAsync({
			profileId,
			cwd: resolvedTemplate.cwd,
			title: resolvedTemplate.name,
			startupCommands: resolvedTemplate.commands,
		});
	}

	function handleSplit(direction: "horizontal" | "vertical") {
		if (!activeTab || !activePane || activeTab.panes.length >= 2) return;

		splitPane.mutate({
			profileId,
			tabId: activeTab.id,
			direction,
			cwd: activePane.cwd,
			shell: activePane.shell,
		});
	}

	if (tabs.length === 0) return null;

	return (
		<Flex direction="column" h="full" w="full">
			<Tabs.Root
				size="sm"
				value={activeTabId ?? undefined}
				onValueChange={(e) => setActiveTab(profileId, e.value)}
			>
				<Tabs.List>
					{tabs.map((tab) => {
						const displayTitle =
							tab.title.length > 10
								? `${tab.title.slice(0, 10)}...`
								: tab.title;
						const tabHasNotification = tab.panes.some((pane) =>
							notifiedTabs.has(pane.sessionId),
						);

						return (
							<Tabs.Trigger key={tab.id} value={tab.id}>
								<FiTerminal />
								<HStack gap="2">
									{displayTitle}
									{tabHasNotification &&
										tab.id !== activeTabId && (
											<Circle size="2" bg="green.500" />
										)}
									<CloseButton
										as="span"
										role="button"
										size="2xs"
										onClick={(e) => {
											e.stopPropagation();
											closeTab.mutate({
												profileId,
												tabId: tab.id,
											});
										}}
									/>
								</HStack>
							</Tabs.Trigger>
						);
					})}
					<Box
						ref={newTerminalButtonRef}
						display="inline-flex"
						alignSelf="center"
						ms="2"
						onMouseEnter={openTemplateMenu}
						onMouseLeave={scheduleTemplateMenuClose}
					>
						<Button
							size="2xs"
							variant="ghost"
							disabled={createTab.isPending}
							onClick={() => {
								setIsTemplateMenuOpen(false);
								createTab.mutate({ profileId, cwd });
							}}
						>
							<FiPlus /> {m.newTerminal()}
						</Button>
					</Box>
					<Button
						size="2xs"
						variant="ghost"
						ms="1"
						disabled={!canSplitActiveTab || splitPane.isPending}
						onClick={() => handleSplit("horizontal")}
					>
						{m.splitTerminalRight()}
					</Button>
					<Button
						size="2xs"
						variant="ghost"
						ms="1"
						disabled={!canSplitActiveTab || splitPane.isPending}
						onClick={() => handleSplit("vertical")}
					>
						{m.splitTerminalDown()}
					</Button>
				</Tabs.List>
			</Tabs.Root>

			{isTemplateMenuOpen && templateMenuPosition ? (
				<Portal>
					<Box
						position="fixed"
						top={templateMenuPosition.top}
						left={templateMenuPosition.left}
						minW="xs"
						w={`${Math.max(templateMenuPosition.width + 48, 260)}px`}
						rounded="l3"
						borderWidth="1px"
						borderColor="border.subtle"
						bg="bg.panel"
						boxShadow="lg"
						p="2"
						zIndex="dropdown"
						onMouseEnter={openTemplateMenu}
						onMouseLeave={scheduleTemplateMenuClose}
					>
						{!hasTemplates ? (
							<Stack gap="1" px="2" py="3">
								<Text fontSize="sm" color="fg.muted">
									{m.noTerminalTemplates()}
								</Text>
								<Text fontSize="xs" color="fg.subtle">
									{m.noTemplatesDropdownHint()}
								</Text>
							</Stack>
						) : (
							<Stack gap="2">
								{projectTemplates.length > 0 ? (
									<>
										<Text
											px="2"
											pt="1"
											fontSize="xs"
											fontWeight="semibold"
											color="fg.muted"
											textTransform="uppercase"
										>
											{m.projectTerminalTemplates()}
										</Text>
										{projectTemplates.map((template) => (
											<Button
												key={template.id}
												variant="ghost"
												justifyContent="flex-start"
												alignItems="flex-start"
												h="auto"
												px="2"
												py="2"
												disabled={createTab.isPending}
												onClick={() => {
													void handleTemplateClick(
														template,
														"project",
													);
												}}
											>
												<Stack
													gap="0.5"
													align="start"
													textAlign="left"
												>
													<Text fontSize="sm">
														{template.name}
													</Text>
													{template.cwd.trim() ? (
														<Text
															fontSize="xs"
															color="fg.muted"
														>
															{template.cwd.trim()}
														</Text>
													) : null}
												</Stack>
											</Button>
										))}
									</>
								) : null}

								{projectTemplates.length > 0 &&
								globalTemplates.length > 0 ? (
									<Box h="1px" bg="border.subtle" mx="2" />
								) : null}

								{globalTemplates.length > 0 ? (
									<>
										<Text
											px="2"
											pt="1"
											fontSize="xs"
											fontWeight="semibold"
											color="fg.muted"
											textTransform="uppercase"
										>
											{m.globalTerminalTemplates()}
										</Text>
										{globalTemplates.map((template) => (
											<Button
												key={template.id}
												variant="ghost"
												justifyContent="flex-start"
												alignItems="flex-start"
												h="auto"
												px="2"
												py="2"
												disabled={createTab.isPending}
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
											</Button>
										))}
									</>
								) : null}
							</Stack>
						)}
					</Box>
				</Portal>
			) : null}

			{/* Terminal area — all tabs and panes stay mounted, hidden via CSS */}
			<Box flex="1" minH="0" position="relative">
				{tabs.map((tab) => {
					const isTabActive = tab.id === activeTabId;
					const layoutDirection =
						tab.direction === "vertical" ? "column" : "row";

					return (
						<Box
							key={tab.id}
							position="absolute"
							inset="0"
							visibility={isTabActive ? "visible" : "hidden"}
							pointerEvents={isTabActive ? "auto" : "none"}
							aria-hidden={!isTabActive}
							p="2"
						>
							<Flex
								direction={layoutDirection}
								gap="2"
								h="full"
								w="full"
							>
								{tab.panes.map((pane) => {
									const isPaneActive =
										isTabActive &&
										pane.sessionId === tab.activePaneId;
									const paneHasNotification =
										notifiedTabs.has(pane.sessionId);

									return (
										<Flex
											key={pane.sessionId}
											direction="column"
											flex="1"
											minW="0"
											minH="0"
											rounded="l3"
											overflow="hidden"
											bg="bg.panel"
										>
											<HStack
												gap="2"
												h="8"
												px="2"
												borderBottomWidth="1px"
												borderColor="border.subtle"
												bg={isPaneActive ? "bg.subtle" : "bg"}
												onMouseDown={() =>
													setActivePane(
														profileId,
														tab.id,
														pane.sessionId,
													)
												}
											>
												<Box
													w="2px"
													h="4"
													borderRadius="full"
													bg={
														isPaneActive
															? "colorPalette.solid"
															: "transparent"
													}
													flexShrink={0}
												/>
												<Text
													flex="1"
													minW="0"
													fontSize="xs"
													truncate
												>
													{pane.title}
												</Text>
												{paneHasNotification &&
												pane.sessionId !== tab.activePaneId ? (
													<Circle
														size="2"
														bg="green.500"
														flexShrink={0}
													/>
												) : null}
												{tab.panes.length > 1 ? (
													<CloseButton
														size="2xs"
														aria-label={m.closeTerminalPane()}
														disabled={closePane.isPending}
														onClick={(event) => {
															event.stopPropagation();
															closePane.mutate({
																profileId,
																tabId: tab.id,
																sessionId:
																	pane.sessionId,
															});
														}}
													/>
												) : null}
											</HStack>
											<Box
												flex="1"
												minH="0"
												onMouseDown={() =>
													setActivePane(
														profileId,
														tab.id,
														pane.sessionId,
													)
												}
											>
												<Terminal
													profileId={profileId}
													sessionId={pane.sessionId}
													isActive={isPaneActive}
													onFocus={() =>
														setActivePane(
															profileId,
															tab.id,
															pane.sessionId,
														)
													}
												/>
											</Box>
										</Flex>
									);
								})}
							</Flex>
						</Box>
					);
				})}
			</Box>
		</Flex>
	);
}
