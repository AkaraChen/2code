// Phase 2.5 task #26: Squash N contiguous commits.
//
// Plan layout (oldest → newest):
//   pick     <unaffected commits older than the selection>
//   reword   <oldest selected> ← combined message lands here
//   fixup    <middle selected>
//   fixup    <... up to last selected>
//   pick     <newer descendants>
//
// Combined message is pre-filled with the newest selected subject as the
// summary plus each squashed message as a bullet. The user can edit freely.

import {
	Box,
	Checkbox,
	Field,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import RewriteDialogShell from "./RewriteDialogShell";
import {
	rewriteForcePushRequired,
	rewriteGitCommits,
	type RewritePlan,
} from "./changesTabBindings";
import type { GitCommit } from "@/generated";

interface SquashDialogProps {
	profileId: string;
	commits: GitCommit[]; // selected commits (subset of allCommits, contiguous)
	allCommits: GitCommit[]; // full log, most-recent-first
	onClose: () => void;
}

export default function SquashDialog({
	profileId,
	commits,
	allCommits,
	onClose,
}: SquashDialogProps) {
	// Sort selection oldest → newest by index in allCommits (which is
	// most-recent-first).
	const sortedOldestFirst = useMemo(() => {
		const indexOf = (c: GitCommit) =>
			allCommits.findIndex((cc) => cc.full_hash === c.full_hash);
		return [...commits].sort((a, b) => indexOf(b) - indexOf(a));
	}, [commits, allCommits]);

	const newest = sortedOldestFirst[sortedOldestFirst.length - 1];

	// Pre-fill message: newest subject + bullet list of each.
	const initialMessage = useMemo(() => {
		const subject = newest?.message ?? "squashed commit";
		const bullets = sortedOldestFirst
			.map((c) => `* ${c.message}`)
			.join("\n");
		return `${subject}\n\n${bullets}\n`;
	}, [newest, sortedOldestFirst]);

	const [message, setMessage] = useState(initialMessage);
	const [createBackup, setCreateBackup] = useState(true);
	const [forcePush, setForcePush] = useState(false);
	const [forcePushRequired, setForcePushRequired] = useState<boolean | null>(
		null,
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Build the plan covering all commits from oldest selected → HEAD.
	const plan = useMemo<RewritePlan | null>(() => {
		if (sortedOldestFirst.length < 2) return null;
		const trimmed = message.trim();
		if (!trimmed) return null;
		const oldestSelected = sortedOldestFirst[0];
		const oldestIndex = allCommits.findIndex(
			(c) => c.full_hash === oldestSelected.full_hash,
		);
		const baseIndex = oldestIndex + 1;
		const base =
			baseIndex >= allCommits.length
				? "--root"
				: allCommits[baseIndex].full_hash;

		const actions: RewritePlan["actions"] = [];
		// Walk oldest → newest (allCommits is newest-first, iterate backwards).
		for (let i = oldestIndex; i >= 0; i--) {
			const c = allCommits[i];
			const isSelected = sortedOldestFirst.some(
				(s) => s.full_hash === c.full_hash,
			);
			if (!isSelected) {
				actions.push([c.full_hash, { type: "keep" }]);
				continue;
			}
			// First selected = the squash target (Reword to combined message).
			// Rest = Fixup (drops their message).
			if (c.full_hash === oldestSelected.full_hash) {
				actions.push([
					c.full_hash,
					{ type: "reword", message: trimmed },
				]);
			} else {
				actions.push([c.full_hash, { type: "fixup" }]);
			}
		}
		return {
			base,
			actions,
			create_backup_branch: createBackup,
		};
	}, [sortedOldestFirst, allCommits, message, createBackup]);

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

	const handleSubmit = async () => {
		if (!plan) return;
		setError(null);
		setSubmitting(true);
		try {
			await rewriteGitCommits({ profileId, plan });
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<RewriteDialogShell
			title={`Squash ${commits.length} commits`}
			onClose={onClose}
			submitting={submitting}
			submitDisabled={!plan || submitting}
			submitLabel="Squash"
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Text fontSize="xs" color="fg.muted">
					These {commits.length} commits will become 1:
				</Text>

				<Box
					p="2"
					borderRadius="md"
					bg="bg.subtle"
					fontSize="xs"
					fontFamily="mono"
					maxH="120px"
					overflow="auto"
				>
					{sortedOldestFirst.map((c, i) => (
						<Box key={c.full_hash} color="fg.muted">
							<Text as="span">{c.hash}</Text>{" "}
							<Text as="span">{c.message}</Text>
							{i === sortedOldestFirst.length - 1 && (
								<Text as="span" color="fg" ml="1">
									← target
								</Text>
							)}
						</Box>
					))}
				</Box>

				<Field.Root>
					<Field.Label>Combined message</Field.Label>
					<Textarea
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						rows={8}
						fontFamily="mono"
						fontSize="sm"
					/>
				</Field.Root>

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
									(required)
								</Text>
							)}
						</Checkbox.Label>
					</Checkbox.Root>
				</Stack>
			</Stack>
		</RewriteDialogShell>
	);
}
