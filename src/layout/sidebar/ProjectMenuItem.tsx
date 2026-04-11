import {
	Box,
	HStack,
	Icon,
	IconButton,
	Menu,
	Portal,
	Text,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { FiChevronDown, FiChevronRight, FiTerminal } from "react-icons/fi";
import { NavLink, useMatch } from "react-router";
import DeleteProjectDialog from "@/features/projects/DeleteProjectDialog";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import RenameProjectDialog from "@/features/projects/RenameProjectDialog";
import type { ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { ProfileList } from "./ProfileList";

export function ProjectMenuItem({ project }: { project: ProjectWithProfiles }) {
	const defaultProfile = useMemo(
		() => project.profiles.find((p) => p.is_default),
		[project.profiles],
	);
	const nonDefaultProfiles = useMemo(
		() => project.profiles.filter((p) => !p.is_default),
		[project.profiles],
	);

	const profileMatch = useMatch(
		`/projects/${project.id}/profiles/:profileId`,
	);
	const activeProfileId = profileMatch?.params.profileId ?? null;
	const isDefaultActive = activeProfileId === defaultProfile?.id;

	const defaultProfileUrl = defaultProfile
		? `/projects/${project.id}/profiles/${defaultProfile.id}`
		: `/projects/${project.id}`;

	const renameDialog = useDialogState();
	const deleteDialog = useDialogState();
	const settingsDialog = useDialogState();
	const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
	const expanded = userExpanded ?? true;

	return (
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<HStack
						gap="1"
						px="4"
						py="1.5"
						cursor="pointer"
						fontWeight="medium"
						_hover={{ bg: "bg.subtle" }}
					>
						<Box asChild truncate flex="1" data-sidebar-item>
							<NavLink to={defaultProfileUrl}>
								{project.name}
							</NavLink>
						</Box>
						<IconButton
							as="span"
							variant="ghost"
							size="2xs"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setUserExpanded((prev) =>
									prev === null ? !expanded : !prev,
								);
							}}
						>
							{expanded ? (
								<FiChevronDown />
							) : (
								<FiChevronRight />
							)}
						</IconButton>
					</HStack>
				</Menu.ContextTrigger>
				<Portal>
					<Menu.Positioner>
						<Menu.Content>
							<Menu.Item
								value="settings"
								onClick={settingsDialog.onOpen}
							>
								{m.projectSettings()}
							</Menu.Item>
							<Menu.Item
								value="rename"
								onClick={renameDialog.onOpen}
							>
								{m.renameProject()}
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item
								value="delete"
								color="fg.error"
								_hover={{ bg: "bg.error", color: "fg.error" }}
								onClick={deleteDialog.onOpen}
							>
								{m.deleteProject()}
							</Menu.Item>
						</Menu.Content>
					</Menu.Positioner>
				</Portal>
			</Menu.Root>

			{expanded && (
				<>
					{/* Default (project root) item */}
					<HStack
						asChild
						data-sidebar-item
						gap="2"
						position="relative"
						ps="9"
						pe="4"
						py="1"
						cursor="pointer"
						fontSize="sm"
						bg={isDefaultActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
						_before={
							isDefaultActive
								? {
										content: '""',
										position: "absolute",
										insetInlineStart: "6",
										insetBlock: "1.5",
										width: "2px",
										borderRadius: "full",
										bg: "colorPalette.solid",
									}
								: undefined
						}
					>
						<NavLink to={defaultProfileUrl}>
							<Icon fontSize="xs" color="fg.muted">
								<FiTerminal />
							</Icon>
							<Text truncate>{m.defaultProfile()}</Text>
						</NavLink>
					</HStack>

					<ProfileList
						profiles={nonDefaultProfiles}
						projectId={project.id}
						activeProfileId={activeProfileId}
					/>
				</>
			)}

			<RenameProjectDialog
				isOpen={renameDialog.isOpen}
				onClose={renameDialog.onClose}
				projectId={project.id}
				initName={project.name}
			/>
			<DeleteProjectDialog
				isOpen={deleteDialog.isOpen}
				onClose={deleteDialog.onClose}
				project={project}
			/>
			<ProjectSettingsDialog
				isOpen={settingsDialog.isOpen}
				onClose={settingsDialog.onClose}
				projectId={project.id}
			/>
		</>
	);
}
