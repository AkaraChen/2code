import {
	Box,
	Flex,
	HStack,
	Icon,
	IconButton,
	Menu,
	Portal,
	Separator,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { Suspense, useRef, useState } from "react";
import {
	RiAddLine,
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiGitBranchLine,
	RiHome4Line,
	RiSettings3Line,
	RiTerminalBoxLine,
} from "react-icons/ri";
import { NavLink, useMatch } from "react-router";
import CreateProfileDialog from "@/components/CreateProfileDialog";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import DeleteProfileDialog from "@/components/DeleteProfileDialog";
import DeleteProjectDialog from "@/components/DeleteProjectDialog";
import RenameProjectDialog from "@/components/RenameProjectDialog";
import { useProfiles } from "@/hooks/useProfiles";
import { useProjects } from "@/hooks/useProjects";
import * as m from "@/paraglide/messages.js";
import type { Profile } from "@/types";

function SidebarLink({
	to,
	icon,
	children,
}: {
	to: string;
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	const isActive = useMatch(to) !== null;
	return (
		<HStack
			asChild
			gap="3"
			px="4"
			py="2"
			cursor="pointer"
			borderLeft="3px solid"
			borderColor={isActive ? "colorPalette.solid" : "transparent"}
			bg={isActive ? "bg.subtle" : "transparent"}
			_hover={{ bg: "bg.subtle" }}
		>
			<NavLink to={to}>
				<Icon fontSize="md">{icon}</Icon>
				{children}
			</NavLink>
		</HStack>
	);
}

function ProfileItem({
	profile,
	projectId,
	isActive,
}: {
	profile: Profile;
	projectId: string;
	isActive: boolean;
}) {
	const [deleteOpen, setDeleteOpen] = useState(false);

	return (
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<HStack
						asChild
						gap="2"
						ps="9"
						pe="4"
						py="1"
						cursor="pointer"
						truncate
						fontSize="sm"
						bg={isActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
					>
						<NavLink
							to={`/projects/${projectId}/profiles/${profile.id}`}
						>
							<Icon fontSize="xs" color="fg.muted">
								<RiGitBranchLine />
							</Icon>
							<Text truncate>{profile.branch_name}</Text>
						</NavLink>
					</HStack>
				</Menu.ContextTrigger>
				<Portal>
					<Menu.Positioner>
						<Menu.Content>
							<Menu.Item
								value="delete"
								color="fg.error"
								_hover={{ bg: "bg.error", color: "fg.error" }}
								onClick={() => setDeleteOpen(true)}
							>
								{m.deleteProfile()}
							</Menu.Item>
						</Menu.Content>
					</Menu.Positioner>
				</Portal>
			</Menu.Root>
			<DeleteProfileDialog
				isOpen={deleteOpen}
				onClose={() => setDeleteOpen(false)}
				profile={profile}
			/>
		</>
	);
}

function ProfileList({
	projectId,
	activeProfileId,
}: {
	projectId: string;
	activeProfileId: string | null;
}) {
	const { data: profiles } = useProfiles(projectId);
	const [createOpen, setCreateOpen] = useState(false);

	return (
		<>
			{profiles.map((profile) => (
				<ProfileItem
					key={profile.id}
					profile={profile}
					projectId={projectId}
					isActive={profile.id === activeProfileId}
				/>
			))}
			<HStack
				as="button"
				gap="2"
				ps="9"
				pe="4"
				py="1"
				cursor="pointer"
				fontSize="sm"
				color="fg.muted"
				_hover={{ bg: "bg.subtle", color: "fg" }}
				onClick={() => setCreateOpen(true)}
			>
				<Icon fontSize="xs">
					<RiAddLine />
				</Icon>
				<Text>{m.createProfile()}</Text>
			</HStack>
			<CreateProfileDialog
				isOpen={createOpen}
				onClose={() => setCreateOpen(false)}
				projectId={projectId}
			/>
		</>
	);
}

function ProjectMenuItem({
	project,
}: {
	project: { id: string; name: string };
}) {
	const projectMatch = useMatch(`/projects/${project.id}`);
	const profileMatch = useMatch(
		`/projects/${project.id}/profiles/:profileId`,
	);
	const isProjectActive = projectMatch !== null;
	const isAnyActive = isProjectActive || profileMatch !== null;
	const activeProfileId = profileMatch?.params.profileId ?? null;

	const [expanded, setExpanded] = useState(isAnyActive);
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const wasActive = useRef(isAnyActive);

	// Auto-expand only on transition from inactive → active
	if (isAnyActive && !wasActive.current) {
		setExpanded(true);
	}
	wasActive.current = isAnyActive;

	return (
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<HStack
						gap="1"
						px="4"
						py="1.5"
						cursor="pointer"
						borderLeft="3px solid"
						borderColor={
							isAnyActive ? "colorPalette.solid" : "transparent"
						}
						bg={isAnyActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
					>
						<Box asChild truncate flex="1">
							<NavLink to={`/projects/${project.id}`}>
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
								setExpanded((v) => !v);
							}}
						>
							{expanded ? (
								<RiArrowDownSLine />
							) : (
								<RiArrowRightSLine />
							)}
						</IconButton>
					</HStack>
				</Menu.ContextTrigger>
				<Portal>
					<Menu.Positioner>
						<Menu.Content>
							<Menu.Item
								value="rename"
								onClick={() => setRenameOpen(true)}
							>
								{m.renameProject()}
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item
								value="delete"
								color="fg.error"
								_hover={{ bg: "bg.error", color: "fg.error" }}
								onClick={() => setDeleteOpen(true)}
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
						gap="2"
						ps="9"
						pe="4"
						py="1"
						cursor="pointer"
						fontSize="sm"
						bg={isProjectActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
					>
						<NavLink to={`/projects/${project.id}`}>
							<Icon fontSize="xs" color="fg.muted">
								<RiTerminalBoxLine />
							</Icon>
							<Text truncate>{m.defaultProfile()}</Text>
						</NavLink>
					</HStack>

					<Suspense
						fallback={
							<HStack ps="9" pe="4" py="1">
								<Spinner size="xs" />
							</HStack>
						}
					>
						<ProfileList
							projectId={project.id}
							activeProfileId={activeProfileId}
						/>
					</Suspense>
				</>
			)}

			<RenameProjectDialog
				isOpen={renameOpen}
				onClose={() => setRenameOpen(false)}
				project={project}
			/>
			<DeleteProjectDialog
				isOpen={deleteOpen}
				onClose={() => setDeleteOpen(false)}
				project={project}
			/>
		</>
	);
}

export default function AppSidebar() {
	const { data: projects } = useProjects();
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<>
			<Box
				as="nav"
				aria-label={m.sideNavLabel()}
				w="var(--sidebar-width)"
				flexShrink={0}
				bg="bg.subtle"
			>
				<Flex direction="column" h="full" pb="3">
					{/* macOS traffic light area + drag region */}
					<Box data-tauri-drag-region h="48px" flexShrink={0} />
					<SidebarLink to="/" icon={<RiHome4Line />}>
						{m.home()}
					</SidebarLink>

					<HStack px="4" pt="5" pb="2" justify="space-between">
						<Text
							fontSize="xs"
							fontWeight="semibold"
							color="fg.muted"
							textTransform="uppercase"
							letterSpacing="wider"
						>
							{m.projects()}
						</Text>
						<IconButton
							aria-label={m.newProject()}
							variant="ghost"
							size="2xs"
							onClick={() => setDialogOpen(true)}
						>
							<RiAddLine />
						</IconButton>
					</HStack>

					{projects.map((project) => (
						<ProjectMenuItem key={project.id} project={project} />
					))}

					<div className="grow" />

					<Separator />
					<SidebarLink to="/settings" icon={<RiSettings3Line />}>
						{m.settings()}
					</SidebarLink>
				</Flex>
			</Box>
			<CreateProjectDialog
				isOpen={dialogOpen}
				onClose={() => setDialogOpen(false)}
			/>
		</>
	);
}
