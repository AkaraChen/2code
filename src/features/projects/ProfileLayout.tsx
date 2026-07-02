import { useCallback, type ReactNode, useState } from "react";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import CommandPalette from "@/features/projects/CommandPalette";
import FileTreePanel from "@/features/projects/FileTreePanel";
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
	const openFileTab = useFileViewerTabsStore((s) => s.openFile);
	const handleToggleFileTree = useCallback(() => {
		setFileTreeOpen((isOpen) => !isOpen);
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
				/>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1">
				<FileTreePanel
					key={profile.id}
					profileId={profile.id}
					rootPath={profile.worktree_path}
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
