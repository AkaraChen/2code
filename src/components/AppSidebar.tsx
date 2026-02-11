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
import { RiAddLine, RiHome4Line, RiSettings3Line } from "react-icons/ri";
import { NavLink, useMatch } from "react-router";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import DeleteProjectDialog from "@/components/DeleteProjectDialog";
import RenameProjectDialog from "@/components/RenameProjectDialog";
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
						px="4"
						py="1.5"
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
				w="250px"
				flexShrink={0}
				bg="bg.subtle"
				borderRight="1px solid"
				borderColor="border.subtle"
			>
				<Flex direction="column" h="full" py="3">
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
