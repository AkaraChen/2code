import { HStack, Icon, Menu, Portal } from "@chakra-ui/react";
import { FiGitBranch } from "react-icons/fi";
import { NavLink } from "react-router";
import DeleteProfileDialog from "@/features/profiles/DeleteProfileDialog";
import { AgentStatusDot } from "@/features/terminal/AgentStatusDot";
import { useProfileAgentStatus } from "@/features/terminal/store";
import type { Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";
import OverflowTooltipText from "@/shared/components/OverflowTooltipText";
import { SidebarActiveIndicator } from "@/shared/components/SidebarActiveIndicator";
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
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<HStack
						asChild
						data-sidebar-item
						userSelect="none"
						align="center"
						gap="2"
						w="full"
						minW="0"
						maxW="var(--sidebar-width)"
						overflow="hidden"
						position="relative"
						ps="9"
						pe="4"
						py="1"
						fontSize="sm"
						bg={isActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
						_active={{ bg: "bg.muted" }}
					>
						<NavLink to={`/projects/${projectId}/profiles/${profile.id}`}>
							{isActive && (
								<SidebarActiveIndicator insetInlineStart="0" />
							)}
							<Icon fontSize="xs" color="fg.muted" flexShrink={0}>
								<FiGitBranch />
							</Icon>
							<OverflowTooltipText
								displayValue={profile.branch_name}
								tooltipValue={profile.branch_name}
								fontSize="sm"
								lineHeight="1.25rem"
								visualOffsetY="1px"
								flex="1 1 auto"
								minW="0"
							/>
							{agentStatus && <AgentStatusDot status={agentStatus} />}
						</NavLink>
					</HStack>
				</Menu.ContextTrigger>
				<Portal>
					<Menu.Positioner>
						<Menu.Content>
							<Menu.Item
								value="delete"
								color="fg.error"
								_hover={{ bg: "bg.error", color: "fg.error" }}
								onClick={deleteDialog.onOpen}
							>
								{m.deleteProfile()}
							</Menu.Item>
						</Menu.Content>
					</Menu.Positioner>
				</Portal>
			</Menu.Root>
			<DeleteProfileDialog
				isOpen={deleteDialog.isOpen}
				onClose={deleteDialog.onClose}
				profile={profile}
			/>
		</>
	);
}
