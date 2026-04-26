// Phase 2.5 task #27: Bulk edit author/committer.
//
// Works for one OR many commits. Apply-to checkboxes pick author/committer/
// both; identity source can be the project's resolved identity (set via
// Phase 1 task #9 + Phase 2.5 task #21) or a one-off custom name+email.
//
// Builds a RewritePlan with a SetIdentity action for each selected commit
// + Keep for everything else from the oldest selected to HEAD.

import {
	Box,
	Checkbox,
	Field,
	Input,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import RewriteDialogShell from "./RewriteDialogShell";
import {
	rewriteForcePushRequired,
	rewriteGitCommits,
	type Identity,
	type RewritePlan,
} from "./changesTabBindings";
import { useGitIdentity } from "@/features/git/hooks";
import type { GitCommit } from "@/generated";

interface EditAuthorDialogProps {
	profileId: string;
	commits: GitCommit[]; // selection (1+ commits)
	allCommits: GitCommit[]; // full log, most-recent-first
	onClose: () => void;
}

export default function EditAuthorDialog({
	profileId,
	commits,
	allCommits,
	onClose,
}: EditAuthorDialogProps) {
	const { data: resolved } = useGitIdentity(profileId);

	const [applyAuthor, setApplyAuthor] = useState(true);
	const [applyCommitter, setApplyCommitter] = useState(true);
	const [source, setSource] = useState<"project" | "custom">("project");
	const [customName, setCustomName] = useState(resolved?.name ?? "");
	const [customEmail, setCustomEmail] = useState(resolved?.email ?? "");

	useEffect(() => {
		if (resolved) {
			setCustomName((n) => n || resolved.name);
			setCustomEmail((e) => e || resolved.email);
		}
	}, [resolved]);

	const [createBackup, setCreateBackup] = useState(true);
	const [forcePush, setForcePush] = useState(false);
	const [forcePushRequired, setForcePushRequired] = useState<boolean | null>(
		null,
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Identity to apply.
	const identity = useMemo<Identity | null>(() => {
		if (source === "project") return resolved ?? null;
		const name = customName.trim();
		const email = customEmail.trim();
		if (!name || !email) return null;
		return { name, email };
	}, [source, resolved, customName, customEmail]);

	// Compute oldest selected commit's index in allCommits.
	const oldestSelectedIndex = useMemo(() => {
		const indices = commits.map((c) =>
			allCommits.findIndex((cc) => cc.full_hash === c.full_hash),
		);
		return indices.reduce((max, i) => Math.max(max, i), -1);
	}, [commits, allCommits]);

	const descendantCount = useMemo(() => {
		// All commits NEWER than the oldest selected that are NOT in the
		// selection are "rewritten descendants" — they keep their content
		// but get new SHAs.
		if (oldestSelectedIndex < 0) return 0;
		const selectedHashes = new Set(commits.map((c) => c.full_hash));
		let n = 0;
		for (let i = 0; i < oldestSelectedIndex; i++) {
			if (!selectedHashes.has(allCommits[i].full_hash)) n++;
		}
		return n;
	}, [commits, allCommits, oldestSelectedIndex]);

	const plan = useMemo<RewritePlan | null>(() => {
		if (!identity || (!applyAuthor && !applyCommitter)) return null;
		if (oldestSelectedIndex < 0) return null;
		const baseIndex = oldestSelectedIndex + 1;
		const base =
			baseIndex >= allCommits.length
				? "--root"
				: allCommits[baseIndex].full_hash;
		const selectedHashes = new Set(commits.map((c) => c.full_hash));
		const actions: RewritePlan["actions"] = [];
		for (let i = oldestSelectedIndex; i >= 0; i--) {
			const c = allCommits[i];
			if (selectedHashes.has(c.full_hash)) {
				actions.push([
					c.full_hash,
					{
						type: "set_identity",
						author: applyAuthor ? identity : null,
						committer: applyCommitter ? identity : null,
					},
				]);
			} else {
				actions.push([c.full_hash, { type: "keep" }]);
			}
		}
		return {
			base,
			actions,
			create_backup_branch: createBackup,
		};
	}, [
		identity,
		applyAuthor,
		applyCommitter,
		oldestSelectedIndex,
		allCommits,
		commits,
		createBackup,
	]);

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
			title={`Edit identity on ${commits.length} commit${commits.length === 1 ? "" : "s"}`}
			onClose={onClose}
			submitting={submitting}
			submitDisabled={!plan || submitting}
			submitLabel="Rewrite"
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Box
					p="2"
					borderRadius="md"
					bg="bg.subtle"
					fontSize="xs"
					fontFamily="mono"
					maxH="100px"
					overflow="auto"
				>
					{commits.map((c) => (
						<Box key={c.full_hash} color="fg.muted">
							<Text as="span">{c.hash}</Text>{" "}
							<Text as="span">{c.message}</Text>
						</Box>
					))}
				</Box>

				<Stack gap="1">
					<Text fontSize="xs" fontWeight="medium">
						Apply to:
					</Text>
					<Checkbox.Root
						checked={applyAuthor}
						onCheckedChange={(e) => setApplyAuthor(e.checked === true)}
						size="sm"
					>
						<Checkbox.HiddenInput />
						<Checkbox.Control>
							<Checkbox.Indicator />
						</Checkbox.Control>
						<Checkbox.Label>Author</Checkbox.Label>
					</Checkbox.Root>
					<Checkbox.Root
						checked={applyCommitter}
						onCheckedChange={(e) =>
							setApplyCommitter(e.checked === true)
						}
						size="sm"
					>
						<Checkbox.HiddenInput />
						<Checkbox.Control>
							<Checkbox.Indicator />
						</Checkbox.Control>
						<Checkbox.Label>Committer</Checkbox.Label>
					</Checkbox.Root>
				</Stack>

				<Stack gap="1">
					<Text fontSize="xs" fontWeight="medium">
						New identity:
					</Text>
					<label
						style={{
							display: "flex",
							alignItems: "center",
							gap: "8px",
							cursor: "pointer",
						}}
					>
						<input
							type="radio"
							checked={source === "project"}
							onChange={() => setSource("project")}
						/>
						<Text fontSize="sm">
							Use project identity{" "}
							{resolved && (
								<Text as="span" color="fg.muted">
									({resolved.name} &lt;{resolved.email}&gt;)
								</Text>
							)}
						</Text>
					</label>
					<label
						style={{
							display: "flex",
							alignItems: "center",
							gap: "8px",
							cursor: "pointer",
						}}
					>
						<input
							type="radio"
							checked={source === "custom"}
							onChange={() => setSource("custom")}
						/>
						<Text fontSize="sm">Custom</Text>
					</label>

					{source === "custom" && (
						<Stack gap="2" pl="6">
							<Field.Root>
								<Field.Label>Name</Field.Label>
								<Input
									value={customName}
									onChange={(e) => setCustomName(e.target.value)}
								/>
							</Field.Root>
							<Field.Root>
								<Field.Label>Email</Field.Label>
								<Input
									type="email"
									value={customEmail}
									onChange={(e) => setCustomEmail(e.target.value)}
								/>
							</Field.Root>
						</Stack>
					)}
				</Stack>

				{descendantCount > 0 && (
					<Text fontSize="xs" color="orange.fg">
						⚠ Rewrites {commits.length} selected + {descendantCount}{" "}
						descendant{descendantCount === 1 ? "" : "s"}
					</Text>
				)}

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
