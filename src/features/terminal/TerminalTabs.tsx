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
import { RiAddLine, RiTerminalBoxLine } from "react-icons/ri";
import { useShallow } from "zustand/react/shallow";
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
			(s) => s.profiles[profileId] ?? { tabs: [], activeTabId: null },
		),
	);
	const notifiedTabs = useTerminalStore((s) => s.notifiedTabs);
	const setActiveTab = useTerminalStore((s) => s.setActiveTab);
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

	function clearCloseMenuTimer() {
		if (closeMenuTimerRef.current !== null) {
			window.clearTimeout(closeMenuTimerRef.current);
			closeMenuTimerRef.current = null;
		}
	}

	function openTemplateMenu() {
		if (!hasTemplates) return;
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

	if (tabs.length === 0) return null;

	return (
		<Flex direction="column" h="full" w="full">
			<Tabs.Root
				size="sm"
				value={activeTabId}
				onValueChange={(e) => setActiveTab(profileId, e.value)}
			>
				<Tabs.List>
					{tabs.map((tab) => {
						const displayTitle =
							tab.title.length > 10
								? `${tab.title.slice(0, 10)}...`
								: tab.title;
						return (
							<Tabs.Trigger key={tab.id} value={tab.id}>
								<RiTerminalBoxLine />
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
							<RiAddLine /> {m.newTerminal()}
						</Button>
					</Box>
				</Tabs.List>
			</Tabs.Root>

			{hasTemplates && isTemplateMenuOpen && templateMenuPosition ? (
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
					</Box>
				</Portal>
			) : null}

			{/* Terminal area — all terminals stay mounted, hidden via CSS */}
			<Box flex="1" minH="0" position="relative">
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
							isActive={tab.id === activeTabId}
						/>
					</Box>
				))}
			</Box>
		</Flex>
	);
}
