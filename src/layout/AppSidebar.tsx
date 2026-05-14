import "@fontsource-variable/bricolage-grotesque";
import { Box, Flex, HStack, Icon, IconButton, Text } from "@chakra-ui/react";
import { LayoutGroup } from "motion/react";
import { useCallback, useMemo, useRef } from "react";
import { FiFolder, FiHome, FiPlus, FiSettings } from "react-icons/fi";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";
import { useProjectGroups, useProjects } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";
import { SidebarLink } from "@/shared/components/SidebarLink";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { useHorizontalResize } from "@/shared/hooks/useHorizontalResize";
import { ProjectGroupSection } from "./sidebar/ProjectGroupSection";
import { ProjectMenuItem } from "./sidebar/ProjectMenuItem";
import {
	APP_SIDEBAR_MAX_WIDTH,
	APP_SIDEBAR_MIN_WIDTH,
	useAppSidebarStore,
} from "./sidebarStore";

function isMacPlatform() {
	return /mac/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

export default function AppSidebar() {
	const { data: projects } = useProjects();
	const { data: projectGroups } = useProjectGroups();
	const createDialog = useDialogState();
	const navRef = useRef<HTMLElement>(null);
	const sidebarWidth = useAppSidebarStore((s) => s.width);
	const setSidebarWidth = useAppSidebarStore((s) => s.setWidth);
	const resize = useHorizontalResize({
		value: sidebarWidth,
		min: APP_SIDEBAR_MIN_WIDTH,
		max: APP_SIDEBAR_MAX_WIDTH,
		onChange: setSidebarWidth,
	});
	const groupedProjects = useMemo(() => {
		const knownGroupIds = new Set(projectGroups.map((group) => group.id));
		const projectsByGroup = new Map(
			projectGroups.map((group) => [group.id, [] as typeof projects]),
		);
		const ungroupedProjects: typeof projects = [];

		for (const project of projects) {
			const groupId = project.group_id ?? null;
			if (groupId && knownGroupIds.has(groupId)) {
				projectsByGroup.get(groupId)?.push(project);
			} else {
				ungroupedProjects.push(project);
			}
		}

		return {
			groups: projectGroups
				.map((group) => ({
					group,
					projects: projectsByGroup.get(group.id) ?? [],
				}))
				.filter((group) => group.projects.length > 0),
			ungroupedProjects,
		};
	}, [projectGroups, projects]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

		const nav = navRef.current;
		if (!nav) return;

		const items = Array.from(
			nav.querySelectorAll<HTMLElement>("[data-sidebar-item]"),
		);
		if (items.length === 0) return;

		const currentIndex = items.indexOf(
			document.activeElement as HTMLElement,
		);

		let nextIndex: number;
		if (e.key === "ArrowDown") {
			nextIndex =
				currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
		} else {
			nextIndex =
				currentIndex === -1
					? items.length - 1
					: (currentIndex - 1 + items.length) % items.length;
		}

		items[nextIndex]?.focus();
		e.preventDefault();
	}, []);

	return (
		<>
			<Box
				as="nav"
				ref={navRef}
				aria-label={m.sideNavLabel()}
				w="var(--sidebar-width)"
				h="full"
				minH="0"
				flexShrink={0}
				position="relative"
				bg="bg.subtle"
				onKeyDown={handleKeyDown}
			>
				<LayoutGroup id="app-sidebar">
					<Flex direction="column" h="full" minH="0" w="full">
						<Flex
							data-tauri-drag-region
							h={isMacPlatform() ? "80px" : "52px"}
							flexShrink={0}
							align="center"
							justify="start"
							paddingInline="4"
							pt={isMacPlatform() ? "8" : "2"}
						>
							<Text
								fontFamily="'Bricolage Grotesque Variable', sans-serif"
								fontWeight="700"
								color="fg.muted"
								letterSpacing="tight"
								userSelect="none"
								pointerEvents="none"
								whiteSpace="nowrap"
							>
								2Code
							</Text>
						</Flex>
						<Box
							flex="1"
							minH="0"
							overflowY="scroll"
							overflowX="hidden"
							css={{ scrollbarGutter: "stable" }}
						>
							<Flex
								direction="column"
								minH="full"
								w="full"
								minW="0"
								css={{
									"& > *": {
										flexShrink: 0,
									},
								}}
							>
							{projects.length === 0 && (
								<SidebarLink
									to="/"
									icon={<FiHome />}
									style={{ marginBottom: 20 }}
								>
									{m.home()}
								</SidebarLink>
							)}

							<HStack
								px="4"
								pt="2"
								pb="2"
								align="center"
								gap="1"
								w="full"
								minW="0"
								userSelect="none"
							>
								<HStack gap="2" flex="1 1 auto" minW="0">
									<Box
										w="5"
										h="5"
										ml="-0.5"
										display="grid"
										placeItems="center"
										flexShrink={0}
										aria-hidden="true"
									>
										<Icon
											fontSize="sm"
											color="fg.muted"
											flexShrink={0}
										>
											<FiFolder />
										</Icon>
									</Box>
									<Text
										fontSize="xs"
										fontWeight="semibold"
										lineHeight="1rem"
										transform="translateY(1px)"
										color="fg.muted"
										textTransform="uppercase"
										letterSpacing="wider"
										truncate
									>
										{m.projects()}
									</Text>
								</HStack>
								<IconButton
									id="add-project-button"
									aria-label={m.newProject()}
									variant="ghost"
									size="2xs"
									flexShrink={0}
									onClick={createDialog.onOpen}
								>
									<FiPlus />
								</IconButton>
							</HStack>

							{groupedProjects.groups.map(
								({ group, projects }) => (
									<ProjectGroupSection
										key={group.id}
										group={group}
										projectGroups={projectGroups}
										projects={projects}
									/>
								),
							)}

							{groupedProjects.ungroupedProjects.map(
								(project) => (
									<ProjectMenuItem
										key={project.id}
										project={project}
										projectGroups={projectGroups}
									/>
								),
							)}
							</Flex>
						</Box>
						<Box flexShrink={0} pb="3">
							<SidebarLink to="/settings" icon={<FiSettings />}>
								{m.settings()}
							</SidebarLink>
						</Box>
					</Flex>
				</LayoutGroup>
				<Box
					role="separator"
					aria-label="Resize sidebar"
					aria-orientation="vertical"
					aria-valuemin={APP_SIDEBAR_MIN_WIDTH}
					aria-valuemax={APP_SIDEBAR_MAX_WIDTH}
					aria-valuenow={sidebarWidth}
					tabIndex={0}
					position="absolute"
					top="0"
					right="-4px"
					bottom="0"
					w="8px"
					cursor="col-resize"
					zIndex={1}
					onPointerDown={resize.handlePointerDown}
					onKeyDown={resize.handleKeyDown}
					_before={{
						content: '""',
						position: "absolute",
						top: 0,
						bottom: 0,
						left: "50%",
						transform: "translateX(-50%)",
						width: "1px",
						bg: resize.isDragging
							? "border.emphasized"
							: "transparent",
						transition: "background-color 0.16s ease",
					}}
					_hover={{
						_before: {
							bg: "border.subtle",
						},
					}}
					_focusVisible={{
						outline: "none",
						_before: {
							bg: "border.emphasized",
						},
					}}
				/>
			</Box>
			<CreateProjectDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
			/>
		</>
	);
}
