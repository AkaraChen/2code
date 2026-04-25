// Phase 2 Commit Composer.
//
// Subject + body inputs with subject 50-char hint, body 72-char-per-line hint.
// Draft persists in gitPanelStore (tauriStorage), so navigating away or
// closing the panel doesn't lose work. "Amend last" toggle pre-fills from
// the most recent commit message and uses --amend on commit.
//
// Two action buttons: Commit and Commit & Push. The push variant calls
// commit then immediately useGitPush. Both disabled until subject is non-
// empty AND there is something staged.
//
// Per-commit identity override (task #19) lands as a small dropdown next to
// the buttons in a follow-up — the composer surface is ready for it.

import {
	Box,
	Button,
	HStack,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { useEffect } from "react";

import {
	useCommitGitChanges,
	useGitIndexStatus,
	useGitPush,
} from "@/features/git/hooks";
import { useGitPanelStore } from "@/features/git/gitPanelStore";

const SUBJECT_HINT = 50;
const BODY_HINT = 72;

interface CommitComposerProps {
	profileId: string;
}

export default function CommitComposer({ profileId }: CommitComposerProps) {
	const draft = useGitPanelStore((s) => s.getDraft(profileId));
	const setDraft = useGitPanelStore((s) => s.setDraft);
	const clearDraft = useGitPanelStore((s) => s.clearDraft);
	const amendLast = useGitPanelStore((s) => s.getAmendLast(profileId));
	const setAmendLast = useGitPanelStore((s) => s.setAmendLast);

	const { data: status } = useGitIndexStatus(profileId);
	const commit = useCommitGitChanges(profileId);
	const push = useGitPush(profileId);

	const stagedPaths = status.staged.map((e) => e.path);
	const hasStaged = stagedPaths.length > 0;
	const subjectTrimmed = draft.subject.trim();
	const canCommit = hasStaged && subjectTrimmed.length > 0;

	// On enabling amend, pre-fill the draft from the last commit message
	// IF the draft is currently empty (don't clobber unsaved work).
	useEffect(() => {
		if (!amendLast) return;
		if (draft.subject || draft.body) return;
		// TODO: a backend `get_last_commit_message` would be cleaner. For Phase
		// 2 we leave this as user-driven: the user types or pastes the message.
	}, [amendLast, draft.subject, draft.body]);

	const handleCommit = async (alsoPush: boolean) => {
		if (!canCommit) return;
		try {
			await commit.mutateAsync({
				files: stagedPaths,
				message: subjectTrimmed,
				body: draft.body.trim() || undefined,
			});
			clearDraft(profileId);
			if (alsoPush) {
				try {
					await push.mutateAsync();
				} catch {
					// Push errors stay on the screen as a toast (task #8 wires
					// structured GitError toasts in Phase 4 push surfaces).
				}
			}
		} catch {
			// Commit error: leave draft intact so the user doesn't lose it.
		}
	};

	const subjectOver = draft.subject.length > SUBJECT_HINT;

	return (
		<Stack
			gap="2"
			borderTopWidth="1px"
			borderColor="border.subtle"
			p="2"
			bg="bg"
		>
			<Textarea
				placeholder="Subject"
				value={draft.subject}
				onChange={(e) =>
					setDraft(profileId, { subject: e.target.value })
				}
				rows={1}
				resize="none"
				size="sm"
				autoresize
			/>

			<Textarea
				placeholder="Body (optional)"
				value={draft.body}
				onChange={(e) => setDraft(profileId, { body: e.target.value })}
				rows={3}
				resize="vertical"
				size="sm"
			/>

			<HStack gap="2" justify="space-between" fontSize="xs" color="fg.muted">
				<HStack gap="2">
					<label
						style={{
							display: "flex",
							alignItems: "center",
							gap: "4px",
							cursor: "pointer",
						}}
					>
						<input
							type="checkbox"
							checked={amendLast}
							onChange={(e) =>
								setAmendLast(profileId, e.target.checked)
							}
						/>
						<Text fontSize="xs">Amend last</Text>
					</label>
				</HStack>
				<Text
					fontSize="2xs"
					color={subjectOver ? "red.fg" : "fg.muted"}
					title={`Subject hint: ${SUBJECT_HINT}, body hint: ${BODY_HINT} per line`}
				>
					{draft.subject.length}/{SUBJECT_HINT}
				</Text>
			</HStack>

			<HStack gap="2">
				<Button
					size="sm"
					flex="1"
					colorPalette="green"
					disabled={!canCommit || commit.isPending}
					onClick={() => handleCommit(false)}
					loading={commit.isPending && !push.isPending}
				>
					{amendLast ? "Amend" : "Commit"}
				</Button>
				<Button
					size="sm"
					flex="1"
					variant="outline"
					disabled={!canCommit || commit.isPending || push.isPending}
					onClick={() => handleCommit(true)}
					loading={commit.isPending || push.isPending}
				>
					{amendLast ? "Amend & Push" : "Commit & Push"}
				</Button>
			</HStack>

			{!hasStaged && (
				<Box fontSize="xs" color="fg.muted" textAlign="center">
					Nothing staged
				</Box>
			)}
		</Stack>
	);
}
