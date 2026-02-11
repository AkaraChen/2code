import {
	Box,
	Flex,
	HStack,
	Icon,
	IconButton,
	Menu,
	Portal,
	Separator,
	Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuHouse, LuPlus, LuSettings } from "react-icons/lu";
import { NavLink, useMatch } from "react-router";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import RenameProjectDialog from "@/components/RenameProjectDialog";
import DeleteProjectDialog from "@/components/DeleteProjectDialog";
import { useProjects } from "@/hooks/useProjects";
import * as m from "@/paraglide/messages.js";

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
			gap="2"
			px="3"
			py="1.5"
			fontSize="sm"
			cursor="pointer"
			borderLeft="3px solid"
			borderColor={isActive ? "colorPalette.solid" : "transparent"}
			bg={isActive ? "bg.subtle" : "transparent"}
			_hover={{ bg: "bg.subtle" }}
		>
			<NavLink to={to}>
				<Icon fontSize="16px">{icon}</Icon>
				{children}
			</NavLink>
		</HStack>
	);
}

function ProjectMenuItem({
	project,
}: {
	project: { id: string; name: string };
}) {
	const isActive = useMatch(`/projects/${project.id}`) !== null;
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	return (
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<Box
						asChild
						display="block"
						pl="5"
						pr="3"
						py="1"
						fontSize="sm"
						cursor="pointer"
						truncate
						borderLeft="3px solid"
						borderColor={
							isActive ? "colorPalette.solid" : "transparent"
						}
						bg={isActive ? "bg.subtle" : "transparent"}
						_hover={{ bg: "bg.subtle" }}
					>
						<NavLink to={`/projects/${project.id}`}>
							{project.name}
						</NavLink>
					</Box>
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
				w="220px"
				flexShrink={0}
				bg="bg.subtle"
				borderRight="1px solid"
				borderColor="border.subtle"
			>
				<Flex direction="column" h="full" py="2">
					<SidebarLink to="/" icon={<LuHouse />}>
						{m.home()}
					</SidebarLink>

					<HStack px="3" pt="4" pb="1" justify="space-between">
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
							<LuPlus />
						</IconButton>
					</HStack>

					{projects.map((project) => (
						<ProjectMenuItem
							key={project.id}
							project={project}
						/>
					))}

					<div className="grow" />

					<Separator />
					<SidebarLink to="/settings" icon={<LuSettings />}>
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
