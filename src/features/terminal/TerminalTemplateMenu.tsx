import {
	Box,
	Button,
	Portal,
	Stack,
	Text,
} from "@chakra-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiPlus } from "react-icons/fi";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import * as m from "@/paraglide/messages.js";
import { TAB_STRIP_HEIGHT } from "./TabStrip";
import { useTerminalTemplateActions } from "./terminalTemplateActions";
import type {
	GlobalTerminalTemplate,
	ProjectTerminalTemplate,
} from "./templates";

const BUTTON_MOTION_PROPS = {
	layout: "position" as const,
	transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
} as const;
const REDUCED_MOTION_PROPS = {};

interface TerminalTemplateMenuProps {
	profileId: string;
	cwd: string;
	projectId: string;
}

interface TerminalTemplateDropdownContentProps {
	projectTemplates: ProjectTerminalTemplate[];
	globalTemplates: GlobalTerminalTemplate[];
	isPending: boolean;
	onTemplateClick: (
		template: GlobalTerminalTemplate | ProjectTerminalTemplate,
		scope: "global" | "project",
	) => void;
	showEmptyState?: boolean;
}

interface TemplateMenuItemProps {
	template: GlobalTerminalTemplate | ProjectTerminalTemplate;
	scope: "global" | "project";
	isPending: boolean;
	onTemplateClick: (
		template: GlobalTerminalTemplate | ProjectTerminalTemplate,
		scope: "global" | "project",
	) => void;
}

const TemplateMenuItem = memo(({
	template,
	scope,
	isPending,
	onTemplateClick,
}: TemplateMenuItemProps) => {
	const handleClick = useCallback(() => {
		onTemplateClick(template, scope);
	}, [onTemplateClick, scope, template]);
	const cwd =
		scope === "project"
			? (template as ProjectTerminalTemplate).cwd.trim()
			: "";

	return (
		<Button
			size="sm"
			variant="ghost"
			justifyContent="flex-start"
			alignItems="flex-start"
			h="auto"
			px="2"
			py="2"
			disabled={isPending}
			onClick={handleClick}
		>
			{scope === "project" ? (
				<Stack gap="0.5" align="start" textAlign="left">
					<Text fontSize="sm">{template.name}</Text>
					{cwd ? (
						<Text fontSize="xs" color="fg.muted">
							{cwd}
						</Text>
					) : null}
				</Stack>
			) : (
				<Text fontSize="sm">{template.name}</Text>
			)}
		</Button>
	);
});

export const TerminalTemplateDropdownContent = memo(({
	projectTemplates,
	globalTemplates,
	isPending,
	onTemplateClick,
	showEmptyState = true,
}: TerminalTemplateDropdownContentProps) => {
	const hasTemplates = projectTemplates.length > 0 || globalTemplates.length > 0;

	if (!hasTemplates) {
		if (!showEmptyState) return null;

		return (
			<Stack gap="1" px="2" py="2">
				<Text fontSize="sm" color="fg.muted">
					{m.noTerminalTemplates()}
				</Text>
				<Text fontSize="xs" color="fg.subtle">
					{m.noTemplatesDropdownHint()}
				</Text>
			</Stack>
		);
	}

	return (
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
						<TemplateMenuItem
							key={template.id}
							template={template}
							scope="project"
							isPending={isPending}
							onTemplateClick={onTemplateClick}
						/>
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
						<TemplateMenuItem
							key={template.id}
							template={template}
							scope="global"
							isPending={isPending}
							onTemplateClick={onTemplateClick}
						/>
					))}
				</>
			) : null}
		</Stack>
	);
});

export default function TerminalTemplateMenu({
	profileId,
	cwd,
	projectId,
}: TerminalTemplateMenuProps) {
	const setTerminalActive = useFileViewerTabsStore((s) => s.setTerminalActive);
	const prefersReducedMotion = useReducedMotion();
	const handleCreated = useCallback(() => {
		setTerminalActive(profileId);
	}, [profileId, setTerminalActive]);
	const {
		createDefaultTerminal,
		createTab,
		createTemplateTerminal,
		globalTemplates,
		projectTemplates,
	} = useTerminalTemplateActions({
		profileId,
		cwd,
		projectId,
		onCreated: handleCreated,
	});

	const [isOpen, setIsOpen] = useState(false);
	const [menuPosition, setMenuPosition] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const buttonRef = useRef<HTMLDivElement | null>(null);
	const closeTimerRef = useRef<number | null>(null);

	const buttonMotionProps = prefersReducedMotion
		? REDUCED_MOTION_PROPS
		: BUTTON_MOTION_PROPS;

	const clearCloseTimer = useCallback(() => {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}, []);

	const open = useCallback(() => {
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;
		clearCloseTimer();
		setMenuPosition({ top: rect.bottom + 8, left: rect.left, width: rect.width });
		setIsOpen(true);
	}, [clearCloseTimer]);

	const scheduleClose = useCallback(() => {
		clearCloseTimer();
		closeTimerRef.current = window.setTimeout(() => {
			setIsOpen(false);
		}, 120);
	}, [clearCloseTimer]);

	useEffect(() => {
		return () => clearCloseTimer();
	}, [clearCloseTimer]);

	const handleTemplateClick = useCallback(
		async (
			template: GlobalTerminalTemplate | ProjectTerminalTemplate,
			scope: "global" | "project",
		) => {
			setIsOpen(false);
			await createTemplateTerminal(template, scope);
		},
		[createTemplateTerminal],
	);
	const handleCreateDefaultTerminal = useCallback(() => {
		setIsOpen(false);
		createDefaultTerminal();
	}, [createDefaultTerminal]);
	const menuWidth = useMemo(
		() =>
			menuPosition
				? `${Math.max(menuPosition.width + 32, 200)}px`
				: "200px",
		[menuPosition],
	);

	return (
		<>
			<motion.div
				style={{ display: "flex", flexShrink: 0, height: "100%" }}
				{...buttonMotionProps}
			>
				<Box
					ref={buttonRef}
					display="inline-flex"
					flexShrink={0}
					alignItems="center"
					alignSelf="stretch"
					h={TAB_STRIP_HEIGHT}
					ms="2"
					onMouseEnter={open}
					onMouseLeave={scheduleClose}
				>
					<Button
						size="2xs"
						variant="ghost"
						disabled={createTab.isPending}
						onClick={handleCreateDefaultTerminal}
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
						w={menuWidth}
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
						<TerminalTemplateDropdownContent
							projectTemplates={projectTemplates}
							globalTemplates={globalTemplates}
							isPending={createTab.isPending}
							onTemplateClick={handleTemplateClick}
						/>
					</Box>
				</Portal>
			) : null}
		</>
	);
}
