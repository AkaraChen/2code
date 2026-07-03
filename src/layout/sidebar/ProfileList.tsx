import { PlusIcon } from "@phosphor-icons/react";
import {
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import CreateProfileDialog from "@/features/profiles/CreateProfileDialog";
import type { Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { ProfileItem } from "./ProfileItem";

export function ProfileList({
	profiles,
	projectId,
	activeProfileId,
}: {
	profiles: Profile[];
	projectId: string;
	activeProfileId: string | null;
}) {
	const createDialog = useDialogState();

	return (
		<>
			{profiles.map((profile) => (
				<ProfileItem
					key={profile.id}
					profile={profile}
					projectId={projectId}
					isActive={profile.id === activeProfileId}
				/>
			))}
			<SidebarMenuSubItem>
				<SidebarMenuSubButton
					render={<button type="button" />}
					data-sidebar-item
					onClick={createDialog.onOpen}
				>
					<PlusIcon />
					<span>{m.createProfile()}</span>
				</SidebarMenuSubButton>
				<CreateProfileDialog
					isOpen={createDialog.isOpen}
					onClose={createDialog.onClose}
					projectId={projectId}
				/>
			</SidebarMenuSubItem>
		</>
	);
}
