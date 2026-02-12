import { HStack, Icon, Menu, Portal, Text } from "@chakra-ui/react";
import { useState } from "react";
import { RiGitBranchLine } from "react-icons/ri";
import { NavLink } from "react-router";
import DeleteProfileDialog from "@/features/profiles/DeleteProfileDialog";
import type { Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";

export function ProfileItem({
	profile,
	projectId,
	isActive,
}: {
	profile: Profile;
	projectId: string;
	isActive: boolean;
}) {
	const [deleteOpen, setDeleteOpen] = useState(false);

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
								onClick={() => setDeleteOpen(true)}
							>
								{m.deleteProfile()}
							</Menu.Item>
						</Menu.Content>
					</Menu.Positioner>
				</Portal>
			</Menu.Root>
			<DeleteProfileDialog
				isOpen={deleteOpen}
				onClose={() => setDeleteOpen(false)}
				profile={profile}
			/>
		</>
	);
}
