import { PlusIcon } from "@phosphor-icons/react";
import { memo, useCallback, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabsTrigger } from "@/components/ui/tabs";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import * as m from "@/paraglide/messages.js";
import { useTerminalTemplateActions } from "./terminalTemplateActions";
import type {
	GlobalTerminalTemplate,
	ProjectTerminalTemplate,
} from "./templates";

const NEW_TERMINAL_TAB_VALUE = "__new-terminal__";

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
		<DropdownMenuItem
			className="items-start py-2"
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
		</DropdownMenuItem>
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
		<>
			{projectTemplates.length > 0 ? (
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						{m.projectTerminalTemplates()}
					</DropdownMenuLabel>
					{projectTemplates.map((template) => (
						<TemplateMenuItem
							key={template.id}
							template={template}
							scope="project"
							isPending={isPending}
							onTemplateClick={onTemplateClick}
						/>
					))}
				</DropdownMenuGroup>
			) : null}

			{projectTemplates.length > 0 && globalTemplates.length > 0 ? (
				<DropdownMenuSeparator />
			) : null}

			{globalTemplates.length > 0 ? (
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						{m.globalTerminalTemplates()}
					</DropdownMenuLabel>
					{globalTemplates.map((template) => (
						<TemplateMenuItem
							key={template.id}
							template={template}
							scope="global"
							isPending={isPending}
							onTemplateClick={onTemplateClick}
						/>
					))}
				</DropdownMenuGroup>
			) : null}
		</>
	);
});

export default function TerminalTemplateMenu({
	profileId,
	cwd,
	projectId,
}: TerminalTemplateMenuProps) {
	const setTerminalActive = useFileViewerTabsStore((s) => s.setTerminalActive);
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
		if (createTab.isPending) return;
		setIsOpen(false);
		createDefaultTerminal();
	}, [createDefaultTerminal, createTab.isPending]);

	return (
		<DropdownMenu
			open={isOpen}
			onOpenChange={(open) => setIsOpen(open)}
			modal={false}
		>
			<DropdownMenuTrigger
				openOnHover
				delay={0}
				closeDelay={120}
				render={(
					<TabsTrigger
						value={NEW_TERMINAL_TAB_VALUE}
						aria-disabled={createTab.isPending}
						className="ms-2 max-w-56 flex-none justify-start"
						onPointerDown={(event) => event.preventBaseUIHandler()}
						onClick={(event) => {
							event.preventBaseUIHandler();
							event.preventDefault();
							handleCreateDefaultTerminal();
						}}
						onKeyDown={(event) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventBaseUIHandler();
							event.preventDefault();
							handleCreateDefaultTerminal();
						}}
					/>
				)}
			>
				<PlusIcon />
				<span>{m.newTerminal()}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent sideOffset={8}>
				<TerminalTemplateDropdownContent
					projectTemplates={projectTemplates}
					globalTemplates={globalTemplates}
					isPending={createTab.isPending}
					onTemplateClick={handleTemplateClick}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
