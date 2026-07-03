import { useCallback, type ReactNode, useState } from "react";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import CommandPalette from "@/features/projects/CommandPalette";
import ProfileSidebar from "@/features/projects/ProfileSidebar";
import type { ProfileSidebarMode } from "@/features/projects/SidebarModeSwitch";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import type { Profile } from "@/generated";

interface ProfileLayoutProps {
	projectId: string;
	projectName: string;
	profile: Profile;
	isActive: boolean;
	children: ReactNode;
}

export default function ProfileLayout({
	projectId,
	projectName,
	profile,
	isActive,
	children,
}: ProfileLayoutProps) {
	const [fileTreeOpen, setFileTreeOpen] = useState(true);
	const [sidebarMode, setSidebarMode] = useState<ProfileSidebarMode>("files");
	const openFileTab = useFileViewerTabsStore((s) => s.openFile);
	const handleToggleFileTree = useCallback(() => {
		setFileTreeOpen((isOpen) => !isOpen);
	}, []);
	const handleSidebarModeChange = useCallback((mode: ProfileSidebarMode) => {
		setSidebarMode(mode);
		// Picking a mode while the sidebar is closed should reveal it.
		setFileTreeOpen(true);
	}, []);
	const handleOpenFile = useCallback(
		(filePath: string) => {
			openFileTab(profile.id, filePath);
		},
		[openFileTab, profile.id],
	);

	return (
		<div className="flex h-full flex-col">
			<CommandPalette profileId={profile.id} isActive={isActive} />
			<div className="border-b">
				<ProjectTopBar
					projectId={projectId}
					projectName={projectName}
					profile={profile}
					isActive={isActive}
					isFileTreeOpen={fileTreeOpen}
					onToggleFileTree={handleToggleFileTree}
					sidebarMode={sidebarMode}
					onSidebarModeChange={handleSidebarModeChange}
				/>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1">
				<ProfileSidebar
					key={profile.id}
					profile={profile}
					mode={sidebarMode}
					isOpen={fileTreeOpen}
					isActive={isActive}
					onOpenFile={handleOpenFile}
				/>
				<div className="min-h-0 min-w-0 flex-1">
					{children}
				</div>
			</div>
		</div>
	);
}
