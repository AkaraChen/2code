import { Box, Image, Text } from "@chakra-ui/react";
import { useState } from "react";
import { useProjectAvatar } from "@/features/projects/hooks";
import { useSidebarSettingsStore } from "@/features/settings/stores/sidebarSettingsStore";

function getProjectAvatarFallback(name: string) {
	const trimmed = name.trim();
	if (!trimmed) {
		return "?";
	}

	return Array.from(trimmed)[0]?.toUpperCase() ?? "?";
}

export function ProjectAvatar({
	projectId,
	projectName,
}: { projectId: string; projectName: string }) {
	const { showProjectAvatars } = useSidebarSettingsStore();
	const { data: avatarUrl } = useProjectAvatar(projectId, {
		enabled: showProjectAvatars,
	});
	const [imageFailed, setImageFailed] = useState(false);

	if (!showProjectAvatars) {
		return null;
	}

	const shouldShowImage = !!avatarUrl && !imageFailed;
	const fallbackText = getProjectAvatarFallback(projectName);

	return (
		<Box
			w="5"
			h="5"
			ml="-0.5"
			borderRadius="sm"
			overflow="hidden"
			flexShrink={0}
			bg="bg.muted"
			color="fg.muted"
			display="grid"
			placeItems="center"
			fontSize="sm"
		>
			{shouldShowImage ? (
				<Image
					src={avatarUrl}
					alt={projectName}
					boxSize="full"
					objectFit="cover"
					onError={() => setImageFailed(true)}
				/>
			) : (
				<Text fontSize="2xs" fontWeight="medium" lineHeight="1">
					{fallbackText}
				</Text>
			)}
		</Box>
	);
}
