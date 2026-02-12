import { HStack, Icon, Text } from "@chakra-ui/react";
import { RiAddLine } from "react-icons/ri";
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
			<HStack
				as="button"
				gap="2"
				ps="9"
				pe="4"
				py="1"
				cursor="pointer"
				fontSize="sm"
				color="fg.muted"
				_hover={{ bg: "bg.subtle", color: "fg" }}
				onClick={createDialog.onOpen}
			>
				<Icon fontSize="xs">
					<RiAddLine />
				</Icon>
				<Text>{m.createProfile()}</Text>
			</HStack>
			<CreateProfileDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
				projectId={projectId}
			/>
		</>
	);
}
