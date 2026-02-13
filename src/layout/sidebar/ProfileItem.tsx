import { Circle, HStack, Icon, Menu, Portal, Text } from "@chakra-ui/react";
import { RiGitBranchLine } from "react-icons/ri";
import { NavLink } from "react-router";
import DeleteProfileDialog from "@/features/profiles/DeleteProfileDialog";
import { useProfileHasNotification } from "@/features/terminal/store";
import type { Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";
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

	return (
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<HStack
						asChild
						data-sidebar-item
						gap="2"
						ps="9"
						pe="4"
						py="1"
						cursor="pointer"
						truncate
						fontSize="sm"
						bg={isActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
					>
						<NavLink
							to={`/projects/${projectId}/profiles/${profile.id}`}
						>
							<Icon fontSize="xs" color="fg.muted">
								<RiGitBranchLine />
							</Icon>
							<Text truncate>{profile.branch_name}</Text>
							{hasNotification && (
								<Circle size="2" bg="green.500" flexShrink={0} />
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
