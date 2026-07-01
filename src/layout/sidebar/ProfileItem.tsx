import { FiGitBranch } from "react-icons/fi";
import { NavLink } from "react-router";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import DeleteProfileDialog from "@/features/profiles/DeleteProfileDialog";
import { AgentStatusDot } from "@/features/terminal/AgentStatusDot";
import { useProfileAgentStatus } from "@/features/terminal/store";
import type { Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";
import OverflowTooltipText from "@/shared/components/OverflowTooltipText";
import { useDialogState } from "@/shared/hooks/useDialogState";

export function ProfileItem({
	profile,
	projectId,
	isActive,
}: {
	profile: Profile;
	projectId: string;
	isActive: boolean;
}) {
	const deleteDialog = useDialogState();
	const agentStatus = useProfileAgentStatus(profile.id);

	return (
		<SidebarMenuSubItem>
			<ContextMenu>
				<ContextMenuTrigger
					render={(
						<SidebarMenuSubButton
							render={(
								<NavLink
									to={`/projects/${projectId}/profiles/${profile.id}`}
								/>
							)}
							isActive={isActive}
							data-sidebar-item
						/>
					)}
				>
					<FiGitBranch />
					<OverflowTooltipText
						displayValue={profile.branch_name}
						tooltipValue={profile.branch_name}
						className="min-w-0 flex-1"
					/>
					{agentStatus && <AgentStatusDot status={agentStatus} />}
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuGroup>
						<ContextMenuItem
							variant="destructive"
							onClick={deleteDialog.onOpen}
						>
							{m.deleteProfile()}
						</ContextMenuItem>
					</ContextMenuGroup>
				</ContextMenuContent>
			</ContextMenu>
			<DeleteProfileDialog
				isOpen={deleteDialog.isOpen}
				onClose={deleteDialog.onClose}
				profile={profile}
			/>
		</SidebarMenuSubItem>
	);
}
