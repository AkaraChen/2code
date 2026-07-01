import { motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiPlus } from "react-icons/fi";
import { Button } from "@/components/ui/button";
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
		<button
			type="button"
			className="flex w-full items-start rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
			disabled={isPending}
			onClick={handleClick}
		>
			{scope === "project" ? (
				<span className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate">{template.name}</span>
					{cwd ? (
						<span className="truncate text-xs text-muted-foreground">
							{cwd}
						</span>
					) : null}
				</span>
			) : (
				<span className="truncate">{template.name}</span>
			)}
		</button>
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
			<div className="flex flex-col gap-1 px-2 py-2">
				<p className="text-sm text-muted-foreground">
					{m.noTerminalTemplates()}
				</p>
				<p className="text-xs text-muted-foreground">
					{m.noTemplatesDropdownHint()}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1">
			{projectTemplates.length > 0 ? (
				<>
					<div className="px-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">
						{m.projectTerminalTemplates()}
					</div>
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
				<div className="mx-2 h-px bg-border" />
			) : null}

			{globalTemplates.length > 0 ? (
				<>
					<div className="px-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">
						{m.globalTerminalTemplates()}
					</div>
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
		</div>
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
				<div
					ref={buttonRef}
					className="ms-2 inline-flex shrink-0 items-center self-stretch"
					style={{ height: TAB_STRIP_HEIGHT }}
					onMouseEnter={open}
					onMouseLeave={scheduleClose}
				>
					<Button
						size="xs"
						variant="ghost"
						disabled={createTab.isPending}
						onClick={handleCreateDefaultTerminal}
					>
						<FiPlus /> {m.newTerminal()}
					</Button>
				</div>
			</motion.div>

			{isOpen && menuPosition ? (
				<div
					className="fixed z-50 min-w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
					style={{
						top: menuPosition.top,
						left: menuPosition.left,
						width: menuWidth,
					}}
					onMouseEnter={open}
					onMouseLeave={scheduleClose}
				>
					<TerminalTemplateDropdownContent
						projectTemplates={projectTemplates}
						globalTemplates={globalTemplates}
						isPending={createTab.isPending}
						onTemplateClick={handleTemplateClick}
					/>
				</div>
			) : null}
		</>
	);
}
