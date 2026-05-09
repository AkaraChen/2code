import { HStack, Icon, Text } from "@chakra-ui/react";
import { FiPlus } from "react-icons/fi";
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
				userSelect="none"
				gap="2"
				w="full"
				minW="0"
				maxW="var(--sidebar-width)"
				overflow="hidden"
				ps="9"
				pe="4"
				py="1"
				cursor="pointer"
				fontSize="sm"
				color="fg.muted"
				_hover={{ bg: "bg.subtle", color: "fg" }}
				onClick={createDialog.onOpen}
			>
				<Icon fontSize="xs" flexShrink={0}>
					<FiPlus />
				</Icon>
				<Text flex="0 1 auto" minW="0" truncate>
					{m.createProfile()}
				</Text>
			</HStack>
			<CreateProfileDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
				projectId={projectId}
			/>
		</>
	);
}
