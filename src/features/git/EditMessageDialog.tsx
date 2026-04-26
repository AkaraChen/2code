// Phase 2.5 task #25: Edit commit message dialog.
//
// Two paths:
// 1. Target IS HEAD → call amendHeadCommitMessage (fast, no rebase)
// 2. Target is older → build a one-Reword RewritePlan and call rewriteGitCommits
//
// The dialog shows: subject + body editor pre-filled from the commit, the
// number of descendants that will be rewritten, a backup branch checkbox
// (default ON), and a force-push checkbox enabled only when the pre-flight
// detects the rewrite touches commits already on the upstream.

import {
	Checkbox,
	Field,
	Input,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import {
	amendHeadCommitMessage,
	rewriteGitCommits,
	rewriteForcePushRequired,
	type RewritePlan,
} from "./changesTabBindings";
import RewriteDialogShell from "./RewriteDialogShell";
import type { GitCommit } from "@/generated";

interface EditMessageDialogProps {
	profileId: string;
	commit: GitCommit;
	commits: GitCommit[];
	onClose: () => void;
}

export default function EditMessageDialog({
	profileId,
	commit,
	commits,
	onClose,
}: EditMessageDialogProps) {
	// Split the existing message into subject + body. The backend's git log
	// returns only the subject; for the body we'd need a separate fetch.
	// For v1, treat the existing body as empty and let the user retype if
	// they want to change it. (Future: fetch full message via a new command.)
	const [subject, setSubject] = useState(commit.message);
	const [body, setBody] = useState("");
	const [createBackup, setCreateBackup] = useState(true);
	const [forcePush, setForcePush] = useState(false);
	const [forcePushRequired, setForcePushRequired] = useState<boolean | null>(
		null,
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const headHash = commits[0]?.full_hash;
	const isHead = commit.full_hash === headHash;
	const commitIndex = commits.findIndex(
		(c) => c.full_hash === commit.full_hash,
	);
	// Descendants are commits NEWER than this one (lower index in the
	// most-recent-first list).
	const descendantCount = Math.max(0, commitIndex);

	// Build the would-be plan for pre-flight check.
	const plan = useMemo<RewritePlan | null>(() => {
		if (isHead) return null;
		const nextSubject = subject.trim();
		if (!nextSubject) return null;
		const message = body.trim()
			? `${nextSubject}\n\n${body.trim()}`
			: nextSubject;
		// Base = parent of the target commit. We want to rebase
		// commits[commitIndex..0] (oldest → newest).
		const baseIndex = commitIndex + 1;
		const base =
			baseIndex >= commits.length
				? "--root"
				: commits[baseIndex].full_hash;
		// Walk from target → HEAD (oldest → newest). The list is
		// most-recent-first, so iterate backwards.
		const actions: RewritePlan["actions"] = [];
		for (let i = commitIndex; i >= 0; i--) {
			const c = commits[i];
			actions.push([
				c.full_hash,
				i === commitIndex
					? { type: "reword", message }
					: { type: "keep" },
			]);
		}
		return {
			base,
			actions,
			create_backup_branch: createBackup,
		};
	}, [isHead, subject, body, commitIndex, commits, createBackup]);

	// Pre-flight push check. Re-runs when the plan changes.
	useEffect(() => {
		if (!plan) {
			setForcePushRequired(false);
			return;
		}
		let cancelled = false;
		rewriteForcePushRequired({ profileId, plan })
			.then((needs) => {
				if (!cancelled) setForcePushRequired(needs);
			})
			.catch(() => {
				if (!cancelled) setForcePushRequired(false);
			});
		return () => {
			cancelled = true;
		};
	}, [profileId, plan]);

	const canSubmit =
		subject.trim().length > 0 && !submitting && (isHead || plan !== null);

	const handleSubmit = async () => {
		setError(null);
		setSubmitting(true);
		try {
			const trimmed = subject.trim();
			const fullMessage = body.trim()
				? `${trimmed}\n\n${body.trim()}`
				: trimmed;
			if (isHead) {
				await amendHeadCommitMessage({
					profileId,
					message: fullMessage,
				});
			} else if (plan) {
				await rewriteGitCommits({ profileId, plan });
			}
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<RewriteDialogShell
			title="Edit commit message"
			onClose={onClose}
			submitting={submitting}
			submitLabel={isHead ? "Amend" : "Rewrite"}
			submitDisabled={!canSubmit}
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Text fontSize="xs" color="fg.muted">
					{commit.hash} · originally by {commit.author.name}
				</Text>

				<Field.Root>
					<Field.Label>Subject</Field.Label>
					<Input
						value={subject}
						onChange={(e) => setSubject(e.target.value)}
						placeholder="commit subject"
					/>
				</Field.Root>

				<Field.Root>
					<Field.Label>Body (optional)</Field.Label>
					<Textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						rows={5}
						placeholder="Body lines (leave blank to drop body)"
					/>
				</Field.Root>

				{!isHead && descendantCount > 0 && (
					<Text fontSize="xs" color="orange.fg">
						⚠ Rewrites this commit + {descendantCount} descendant
						{descendantCount === 1 ? "" : "s"}
					</Text>
				)}

				{!isHead && (
					<Stack gap="1">
						<Checkbox.Root
							checked={createBackup}
							onCheckedChange={(e) =>
								setCreateBackup(e.checked === true)
							}
							size="sm"
						>
							<Checkbox.HiddenInput />
							<Checkbox.Control>
								<Checkbox.Indicator />
							</Checkbox.Control>
							<Checkbox.Label>
								Create backup branch first
							</Checkbox.Label>
						</Checkbox.Root>

						<Checkbox.Root
							checked={forcePush}
							disabled={forcePushRequired === false}
							onCheckedChange={(e) =>
								setForcePush(e.checked === true)
							}
							size="sm"
						>
							<Checkbox.HiddenInput />
							<Checkbox.Control>
								<Checkbox.Indicator />
							</Checkbox.Control>
							<Checkbox.Label>
								Force push afterward
								{forcePushRequired === true && (
									<Text as="span" color="orange.fg" ml="1">
										(required — these commits are on the remote)
									</Text>
								)}
							</Checkbox.Label>
						</Checkbox.Root>
					</Stack>
				)}
			</Stack>
		</RewriteDialogShell>
	);
}
