import { useMemo, useState } from "react";
import {
	FiChevronDown,
	FiChevronRight,
	FiPlus,
	FiTerminal,
} from "react-icons/fi";
import { NavLink } from "react-router";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import CreateProfileDialog from "@/features/profiles/CreateProfileDialog";
import DeleteProjectDialog from "@/features/projects/DeleteProjectDialog";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import RenameProjectDialog from "@/features/projects/RenameProjectDialog";
import { AgentStatusDot } from "@/features/terminal/AgentStatusDot";
import {
	useProfileAgentCompletion,
	useProfileAgentStatus,
} from "@/features/terminal/store";
import type { ProjectGroup, ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import OverflowTooltipText from "@/shared/components/OverflowTooltipText";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { ProfileList } from "./ProfileList";
import { ProjectAvatar } from "./ProjectAvatar";
import { ProjectGroupMenu } from "./ProjectGroupMenu";

export function ProjectMenuItem({
	activeProfileId,
	project,
	projectGroups,
}: {
	activeProfileId: string | null;
	project: ProjectWithProfiles;
	projectGroups: ProjectGroup[];
}) {
	const defaultProfile = useMemo(
		() => project.profiles.find((p) => p.is_default),
		[project.profiles],
	);
	const nonDefaultProfiles = useMemo(
		() => project.profiles.filter((p) => !p.is_default),
		[project.profiles],
	);

	const hasOnlyDefaultProfile = nonDefaultProfiles.length === 0;
	const isDefaultActive = activeProfileId === defaultProfile?.id;
	const defaultProfileUrl = defaultProfile
		? `/projects/${project.id}/profiles/${defaultProfile.id}`
		: `/projects/${project.id}`;
	const defaultAgentStatus = useProfileAgentStatus(defaultProfile?.id ?? "");
	const defaultAgentCompletion = useProfileAgentCompletion(defaultProfile?.id ?? "");
	const defaultAgentIndicator = defaultAgentStatus ?? defaultAgentCompletion;
	const defaultProfileLabel = m.defaultProfile();

	const renameDialog = useDialogState();
	const deleteDialog = useDialogState();
	const settingsDialog = useDialogState();
	const createProfileDialog = useDialogState();
	const [menuOpen, setMenuOpen] = useState(false);
	const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
	const expanded = userExpanded ?? true;

	return (
		<SidebarMenuItem>
			<ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<ContextMenuTrigger
					render={(
						<SidebarMenuButton
							render={(
								<NavLink
									data-project-id={project.id}
									data-testid="project-sidebar-item"
									to={defaultProfileUrl}
								/>
							)}
							isActive={hasOnlyDefaultProfile && isDefaultActive}
							data-sidebar-item
						/>
					)}
				>
					<ProjectAvatar
						projectId={project.id}
						projectName={project.name}
					/>
					<span className="min-w-0 flex-1 truncate font-medium">
						{project.name}
					</span>
					{hasOnlyDefaultProfile && defaultAgentIndicator && (
						<AgentStatusDot status={defaultAgentIndicator} />
					)}
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuGroup>
						<ProjectGroupMenu
							project={project}
							projectGroups={projectGroups}
							onCloseMenu={() => setMenuOpen(false)}
						/>
						<ContextMenuItem onClick={settingsDialog.onOpen}>
							{m.projectSettings()}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="project-menu-rename"
							onClick={renameDialog.onOpen}
						>
							{m.renameProject()}
						</ContextMenuItem>
					</ContextMenuGroup>
					<ContextMenuSeparator />
					<ContextMenuItem
						variant="destructive"
						onClick={deleteDialog.onOpen}
					>
						{m.deleteProject()}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{hasOnlyDefaultProfile ? (
				<Tooltip>
					<TooltipTrigger
						render={(
							<SidebarMenuAction
								showOnHover
								aria-label={m.createProfile()}
							/>
						)}
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							createProfileDialog.onOpen();
						}}
						onKeyDown={(e) => {
							if (e.key !== "Enter" && e.key !== " ") return;
							e.preventDefault();
							e.stopPropagation();
							createProfileDialog.onOpen();
						}}
					>
						<FiPlus />
					</TooltipTrigger>
					<TooltipContent side="right">
						{m.createProfile()}
					</TooltipContent>
				</Tooltip>
			) : (
				<SidebarMenuAction
					aria-label={m.toggleProjectGroup({ name: project.name })}
					aria-expanded={expanded}
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						setUserExpanded((prev) =>
							prev === null ? !expanded : !prev,
						);
					}}
				>
					{expanded ? <FiChevronDown /> : <FiChevronRight />}
				</SidebarMenuAction>
			)}

			{!hasOnlyDefaultProfile && expanded && (
				<SidebarMenuSub>
					<SidebarMenuSubItem>
						<SidebarMenuSubButton
							render={<NavLink to={defaultProfileUrl} />}
							isActive={isDefaultActive}
							data-sidebar-item
						>
							<FiTerminal />
							<OverflowTooltipText
								displayValue={defaultProfileLabel}
								tooltipValue={defaultProfileLabel}
								className="min-w-0 flex-1"
							/>
							{defaultAgentIndicator && (
								<AgentStatusDot status={defaultAgentIndicator} />
							)}
						</SidebarMenuSubButton>
					</SidebarMenuSubItem>

					<ProfileList
						profiles={nonDefaultProfiles}
						projectId={project.id}
						activeProfileId={activeProfileId}
					/>
				</SidebarMenuSub>
			)}

			<RenameProjectDialog
				isOpen={renameDialog.isOpen}
				onClose={renameDialog.onClose}
				projectId={project.id}
				initName={project.name}
			/>
			<DeleteProjectDialog
				isOpen={deleteDialog.isOpen}
				onClose={deleteDialog.onClose}
				project={project}
			/>
			<ProjectSettingsDialog
				isOpen={settingsDialog.isOpen}
				onClose={settingsDialog.onClose}
				projectId={project.id}
			/>
			{hasOnlyDefaultProfile && (
				<CreateProfileDialog
					isOpen={createProfileDialog.isOpen}
					onClose={createProfileDialog.onClose}
					projectId={project.id}
				/>
			)}
		</SidebarMenuItem>
	);
}
