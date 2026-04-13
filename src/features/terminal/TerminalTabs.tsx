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
import { getIconForFile } from "vscode-icons-js";
import { FiPlus, FiTerminal } from "react-icons/fi";

const ICONS_CDN = "https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@master/icons";
function fileIconUrl(name: string) {
	return `${ICONS_CDN}/${getIconForFile(name) ?? "default_file.svg"}`;
}
import { useShallow } from "zustand/react/shallow";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import FileViewerPane from "@/features/projects/FileViewerPane";
import { useProjectConfigQuery } from "@/features/projects/hooks";
import { useTerminalTemplatesStore } from "@/features/settings/stores/terminalTemplatesStore";
import * as m from "@/paraglide/messages.js";
import { useCloseTerminalTab, useCreateTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import {
	resolveGlobalTerminalTemplate,
	resolveProjectTerminalTemplate,
	type GlobalTerminalTemplate,
	type ProjectTerminalTemplate,
} from "./templates";
import { Terminal } from "./Terminal";

// Stable fallbacks — module-level constants prevent new object refs each render,
// which would break useShallow's equality check and cause infinite re-renders.
const EMPTY_TERMINAL_PROFILE = { tabs: [] as { id: string; title: string }[], activeTabId: null as string | null };
const EMPTY_FILE_PROFILE = { tabs: [] as { filePath: string; title: string }[], activeFilePath: null as string | null, fileTabActive: false };

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
		useShallow((s) => s.profiles[profileId] ?? EMPTY_TERMINAL_PROFILE),
	);
	const notifiedTabs = useTerminalStore((s) => s.notifiedTabs);
	const setActiveTab = useTerminalStore((s) => s.setActiveTab);

	const fileViewerState = useFileViewerTabsStore(
		(s) => s.profiles[profileId] ?? EMPTY_FILE_PROFILE,
	);
	const closeFileTab = useFileViewerTabsStore((s) => s.closeTab);
	const setFileActive = useFileViewerTabsStore((s) => s.setFileActive);
	const setTerminalActive = useFileViewerTabsStore((s) => s.setTerminalActive);

	const fileTabs = fileViewerState.tabs;
	const activeFilePath = fileViewerState.activeFilePath;
	const fileTabActive = fileViewerState.fileTabActive;

	const createTab = useCreateTerminalTab();
	const closeTab = useCloseTerminalTab();
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

	// Unified active tab value: file path when a file tab is active, session ID otherwise
	const activeValue = fileTabActive
		? (activeFilePath ?? "")
		: (activeTabId ?? "");

	function handleTabChange(value: string) {
		const isFileTab = fileTabs.some((t) => t.filePath === value);
		if (isFileTab) {
			setFileActive(profileId, value);
		} else {
			setActiveTab(profileId, value);
			setTerminalActive(profileId);
		}
	}

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
		setTerminalActive(profileId);
	}

	if (tabs.length === 0 && fileTabs.length === 0) return null;

	return (
		<Flex direction="column" h="full" w="full" minW="0">
			<Tabs.Root
				size="sm"
				w="full"
				minW="0"
				value={activeValue}
				onValueChange={(e) => handleTabChange(e.value)}
			>
				<Box overflowX="auto" overflowY="hidden" w="full" minW="0">
					<Tabs.List w="max-content" minW="max-content" flexWrap="nowrap">
						{tabs.map((tab) => {
							const displayTitle =
								tab.title.length > 10
									? `${tab.title.slice(0, 10)}...`
									: tab.title;
							return (
								<Tabs.Trigger
									key={tab.id}
									value={tab.id}
									flexShrink={0}
								>
									<FiTerminal />
									<HStack gap="2">
										{displayTitle}
										{notifiedTabs.has(tab.id) &&
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
													sessionId: tab.id,
												});
											}}
										/>
									</HStack>
								</Tabs.Trigger>
							);
						})}

						{fileTabs.map((tab) => {
							const displayTitle =
								tab.title.length > 14
									? `${tab.title.slice(0, 14)}...`
									: tab.title;
							return (
								<Tabs.Trigger
									key={tab.filePath}
									value={tab.filePath}
									flexShrink={0}
								>
									<img
										src={fileIconUrl(tab.title)}
										width={14}
										height={14}
										alt=""
										draggable={false}
									/>
									<HStack gap="2">
										{displayTitle}
										<CloseButton
											as="span"
											role="button"
											size="2xs"
											onClick={(e) => {
												e.stopPropagation();
												closeFileTab(profileId, tab.filePath);
											}}
										/>
									</HStack>
								</Tabs.Trigger>
							);
						})}

						<Box
							ref={newTerminalButtonRef}
							display="inline-flex"
							flexShrink={0}
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
									setTerminalActive(profileId);
								}}
							>
								<FiPlus /> {m.newTerminal()}
							</Button>
						</Box>
					</Tabs.List>
				</Box>
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

			{/* Content area */}

			{/* File viewer — static content, safe to conditionally render */}
			{fileTabActive && activeFilePath && (
				<Box flex="1" minH="0" overflow="hidden">
					<FileViewerPane filePath={activeFilePath} />
				</Box>
			)}

			{/* Terminal area — NEVER unmounted, hidden via CSS when file tab is active */}
			<Box
				flex="1"
				minH="0"
				position="relative"
				display={fileTabActive ? "none" : "block"}
			>
				{tabs.map((tab) => (
					<Box
						key={tab.id}
						position="absolute"
						inset="0"
						visibility={
							tab.id === activeTabId ? "visible" : "hidden"
						}
						pointerEvents={tab.id === activeTabId ? "auto" : "none"}
						aria-hidden={tab.id !== activeTabId}
					>
						<Terminal
							profileId={profileId}
							sessionId={tab.id}
							isActive={tab.id === activeTabId && !fileTabActive}
						/>
					</Box>
				))}
			</Box>
		</Flex>
	);
}
