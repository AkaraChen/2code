// Interactive empty state for non-git project folders.
//
// Two-step flow:
//   1. Click "Initialize repository" → runs `git init` via the backend
//   2. On success, opens an "Add a remote? (optional)" sheet with name +
//      URL fields and Skip / Add Remote buttons
//
// After step 2 (whether the user adds a remote or skips), the
// useGitInitRepo mutation has already invalidated is-git-repo + index +
// log queries, so the panel naturally re-renders with the real Changes
// tab. No prop callbacks needed — the component dismisses itself by the
// gate hook flipping to true.

import {
	Box,
	Button,
	Field,
	HStack,
	Input,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { FiGitBranch, FiPlus } from "react-icons/fi";

import {
	useAddGitRemote,
	useGitInitRepo,
} from "@/features/git/hooks";

interface InitRepoFlowProps {
	profileId: string;
}

export default function InitRepoFlow({ profileId }: InitRepoFlowProps) {
	const initRepo = useGitInitRepo(profileId);
	const addRemote = useAddGitRemote(profileId);

	const [stage, setStage] = useState<"intro" | "remote">("intro");
	const [remoteName, setRemoteName] = useState("origin");
	const [remoteUrl, setRemoteUrl] = useState("");
	const [error, setError] = useState<string | null>(null);

	const handleInit = async () => {
		setError(null);
		try {
			await initRepo.mutateAsync();
			setStage("remote");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const handleAddRemote = async () => {
		setError(null);
		try {
			await addRemote.mutateAsync({
				name: remoteName.trim(),
				url: remoteUrl.trim(),
			});
			// useIsGitRepo already flipped via initRepo's onSuccess; this
			// component will unmount as the panel gate flips.
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	if (stage === "remote") {
		return (
			<EmptyStateShell icon={<FiPlus />} title="Add a remote? (optional)">
				<Text fontSize="xs" color="fg.muted" textAlign="center" mb="3">
					Connect to GitHub, GitLab, Gitea, or any other git host —
					or skip and add one later from the branches view.
				</Text>
				<Stack gap="2" width="full" maxWidth="320px">
					<Field.Root>
						<Field.Label>Remote name</Field.Label>
						<Input
							size="sm"
							value={remoteName}
							onChange={(e) => setRemoteName(e.target.value)}
							placeholder="origin"
						/>
					</Field.Root>
					<Field.Root>
						<Field.Label>URL</Field.Label>
						<Input
							size="sm"
							value={remoteUrl}
							onChange={(e) => setRemoteUrl(e.target.value)}
							placeholder="git@github.com:you/repo.git"
						/>
					</Field.Root>
				</Stack>
				{error && (
					<Text
						fontSize="xs"
						color="red.fg"
						bg="red.subtle"
						p="2"
						borderRadius="md"
						maxWidth="320px"
						wordBreak="break-word"
					>
						{error}
					</Text>
				)}
				<HStack gap="2" pt="1">
					<Button
						size="sm"
						variant="ghost"
						onClick={() => {
							// Skip: nothing to do; gate query will flip when
							// the watcher catches up. Mark "remote" stage as
							// done by going back to intro — but since
							// useIsGitRepo is now true, the panel re-renders
							// before this matters. As a defensive force, also
							// clear the form and exit gracefully.
							setStage("intro");
							setRemoteUrl("");
						}}
						disabled={addRemote.isPending}
					>
						Skip
					</Button>
					<Button
						size="sm"
						onClick={handleAddRemote}
						loading={addRemote.isPending}
						disabled={
							!remoteName.trim() ||
							!remoteUrl.trim() ||
							addRemote.isPending
						}
					>
						Add remote
					</Button>
				</HStack>
			</EmptyStateShell>
		);
	}

	return (
		<EmptyStateShell
			icon={<FiGitBranch />}
			title="Not a git repository"
		>
			<Text fontSize="xs" color="fg.muted" textAlign="center" maxWidth="280px">
				Initialize git in this folder to track changes, commit, and
				push to a remote.
			</Text>
			{error && (
				<Text
					fontSize="xs"
					color="red.fg"
					bg="red.subtle"
					p="2"
					borderRadius="md"
					maxWidth="320px"
					wordBreak="break-word"
				>
					{error}
				</Text>
			)}
			<Button
				size="sm"
				onClick={handleInit}
				loading={initRepo.isPending}
				disabled={initRepo.isPending}
			>
				Initialize repository
			</Button>
		</EmptyStateShell>
	);
}

function EmptyStateShell({
	icon,
	title,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Box
			display="flex"
			flexDirection="column"
			flex="1"
			alignItems="center"
			justifyContent="center"
			gap="3"
			p="4"
		>
			<Box
				display="flex"
				alignItems="center"
				justifyContent="center"
				width="10"
				height="10"
				borderRadius="full"
				bg="bg.muted"
				color="fg.muted"
				fontSize="lg"
			>
				{icon}
			</Box>
			<Text fontSize="sm" fontWeight="medium">
				{title}
			</Text>
			{children}
		</Box>
	);
}
