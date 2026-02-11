import {
	Box,
	HStack,
	Icon,
	IconButton,
	Menu,
	Portal,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { Suspense, useRef, useState } from "react";
import {
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiTerminalBoxLine,
} from "react-icons/ri";
import { NavLink, useMatch } from "react-router";
import DeleteProjectDialog from "@/components/DeleteProjectDialog";
import RenameProjectDialog from "@/components/RenameProjectDialog";
import * as m from "@/paraglide/messages.js";
import { ProfileList } from "./ProfileList";

export function ProjectMenuItem({
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
