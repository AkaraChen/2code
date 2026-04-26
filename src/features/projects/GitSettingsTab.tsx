// Phase 2.5 task #21: Git tab in Project Settings dialog.
//
// Per-project identity is the marquee feature — the user can stop polluting
// personal commits with work email and vice versa. The backend command
// set_git_identity(profile_id, identity, scope) already resolves the right
// folder per scope, so we just need any profile ID to make the call (the
// scope tells the backend whether to write the project's .git/config or a
// worktree's). We use the default profile.
//
// The "apply to profile worktrees" toggle is a UX hint about scope. When ON
// (default), we set scope=project so all worktrees inherit; when OFF, we set
// scope=profile to override only the default worktree (other profiles keep
// their own).

import {
	Button,
	Field,
	HStack,
	Input,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";

import {
	useGitIdentity,
	useSetGitIdentity,
	useUnsetGitIdentity,
} from "@/features/git/hooks";
import { useProjectProfiles } from "@/features/projects/hooks";

interface GitSettingsTabProps {
	projectId: string;
}

export default function GitSettingsTab({ projectId }: GitSettingsTabProps) {
	const profiles = useProjectProfiles(projectId);
	const defaultProfile = profiles.find((p) => p.is_default) ?? profiles[0];
	const profileId = defaultProfile?.id ?? "";

	if (!profileId) {
		return (
			<Text fontSize="sm" color="fg.muted">
				No profiles for this project yet.
			</Text>
		);
	}

	return <GitSettingsForm projectId={projectId} profileId={profileId} />;
}

function GitSettingsForm({
	projectId: _projectId,
	profileId,
}: {
	projectId: string;
	profileId: string;
}) {
	const { data: resolved, isLoading } = useGitIdentity(profileId);
	const setIdentity = useSetGitIdentity(profileId);
	const unsetIdentity = useUnsetGitIdentity(profileId);

	// Three modes: inherit (no override), override-project, override-profile.
	const [mode, setMode] = useState<
		"inherit" | "project" | "profile"
	>("inherit");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");

	// Pre-fill from the resolved identity once it loads.
	useEffect(() => {
		if (!resolved) return;
		setName(resolved.name);
		setEmail(resolved.email);
	}, [resolved]);

	const handleSave = async () => {
		if (mode === "inherit") {
			// Clear both project and profile overrides — fall back to global.
			await Promise.all([
				unsetIdentity.mutateAsync({ scope: "project" }).catch(() => {}),
				unsetIdentity.mutateAsync({ scope: "profile" }).catch(() => {}),
			]);
			return;
		}
		await setIdentity.mutateAsync({
			identity: { name: name.trim(), email: email.trim() },
			scope: mode,
		});
	};

	const valid =
		mode === "inherit" || (name.trim().length > 0 && email.trim().length > 0);

	return (
		<Stack gap="3">
			<Stack gap="1">
				<Text fontSize="sm" fontWeight="medium">
					Git identity
				</Text>
				<Text fontSize="xs" color="fg.muted">
					Used as the author/committer for commits made through 2code.
					Resolution: profile worktree → project → ~/.gitconfig.
				</Text>
			</Stack>

			{!isLoading && resolved && (
				<Text fontSize="xs" color="fg.muted">
					Currently resolved: {resolved.name} &lt;{resolved.email}&gt;
				</Text>
			)}

			<Stack gap="2">
				<RadioOption
					label="Use global git config (~/.gitconfig)"
					checked={mode === "inherit"}
					onChange={() => setMode("inherit")}
				/>
				<RadioOption
					label="Override for this project (all worktrees inherit)"
					checked={mode === "project"}
					onChange={() => setMode("project")}
				/>
				<RadioOption
					label="Override for the default worktree only"
					checked={mode === "profile"}
					onChange={() => setMode("profile")}
				/>
			</Stack>

			{mode !== "inherit" && (
				<Stack gap="2">
					<Field.Root>
						<Field.Label>Name</Field.Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Jane Doe"
						/>
					</Field.Root>
					<Field.Root>
						<Field.Label>Email</Field.Label>
						<Input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="jane@example.com"
						/>
					</Field.Root>
				</Stack>
			)}

			<HStack justify="flex-end">
				<Button
					size="sm"
					disabled={!valid || setIdentity.isPending}
					loading={setIdentity.isPending || unsetIdentity.isPending}
					onClick={handleSave}
				>
					Apply
				</Button>
			</HStack>

			<Stack gap="1" pt="3" borderTopWidth="1px" borderColor="border.subtle">
				<Text fontSize="xs" color="fg.muted">
					Writes to the local <code>.git/config</code>; your global{" "}
					<code>~/.gitconfig</code> is never touched.
				</Text>
			</Stack>
		</Stack>
	);
}

function RadioOption({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
			<input type="radio" checked={checked} onChange={onChange} />
			<Text fontSize="sm">{label}</Text>
		</label>
	);
}
