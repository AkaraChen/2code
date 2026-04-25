// Per-profile git identity indicator + override.
//
// Shows the resolved identity (resolve_git_identity walks profile → project
// → global) as a small inline label. Click opens a popover with three
// options:
//   1. Use project identity — write to the project's .git/config (covers
//      all worktrees that don't override)
//   2. Use this profile's identity — write to the worktree's .git/config
//   3. Clear override — git config --unset on this profile or project
//
// All three call backend commands from Phase 1 task #9. The actual commit
// command (commit_git_changes) reads identity via git config at commit time,
// so changing it here propagates immediately to the next commit.

import {
	Button,
	HStack,
	Menu,
	Portal,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { FiUser } from "react-icons/fi";

import {
	useGitIdentity,
	useSetGitIdentity,
	useUnsetGitIdentity,
} from "@/features/git/hooks";
import type { IdentityScope } from "@/features/git/changesTabBindings";

interface IdentityDropdownProps {
	profileId: string;
}

export default function IdentityDropdown({ profileId }: IdentityDropdownProps) {
	const { data: identity } = useGitIdentity(profileId);
	const setIdentity = useSetGitIdentity(profileId);
	const unsetIdentity = useUnsetGitIdentity(profileId);

	const [editorOpen, setEditorOpen] = useState<IdentityScope | null>(null);

	const label = identity ? identity.name : "no identity";

	return (
		<>
			<Menu.Root>
				<Menu.Trigger asChild>
					<HStack
						as="button"
						gap="1"
						px="1.5"
						py="0.5"
						borderRadius="sm"
						_hover={{ bg: "bg.muted" }}
						cursor="pointer"
					>
						<FiUser />
						<Text fontSize="xs" color="fg.muted" maxW="32" truncate>
							{label}
						</Text>
					</HStack>
				</Menu.Trigger>
				<Portal>
					<Menu.Positioner>
						<Menu.Content minW="48">
							{identity && (
								<>
									<Menu.Item value="current" disabled>
										<Stack gap="0">
											<Text fontSize="sm">{identity.name}</Text>
											<Text fontSize="xs" color="fg.muted">
												{identity.email}
											</Text>
										</Stack>
									</Menu.Item>
									<Menu.Separator />
								</>
							)}
							<Menu.Item
								value="set-project"
								onClick={() => setEditorOpen("project")}
							>
								Set project identity…
							</Menu.Item>
							<Menu.Item
								value="set-profile"
								onClick={() => setEditorOpen("profile")}
							>
								Set profile (worktree) identity…
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item
								value="clear-profile"
								onClick={() => unsetIdentity.mutate({ scope: "profile" })}
							>
								Clear profile override
							</Menu.Item>
							<Menu.Item
								value="clear-project"
								onClick={() => unsetIdentity.mutate({ scope: "project" })}
							>
								Clear project override
							</Menu.Item>
						</Menu.Content>
					</Menu.Positioner>
				</Portal>
			</Menu.Root>

			{editorOpen && (
				<IdentityEditor
					profileId={profileId}
					scope={editorOpen}
					initial={identity ?? { name: "", email: "" }}
					onClose={() => setEditorOpen(null)}
					onSave={(identity) => {
						setIdentity.mutate(
							{ identity, scope: editorOpen },
							{ onSuccess: () => setEditorOpen(null) },
						);
					}}
					saving={setIdentity.isPending}
				/>
			)}
		</>
	);
}

function IdentityEditor({
	scope,
	initial,
	onClose,
	onSave,
	saving,
}: {
	profileId: string;
	scope: IdentityScope;
	initial: { name: string; email: string };
	onClose: () => void;
	onSave: (identity: { name: string; email: string }) => void;
	saving: boolean;
}) {
	const [name, setName] = useState(initial.name);
	const [email, setEmail] = useState(initial.email);

	const valid = name.trim().length > 0 && email.trim().length > 0;

	return (
		<Portal>
			<div
				style={{
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,0.4)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 1000,
				}}
				onClick={onClose}
			>
				<div
					onClick={(e) => e.stopPropagation()}
					style={{
						background: "var(--chakra-colors-bg)",
						borderRadius: "8px",
						padding: "16px",
						minWidth: "320px",
						boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
					}}
				>
					<Stack gap="3">
						<Text fontWeight="semibold">
							Set{" "}
							{scope === "project" ? "project" : "profile (worktree)"}{" "}
							identity
						</Text>
						<Stack gap="1">
							<Text fontSize="xs" color="fg.muted">
								Name
							</Text>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								style={{
									padding: "6px 8px",
									border:
										"1px solid var(--chakra-colors-border-subtle)",
									borderRadius: "4px",
									fontSize: "14px",
								}}
								placeholder="Jane Doe"
							/>
						</Stack>
						<Stack gap="1">
							<Text fontSize="xs" color="fg.muted">
								Email
							</Text>
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								style={{
									padding: "6px 8px",
									border:
										"1px solid var(--chakra-colors-border-subtle)",
									borderRadius: "4px",
									fontSize: "14px",
								}}
								placeholder="jane@example.com"
							/>
						</Stack>
						<HStack gap="2" justify="flex-end" pt="2">
							<Button
								size="sm"
								variant="ghost"
								onClick={onClose}
								disabled={saving}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								disabled={!valid || saving}
								loading={saving}
								onClick={() =>
									onSave({ name: name.trim(), email: email.trim() })
								}
							>
								Save
							</Button>
						</HStack>
					</Stack>
				</div>
			</div>
		</Portal>
	);
}
