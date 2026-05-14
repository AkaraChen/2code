import { Circle, HStack, Icon, Menu, Portal } from "@chakra-ui/react";
import { FiGitBranch } from "react-icons/fi";
import { NavLink } from "react-router";
import DeleteProfileDialog from "@/features/profiles/DeleteProfileDialog";
import { useProfileHasNotification, useTerminalStore } from "@/features/terminal/store";
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
	const hasNotification = useProfileHasNotification(profile.id);
	const markProfileRead = useTerminalStore((s) => s.markProfileRead);

	return (
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<HStack
						asChild
						data-sidebar-item
						userSelect="none"
						gap="2"
						w="full"
						minW="0"
						maxW="var(--sidebar-width)"
						overflow="hidden"
						position="relative"
						ps="9"
						pe="4"
						py="1"
						cursor="pointer"
						fontSize="sm"
						bg={isActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
					>
						<NavLink
							to={`/projects/${projectId}/profiles/${profile.id}`}
							onClick={() => markProfileRead(profile.id)}
						>
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
								flex="1 1 auto"
								minW="0"
							/>
							{hasNotification && (
								<Circle
									size="2"
									bg="green.500"
									flexShrink={0}
								/>
							)}
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
