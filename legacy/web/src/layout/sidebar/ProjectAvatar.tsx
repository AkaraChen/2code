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
	const showProjectAvatars = useSidebarSettingsStore(
		(state) => state.showProjectAvatars,
	);
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
		<span className="grid size-4 shrink-0 place-items-center overflow-hidden rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
			{shouldShowImage ? (
				<img
					src={avatarUrl}
					alt={projectName}
					className="size-full object-cover"
					onError={() => setImageFailed(true)}
				/>
			) : (
				<span className="text-[0.625rem] leading-none font-medium">
					{fallbackText}
				</span>
			)}
		</span>
	);
}
