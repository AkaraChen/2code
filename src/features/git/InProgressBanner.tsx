// Phase 4 task #44: sticky banner at the top of the GitPanel showing
// in-progress merge / rebase / cherry-pick / revert state with Continue
// and Abort actions + the conflict count.
//
// Polled implicitly via useGitStateSubscription (the file watcher catches
// .git/MERGE_HEAD etc. appearing/disappearing). Renders nothing when the
// repo is clean.

import {
	Box,
	Button,
	Flex,
	HStack,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { FiAlertCircle } from "react-icons/fi";

import MergeResolverPane from "./MergeResolverPane";
import { showGitErrorToast } from "./gitError";
import {
	useAbortInProgressOp,
	useContinueInProgressOp,
	useInProgressOp,
} from "@/features/git/hooks";

interface InProgressBannerProps {
	profileId: string;
}

const KIND_LABEL = {
	merge: "Merge",
	rebase: "Rebase",
	cherry_pick: "Cherry-pick",
	revert: "Revert",
} as const;

export default function InProgressBanner({ profileId }: InProgressBannerProps) {
	const { data: op } = useInProgressOp(profileId);
	const continueOp = useContinueInProgressOp(profileId);
	const abortOp = useAbortInProgressOp(profileId);
	const [resolverPath, setResolverPath] = useState<string | null>(null);
	// Two-frame mount toggle so the slide-in transition runs from the
	// initial unmounted state (translateY(-100%) + opacity 0).
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		if (!op) {
			setMounted(false);
			return;
		}
		const id = requestAnimationFrame(() => setMounted(true));
		return () => cancelAnimationFrame(id);
	}, [op]);

	if (!op) return null;

	const kindLabel = KIND_LABEL[op.kind];
	const conflictCount = op.conflicts.length;
	const canContinue = conflictCount === 0;

	const handle = async (fn: () => Promise<unknown>) => {
		try {
			await fn();
		} catch (e) {
			showGitErrorToast(e);
		}
	};

	return (
		<>
			<Box
				data-git-banner
				data-mounted={mounted ? "true" : "false"}
				borderBottomWidth="1px"
				borderColor="orange.subtle"
				bg="orange.subtle"
				flexShrink={0}
			>
				<HStack gap="2" px="3" py="2">
					<FiAlertCircle color="orange" />
					<Text fontSize="sm" fontWeight="semibold" flex="1">
						{kindLabel} in progress
						{conflictCount > 0 && (
							<Text as="span" color="fg.muted" fontWeight="normal">
								{" "}— {conflictCount} conflict
								{conflictCount === 1 ? "" : "s"}
							</Text>
						)}
					</Text>
					<Button
						size="2xs"
						variant="ghost"
						onClick={() =>
							handle(() =>
								abortOp.mutateAsync({ kind: op.kind }),
							)
						}
						disabled={abortOp.isPending}
					>
						{abortOp.isPending ? <Spinner size="xs" /> : "Abort"}
					</Button>
					<Button
						size="2xs"
						colorPalette="green"
						onClick={() =>
							handle(() =>
								continueOp.mutateAsync({ kind: op.kind }),
							)
						}
						disabled={!canContinue || continueOp.isPending}
						title={
							canContinue
								? "Continue the operation"
								: "Resolve conflicts first"
						}
					>
						{continueOp.isPending ? <Spinner size="xs" /> : "Continue"}
					</Button>
				</HStack>
				{conflictCount > 0 && (
					<Flex
						direction="column"
						gap="0"
						borderTopWidth="1px"
						borderColor="orange.muted"
					>
						{op.conflicts.map((path) => (
							<Flex
								key={path}
								data-git-conflict-row
								as="button"
								align="center"
								gap="2"
								px="3"
								py="1"
								_hover={{ bg: "orange.muted" }}
								cursor="pointer"
								onClick={() => setResolverPath(path)}
							>
								<Text fontSize="xs" fontFamily="mono" color="red.fg">
									!
								</Text>
								<Text fontSize="sm" flex="1" truncate>
									{path}
								</Text>
								<Text fontSize="2xs" color="fg.muted">
									Resolve
								</Text>
							</Flex>
						))}
					</Flex>
				)}
			</Box>

			{resolverPath && (
				<MergeResolverPane
					profileId={profileId}
					path={resolverPath}
					onClose={() => setResolverPath(null)}
				/>
			)}
		</>
	);
}
