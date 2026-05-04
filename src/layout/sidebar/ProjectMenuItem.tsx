import {
	Box,
	Circle,
	HStack,
	Icon,
	IconButton,
	Menu,
	Portal,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { FiChevronDown, FiChevronRight, FiPlus, FiTerminal } from "react-icons/fi";
import { NavLink, useMatch } from "react-router";
import CreateProfileDialog from "@/features/profiles/CreateProfileDialog";
import DeleteProjectDialog from "@/features/projects/DeleteProjectDialog";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import RenameProjectDialog from "@/features/projects/RenameProjectDialog";
import { useProfileHasNotification, useTerminalStore } from "@/features/terminal/store";
import type { ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { SidebarActiveIndicator } from "@/shared/components/SidebarActiveIndicator";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { ProjectAvatar } from "./ProjectAvatar";
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

	const hasOnlyDefaultProfile = nonDefaultProfiles.length === 0;

	const profileMatch = useMatch(
		`/projects/${project.id}/profiles/:profileId`,
	);
	const activeProfileId = profileMatch?.params.profileId ?? null;
	const isDefaultActive = activeProfileId === defaultProfile?.id;

	const defaultProfileUrl = defaultProfile
		? `/projects/${project.id}/profiles/${defaultProfile.id}`
		: `/projects/${project.id}`;
	const hasDefaultNotification = useProfileHasNotification(
		defaultProfile?.id ?? "",
	);
	const markProfileRead = useTerminalStore((s) => s.markProfileRead);

	const renameDialog = useDialogState();
	const deleteDialog = useDialogState();
	const settingsDialog = useDialogState();
	const createProfileDialog = useDialogState();
	const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
	const expanded = userExpanded ?? true;

	return (
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<HStack
						className="group"
						gap="1"
						w="full"
						minW="max-content"
						px="4"
						py="1.5"
						cursor="pointer"
						fontWeight="medium"
						position="relative"
						bg={
							hasOnlyDefaultProfile && isDefaultActive
								? "bg.subtle"
								: "transparent"
						}
						_hover={{ bg: "bg.subtle" }}
					>
						{hasOnlyDefaultProfile && isDefaultActive && (
							<SidebarActiveIndicator insetInlineStart="1" />
						)}
						<Box
							asChild
							flex="1"
							minW="fit-content"
							whiteSpace="nowrap"
							data-sidebar-item
						>
							<NavLink to={defaultProfileUrl}>
								<HStack gap="2" align="center">
									<ProjectAvatar
										projectId={project.id}
										projectName={project.name}
									/>
									<Text whiteSpace="nowrap" flexShrink={0}>
										{project.name}
									</Text>
								</HStack>
							</NavLink>
						</Box>

						{hasOnlyDefaultProfile ? (
							<Tooltip.Root openDelay={400} positioning={{ placement: "right" }}>
								<Tooltip.Trigger asChild>
									<IconButton
										as="span"
										variant="ghost"
										size="2xs"
										opacity="0"
										_groupHover={{ opacity: 1 }}
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											createProfileDialog.onOpen();
										}}
									>
										<FiPlus />
									</IconButton>
								</Tooltip.Trigger>
								<Portal>
									<Tooltip.Positioner>
										<Tooltip.Content>
											创建 git worktree
										</Tooltip.Content>
									</Tooltip.Positioner>
								</Portal>
							</Tooltip.Root>
						) : (
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
						)}
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

			{!hasOnlyDefaultProfile && expanded && (
				<>
					{/* Default (project root) item */}
					<HStack
						asChild
						data-sidebar-item
						gap="2"
						w="full"
						minW="max-content"
						position="relative"
						ps="9"
						pe="4"
						py="1"
						cursor="pointer"
						fontSize="sm"
						bg={isDefaultActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
					>
						<NavLink
							to={defaultProfileUrl}
							onClick={() => {
								if (defaultProfile) {
									markProfileRead(defaultProfile.id);
								}
							}}
						>
							{isDefaultActive && (
								<SidebarActiveIndicator insetInlineStart="6" />
							)}
							<Icon fontSize="xs" color="fg.muted">
								<FiTerminal />
							</Icon>
							<Text whiteSpace="nowrap" flexShrink={0}>
								{m.defaultProfile()}
							</Text>
							{hasDefaultNotification && (
								<Circle
									size="2"
									bg="green.500"
									flexShrink={0}
								/>
							)}
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
			{hasOnlyDefaultProfile && (
				<CreateProfileDialog
					isOpen={createProfileDialog.isOpen}
					onClose={createProfileDialog.onClose}
					projectId={project.id}
				/>
			)}
		</>
	);
}
