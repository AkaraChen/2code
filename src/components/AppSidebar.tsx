import {
	Box,
	Collapsible,
	Flex,
	HStack,
	Icon,
	Menu,
	Portal,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuFolderOpen, LuHouse, LuSettings } from "react-icons/lu";
import { NavLink, useLocation, useNavigate } from "react-router";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import RenameProjectDialog from "@/components/RenameProjectDialog";
import { useDeleteProject, useProjects } from "@/hooks/useProjects";
import * as m from "@/paraglide/messages.js";

function SidebarLink({
	to,
	icon,
	isActive,
	children,
}: {
	to: string;
	icon: React.ReactNode;
	isActive: boolean;
	children: React.ReactNode;
}) {
	return (
		<HStack
			asChild
			gap="3"
			px="4"
			py="2"
			fontSize="sm"
			cursor="pointer"
			bg={isActive ? "bg.emphasized" : "transparent"}
			_hover={{ bg: "bg.muted" }}
		>
			<NavLink to={to}>
				<Icon>{icon}</Icon>
				{children}
			</NavLink>
		</HStack>
	);
}

function ProjectMenuItem({
	project,
	isActive,
}: {
	project: { id: string; name: string };
	isActive: boolean;
}) {
	const deleteProject = useDeleteProject();
	const navigate = useNavigate();
	const [renameOpen, setRenameOpen] = useState(false);

	const handleDelete = async () => {
		await deleteProject.mutateAsync(project.id);
		navigate("/");
	};

	return (
		<>
			<Menu.Root>
				<Menu.ContextTrigger asChild>
					<HStack
						asChild
						gap="3"
						pl="10"
						pr="4"
						py="1.5"
						fontSize="sm"
						cursor="pointer"
						bg={isActive ? "bg.emphasized" : "transparent"}
						_hover={{ bg: "bg.muted" }}
					>
						<NavLink to={`/projects/${project.id}`}>
							{project.name}
						</NavLink>
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
								onClick={handleDelete}
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
		</>
	);
}

export default function AppSidebar() {
	const location = useLocation();
	const { data: projects } = useProjects();
	const [dialogOpen, setDialogOpen] = useState(false);

	const projectsActive = location.pathname.startsWith("/projects");

	return (
		<>
			<Box
				as="nav"
				aria-label={m.sideNavLabel()}
				w="256px"
				flexShrink={0}
				bg="bg.subtle"
				borderRight="1px solid"
				borderColor="border.subtle"
			>
				<Flex direction="column" h="full">
					<SidebarLink
						to="/"
						icon={<LuHouse />}
						isActive={location.pathname === "/"}
					>
						{m.home()}
					</SidebarLink>

					<Collapsible.Root defaultOpen={projectsActive}>
						<Collapsible.Trigger asChild>
							<HStack
								gap="3"
								px="4"
								py="2"
								fontSize="sm"
								cursor="pointer"
								fontWeight={
									projectsActive ? "semibold" : "normal"
								}
								_hover={{ bg: "bg.muted" }}
							>
								<Icon>
									<LuFolderOpen />
								</Icon>
								{m.projects()}
							</HStack>
						</Collapsible.Trigger>
						<Collapsible.Content>
							<HStack
								as="button"
								gap="3"
								pl="10"
								pr="4"
								py="1.5"
								fontSize="sm"
								cursor="pointer"
								w="full"
								_hover={{ bg: "bg.muted" }}
								onClick={() => setDialogOpen(true)}
							>
								{m.newProject()}
							</HStack>
							{projects.map((project) => (
								<ProjectMenuItem
									key={project.id}
									project={project}
									isActive={
										location.pathname ===
										`/projects/${project.id}`
									}
								/>
							))}
						</Collapsible.Content>
					</Collapsible.Root>

					<div className="grow" />

					<SidebarLink
						to="/settings"
						icon={<LuSettings />}
						isActive={location.pathname === "/settings"}
					>
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
