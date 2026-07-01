import { Box, Flex } from "@chakra-ui/react";
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
		<Flex direction="column" h="full">
			<CommandPalette profileId={profile.id} isActive={isActive} />
			<Box borderBottomWidth="1px" borderColor="border">
				<ProjectTopBar
					projectId={projectId}
					projectName={projectName}
					profile={profile}
					isActive={isActive}
					isFileTreeOpen={fileTreeOpen}
					onToggleFileTree={handleToggleFileTree}
				/>
			</Box>
			<Flex flex="1" minH="0" minW="0">
				<FileTreePanel
					key={profile.id}
					profileId={profile.id}
					rootPath={profile.worktree_path}
					isOpen={fileTreeOpen}
					isActive={isActive}
					onOpenFile={handleOpenFile}
				/>
				<Box
					flex="1"
					minH="0"
					minW="0"
					borderLeftWidth={fileTreeOpen ? "1px" : "0"}
					borderColor="border"
				>
					{children}
				</Box>
			</Flex>
		</Flex>
	);
}
