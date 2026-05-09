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
import {
	FiChevronDown,
	FiChevronRight,
	FiPlus,
	FiTerminal,
} from "react-icons/fi";
import { NavLink, useMatch } from "react-router";
import CreateProfileDialog from "@/features/profiles/CreateProfileDialog";
import DeleteProjectDialog from "@/features/projects/DeleteProjectDialog";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import RenameProjectDialog from "@/features/projects/RenameProjectDialog";
import {
	useProfileHasNotification,
	useTerminalStore,
} from "@/features/terminal/store";
import type { ProjectGroup, ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import OverflowTooltipText from "@/shared/components/OverflowTooltipText";
import { SidebarActiveIndicator } from "@/shared/components/SidebarActiveIndicator";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { ProfileList } from "./ProfileList";
import { ProjectAvatar } from "./ProjectAvatar";
import { ProjectGroupMenu } from "./ProjectGroupMenu";

export function ProjectMenuItem({
	project,
	projectGroups,
}: {
	project: ProjectWithProfiles;
	projectGroups: ProjectGroup[];
}) {
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
	const defaultProfileLabel = m.defaultProfile();

	const renameDialog = useDialogState();
	const deleteDialog = useDialogState();
	const settingsDialog = useDialogState();
	const createProfileDialog = useDialogState();
	const [menuOpen, setMenuOpen] = useState(false);
	const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
	const expanded = userExpanded ?? true;
	const showProjectNotification =
		hasOnlyDefaultProfile && hasDefaultNotification;

	function handleDefaultProfileClick() {
		if (defaultProfile) {
			markProfileRead(defaultProfile.id);
		}
	}

	return (
		<>
			<Menu.Root
				open={menuOpen}
				onOpenChange={(e) => setMenuOpen(e.open)}
			>
				<Menu.ContextTrigger asChild>
					<HStack
						className="group"
						gap="1"
						w="full"
						minW="0"
						overflow="hidden"
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
							<SidebarActiveIndicator insetInlineStart="0" />
						)}
						<Box
							asChild
							flex="1 1 auto"
							minW="0"
							overflow="hidden"
							data-sidebar-item
						>
							<NavLink
								to={defaultProfileUrl}
								onClick={handleDefaultProfileClick}
							>
								<HStack
									gap="2"
									align="center"
									w="full"
									minW="0"
									overflow="hidden"
								>
									<ProjectAvatar
										projectId={project.id}
										projectName={project.name}
									/>
									<Text flex="1 1 auto" minW="0" truncate>
										{project.name}
									</Text>
									{showProjectNotification && (
										<Circle
											aria-hidden="true"
											size="2"
											bg="green.500"
											flexShrink={0}
										/>
									)}
								</HStack>
							</NavLink>
						</Box>

						{hasOnlyDefaultProfile ? (
							<Tooltip.Root
								openDelay={400}
								positioning={{ placement: "right" }}
							>
								<Tooltip.Trigger asChild>
									<IconButton
										as="span"
										variant="ghost"
										size="2xs"
										flexShrink={0}
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
								flexShrink={0}
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
							<ProjectGroupMenu
								project={project}
								projectGroups={projectGroups}
								onCloseMenu={() => setMenuOpen(false)}
							/>
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
						minW="0"
						maxW="var(--sidebar-width)"
						overflow="hidden"
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
								<SidebarActiveIndicator insetInlineStart="0" />
							)}
							<Icon fontSize="xs" color="fg.muted" flexShrink={0}>
								<FiTerminal />
							</Icon>
							<OverflowTooltipText
								displayValue={defaultProfileLabel}
								tooltipValue={defaultProfileLabel}
								fontSize="sm"
								flex="1 1 auto"
								minW="0"
							/>
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
