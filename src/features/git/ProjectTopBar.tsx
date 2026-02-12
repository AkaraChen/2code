import { Box, Flex, HStack, IconButton, Text } from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { RiGitBranchLine, RiGitPullRequestLine } from "react-icons/ri";
import { useGitBranch } from "@/features/projects/hooks";
import type { Profile } from "@/generated";
import GitDiffDialog from "./GitDiffDialog";

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
	profileId,
}: {
	cwd: string;
	diffOpen: boolean;
	onClose: () => void;
	profileId: string;
}) {
	const { data: branch } = useGitBranch(cwd);
	return (
		<GitDiffDialog
			isOpen={diffOpen}
			onClose={onClose}
			profileId={profileId}
			branchName={branch ?? undefined}
		/>
	);
}

interface ProjectTopBarProps {
	projectName: string;
	profile: Profile;
}

export default function ProjectTopBar({
	projectName,
	profile,
}: ProjectTopBarProps) {
	const [diffOpen, setDiffOpen] = useState(false);

	const handleDiffClick = () => {
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
					{profile.is_default ? (
						<Suspense>
							<GitBranchLabel cwd={profile.worktree_path} />
						</Suspense>
					) : (
						<HStack gap="1">
							<RiGitBranchLine />
							<Text as="span">{profile.branch_name}</Text>
						</HStack>
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
			{profile.is_default ? (
				<Suspense>
					<GitBranchDiffDialog
						cwd={profile.worktree_path}
						diffOpen={diffOpen}
						onClose={() => setDiffOpen(false)}
						profileId={profile.id}
					/>
				</Suspense>
			) : (
				<GitDiffDialog
					isOpen={diffOpen}
					onClose={() => setDiffOpen(false)}
					profileId={profile.id}
					branchName={profile.branch_name}
				/>
			)}
		</Flex>
	);
}
