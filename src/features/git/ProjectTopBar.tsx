import { Box, Flex, HStack, Text } from "@chakra-ui/react";
import { Fragment, Suspense } from "react";
import { RiGitBranchLine } from "react-icons/ri";
import { useGitBranch } from "@/features/projects/hooks";
import { controlRegistry } from "@/features/topbar/registry";
import { useTopBarStore } from "@/features/topbar/store";
import type { Profile } from "@/generated";
import { useDialogState } from "@/shared/hooks/useDialogState";
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
	const diffDialog = useDialogState();
	const activeControls = useTopBarStore((s) => s.activeControls);
	const controlOptions = useTopBarStore((s) => s.controlOptions);

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
			<HStack gap="2">
				{activeControls.map((controlId) => {
					const def = controlRegistry.get(controlId);
					if (!def) return null;
					const mergedOptions: Record<string, unknown> = {
						...controlOptions[controlId],
						...(controlId === "git-diff"
							? { __onOpenDiff: diffDialog.onOpen }
							: {}),
					};
					return (
						<Fragment key={controlId}>
							{def.render({ profile, options: mergedOptions })}
						</Fragment>
					);
				})}
			</HStack>
			{activeControls.includes("git-diff") &&
				(profile.is_default ? (
					<Suspense>
						<GitBranchDiffDialog
							cwd={profile.worktree_path}
							diffOpen={diffDialog.isOpen}
							onClose={diffDialog.onClose}
							profileId={profile.id}
						/>
					</Suspense>
				) : (
					<GitDiffDialog
						isOpen={diffDialog.isOpen}
						onClose={diffDialog.onClose}
						profileId={profile.id}
						branchName={profile.branch_name}
					/>
				))}
		</Flex>
	);
}
