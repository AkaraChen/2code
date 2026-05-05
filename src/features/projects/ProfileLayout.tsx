import { Box, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import FileTreePanel from "@/features/projects/FileTreePanel";
import { useFileTreeStore } from "@/features/projects/fileTreeStore";
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
	const fileTreeOpen = useFileTreeStore((s) => s.isOpen(profile.id));
	const toggleFileTree = useFileTreeStore((s) => s.toggle);
	const openFileTab = useFileViewerTabsStore((s) => s.openFile);

	return (
		<Flex direction="column" h="full">
			<Box borderBottomWidth="1px" borderColor="border">
				<ProjectTopBar
					projectId={projectId}
					projectName={projectName}
					profile={profile}
					isActive={isActive}
					isFileTreeOpen={fileTreeOpen}
					onToggleFileTree={() => toggleFileTree(profile.id)}
				/>
			</Box>
			<Flex flex="1" minH="0" minW="0">
				<FileTreePanel
					profileId={profile.id}
					rootPath={profile.worktree_path}
					isOpen={fileTreeOpen}
					onOpenFile={(filePath) => openFileTab(profile.id, filePath)}
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
