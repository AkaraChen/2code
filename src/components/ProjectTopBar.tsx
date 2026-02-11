import { Box, Flex, HStack, IconButton, Text } from "@chakra-ui/react";
import { Suspense } from "react";
import { RiGitBranchLine, RiGitPullRequestLine } from "react-icons/ri";
import { useGitBranch } from "@/hooks/useProjects";

function GitBranch({ cwd }: { cwd: string }) {
	const { data: branch } = useGitBranch(cwd);
	if (!branch) return null;
	return (
		<HStack gap="1">
			<RiGitBranchLine />
			<Text as="span">{branch}</Text>
		</HStack>
	);
}

interface ProjectTopBarProps {
	projectName: string;
	profileBranchName?: string;
	cwd: string;
}

export default function ProjectTopBar({
	projectName,
	profileBranchName,
	cwd,
}: ProjectTopBarProps) {
	return (
		<Flex
			data-tauri-drag-region
			align="flex-end"
			justify="space-between"
			pl="4"
			pr="5"
			pb="1.5"
			pt="3"
		>
			<HStack gap="2">
				<Text as="span" fontWeight="semibold">
					{projectName}
				</Text>
				<Box color="fg.muted">
					{profileBranchName ? (
						<HStack gap="1">
							<RiGitBranchLine />
							<Text as="span">{profileBranchName}</Text>
						</HStack>
					) : (
						<Suspense>
							<GitBranch cwd={cwd} />
						</Suspense>
					)}
				</Box>
			</HStack>
			<IconButton aria-label="Git diff" size="2xs">
				<RiGitPullRequestLine />
			</IconButton>
		</Flex>
	);
}
