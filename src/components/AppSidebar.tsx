import { Box, Flex, HStack, IconButton, Text } from "@chakra-ui/react";
import { useState } from "react";
import { RiAddLine, RiHome4Line, RiSettings3Line } from "react-icons/ri";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import { ProjectMenuItem } from "@/components/sidebar/ProjectMenuItem";
import { SidebarLink } from "@/components/sidebar/SidebarLink";
import { useProjects } from "@/hooks/useProjects";
import * as m from "@/paraglide/messages.js";

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
