import { Box, Flex, HStack, IconButton, Text } from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { RiGitBranchLine, RiGitPullRequestLine } from "react-icons/ri";
import { projectsApi } from "@/api/projects";
import { useGitBranch } from "@/hooks/useProjects";
import GitDiffDialog from "./GitDiffDialog";
import { toaster } from "./Toaster";

function GitBranchLabel({ cwd }: { cwd: string }) {
	const { data: branch } = useGitBranch(cwd);
	if (!branch) return null;
	return (
		<HStack gap="1">
			<RiGitBranchLine />
			<Text as="span">{branch}</Text>
		</HStack>
	);
}

function GitBranchDiffDialog({
	cwd,
	diffOpen,
	onClose,
	contextId,
}: {
	cwd: string;
	diffOpen: boolean;
	onClose: () => void;
	contextId: string;
}) {
	const { data: branch } = useGitBranch(cwd);
	return (
		<GitDiffDialog
			isOpen={diffOpen}
			onClose={onClose}
			contextId={contextId}
			branchName={branch ?? undefined}
		/>
	);
}

interface ProjectTopBarProps {
	projectName: string;
	profileBranchName?: string;
	cwd: string;
	contextId: string;
}

export default function ProjectTopBar({
	projectName,
	profileBranchName,
	cwd,
	contextId,
}: ProjectTopBarProps) {
	const [diffOpen, setDiffOpen] = useState(false);

	const handleDiffClick = async () => {
		const diff = await projectsApi.getDiff(contextId);
		if (!diff.trim()) {
			toaster.create({
				description: "No changes",
				type: "info",
			});
			return;
		}
		setDiffOpen(true);
	};

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
							<GitBranchLabel cwd={cwd} />
						</Suspense>
					)}
				</Box>
			</HStack>
			<IconButton
				aria-label="Git diff"
				size="2xs"
				variant="outline"
				onClick={handleDiffClick}
			>
				<RiGitPullRequestLine />
			</IconButton>
			{profileBranchName ? (
				<GitDiffDialog
					isOpen={diffOpen}
					onClose={() => setDiffOpen(false)}
					contextId={contextId}
					branchName={profileBranchName}
				/>
			) : (
				<Suspense>
					<GitBranchDiffDialog
						cwd={cwd}
						diffOpen={diffOpen}
						onClose={() => setDiffOpen(false)}
						contextId={contextId}
					/>
				</Suspense>
			)}
		</Flex>
	);
}
