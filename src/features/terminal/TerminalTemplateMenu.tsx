import {
	Box,
	Button,
	Portal,
	Stack,
	Text,
} from "@chakra-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { FiPlus } from "react-icons/fi";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import { useTerminalTemplatesStore } from "@/features/settings/stores/terminalTemplatesStore";
import * as m from "@/paraglide/messages.js";
import { useCreateTerminalTab } from "./hooks";
import { useProjectConfigQuery } from "@/features/projects/hooks";
import {
	resolveGlobalTerminalTemplate,
	resolveProjectTerminalTemplate,
	type GlobalTerminalTemplate,
	type ProjectTerminalTemplate,
} from "./templates";

const BUTTON_MOTION_PROPS = {
	layout: "position" as const,
	transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
} as const;

interface TerminalTemplateMenuProps {
	profileId: string;
	cwd: string;
	projectId: string;
}

export default function TerminalTemplateMenu({
	profileId,
	cwd,
	projectId,
}: TerminalTemplateMenuProps) {
	const createTab = useCreateTerminalTab();
	const projectConfig = useProjectConfigQuery(projectId);
	const globalTemplates = useTerminalTemplatesStore((s) => s.templates);
	const setTerminalActive = useFileViewerTabsStore((s) => s.setTerminalActive);
	const prefersReducedMotion = useReducedMotion();

	const [isOpen, setIsOpen] = useState(false);
	const [menuPosition, setMenuPosition] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const buttonRef = useRef<HTMLDivElement | null>(null);
	const closeTimerRef = useRef<number | null>(null);

	const projectTemplates = projectConfig.data?.terminal_templates ?? [];
	const hasTemplates = projectTemplates.length > 0 || globalTemplates.length > 0;
	const buttonMotionProps = prefersReducedMotion ? {} : BUTTON_MOTION_PROPS;

	function clearCloseTimer() {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}

	function open() {
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;
		clearCloseTimer();
		setMenuPosition({ top: rect.bottom + 8, left: rect.left, width: rect.width });
		setIsOpen(true);
	}

	function scheduleClose() {
		clearCloseTimer();
		closeTimerRef.current = window.setTimeout(() => {
			setIsOpen(false);
		}, 120);
	}

	useEffect(() => {
		return () => clearCloseTimer();
	}, []);

	async function handleTemplateClick(
		template: GlobalTerminalTemplate | ProjectTerminalTemplate,
		scope: "global" | "project",
	) {
		setIsOpen(false);
		const resolved =
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
			cwd: resolved.cwd,
			title: resolved.name,
			startupCommands: resolved.commands,
		});
		setTerminalActive(profileId);
	}

	return (
		<>
			<motion.div
				style={{ display: "flex", flexShrink: 0 }}
				{...buttonMotionProps}
			>
				<Box
					ref={buttonRef}
					display="inline-flex"
					flexShrink={0}
					alignSelf="center"
					ms="2"
					onMouseEnter={open}
					onMouseLeave={scheduleClose}
				>
					<Button
						size="2xs"
						variant="ghost"
						disabled={createTab.isPending}
						onClick={() => {
							setIsOpen(false);
							createTab.mutate({ profileId, cwd });
							setTerminalActive(profileId);
						}}
					>
						<FiPlus /> {m.newTerminal()}
					</Button>
				</Box>
			</motion.div>

			{isOpen && menuPosition ? (
				<Portal>
					<Box
						position="fixed"
						top={menuPosition.top}
						left={menuPosition.left}
						minW="2xs"
						w={`${Math.max(menuPosition.width + 32, 200)}px`}
						rounded="l3"
						borderWidth="1px"
						borderColor="border.subtle"
						bg="bg.panel"
						boxShadow="lg"
						p="1"
						zIndex="dropdown"
						onMouseEnter={open}
						onMouseLeave={scheduleClose}
					>
						{!hasTemplates ? (
							<Stack gap="1" px="2" py="2">
								<Text fontSize="sm" color="fg.muted">
									{m.noTerminalTemplates()}
								</Text>
								<Text fontSize="xs" color="fg.subtle">
									{m.noTemplatesDropdownHint()}
								</Text>
							</Stack>
						) : (
							<Stack gap="1">
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
												size="sm"
												variant="ghost"
												justifyContent="flex-start"
												alignItems="flex-start"
												h="auto"
												px="2"
												py="2"
												disabled={createTab.isPending}
												onClick={() => {
													void handleTemplateClick(template, "project");
												}}
											>
												<Stack gap="0.5" align="start" textAlign="left">
													<Text fontSize="sm">{template.name}</Text>
													{template.cwd.trim() ? (
														<Text fontSize="xs" color="fg.muted">
															{template.cwd.trim()}
														</Text>
													) : null}
												</Stack>
											</Button>
										))}
									</>
								) : null}

								{projectTemplates.length > 0 && globalTemplates.length > 0 ? (
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
												size="sm"
												variant="ghost"
												justifyContent="flex-start"
												alignItems="flex-start"
												h="auto"
												px="2"
												py="2"
												disabled={createTab.isPending}
												onClick={() => {
													void handleTemplateClick(template, "global");
												}}
											>
												<Text fontSize="sm">{template.name}</Text>
											</Button>
										))}
									</>
								) : null}
							</Stack>
						)}
					</Box>
				</Portal>
			) : null}
		</>
	);
}
