import { HStack, Icon, Text } from "@chakra-ui/react";
import { useState } from "react";
import { RiAddLine } from "react-icons/ri";
import CreateProfileDialog from "@/features/profiles/CreateProfileDialog";
import { useProfiles } from "@/features/profiles/hooks";
import * as m from "@/paraglide/messages.js";
import { ProfileItem } from "./ProfileItem";

export function ProfileList({
	projectId,
	activeProfileId,
}: {
	projectId: string;
	activeProfileId: string | null;
}) {
	const { data: profiles } = useProfiles(projectId);
	const [createOpen, setCreateOpen] = useState(false);

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
				onClick={() => setCreateOpen(true)}
			>
				<Icon fontSize="xs">
					<RiAddLine />
				</Icon>
				<Text>{m.createProfile()}</Text>
			</HStack>
			<CreateProfileDialog
				isOpen={createOpen}
				onClose={() => setCreateOpen(false)}
				projectId={projectId}
			/>
		</>
	);
}
