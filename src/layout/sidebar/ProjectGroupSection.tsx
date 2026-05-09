import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import type { ProjectGroup, ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useAppSidebarStore } from "../sidebarStore";
import { ProjectMenuItem } from "./ProjectMenuItem";

const GROUP_COLLAPSE_TRANSITION = {
	duration: 0.18,
	ease: [0.22, 1, 0.36, 1],
} as const;

interface ProjectGroupSectionProps {
	group: ProjectGroup;
	projectGroups: ProjectGroup[];
	projects: ProjectWithProfiles[];
}

export function ProjectGroupSection({
	group,
	projectGroups,
	projects,
}: ProjectGroupSectionProps) {
	const collapsed = useAppSidebarStore((state) =>
		state.collapsedProjectGroupIds.includes(group.id),
	);
	const toggleProjectGroup = useAppSidebarStore(
		(state) => state.toggleProjectGroup,
	);
	const prefersReducedMotion = useReducedMotion() ?? false;

	const handleToggle = () => {
		toggleProjectGroup(group.id);
	};

	return (
		<>
			<HStack
				data-sidebar-item
				role="button"
				tabIndex={0}
				aria-expanded={!collapsed}
				aria-label={m.toggleProjectGroup({ name: group.name })}
				gap="1"
				w="full"
				minW="0"
				px="4"
				py="1.5"
				cursor="pointer"
				color="fg.muted"
				fontSize="xs"
				fontWeight="semibold"
				textTransform="uppercase"
				userSelect="none"
				_hover={{ bg: "bg.subtle" }}
				onClick={handleToggle}
				onKeyDown={(e) => {
					if (e.key !== "Enter" && e.key !== " ") return;
					e.preventDefault();
					handleToggle();
				}}
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
						<Icon fontSize="sm">
							{collapsed ? <FiChevronRight /> : <FiChevronDown />}
						</Icon>
					</Box>
					<Text flex="1 1 auto" minW="0" truncate>
						{group.name}
					</Text>
				</HStack>
				<Box
					w="6"
					h="6"
					display="grid"
					placeItems="center"
					flexShrink={0}
					color="fg.subtle"
				>
					{projects.length}
				</Box>
			</HStack>
			<AnimatePresence initial={false}>
				{!collapsed && (
					<motion.div
						key={group.id}
						initial={
							prefersReducedMotion
								? false
								: { height: 0, opacity: 0 }
						}
						animate={{ height: "auto", opacity: 1 }}
						exit={
							prefersReducedMotion
								? { opacity: 1 }
								: { height: 0, opacity: 0 }
						}
						transition={
							prefersReducedMotion
								? { duration: 0 }
								: GROUP_COLLAPSE_TRANSITION
						}
						style={{ overflow: "hidden" }}
					>
						{projects.map((project) => (
							<ProjectMenuItem
								key={project.id}
								project={project}
								projectGroups={projectGroups}
							/>
						))}
					</motion.div>
				)}
			</AnimatePresence>
		</>
	);
}
