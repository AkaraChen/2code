import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import {
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
} from "@/components/ui/sidebar";
import type { ProjectGroup, ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useAppSidebarStore } from "../sidebarStore";
import { ProjectMenuItem } from "./ProjectMenuItem";

const GROUP_COLLAPSE_TRANSITION = {
	duration: 0.18,
	ease: [0.22, 1, 0.36, 1],
} as const;

interface ProjectGroupSectionProps {
	activeProfileId: string | null;
	group: ProjectGroup;
	projectGroups: ProjectGroup[];
	projects: ProjectWithProfiles[];
}

export function ProjectGroupSection({
	activeProfileId,
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
		<SidebarMenuItem>
			<SidebarMenuButton
				type="button"
				data-sidebar-item
				aria-expanded={!collapsed}
				aria-label={m.toggleProjectGroup({ name: group.name })}
				onClick={handleToggle}
				onKeyDown={(e) => {
					if (e.key !== "Enter" && e.key !== " ") return;
					e.preventDefault();
					handleToggle();
				}}
			>
				{collapsed ? <FiChevronRight /> : <FiChevronDown />}
				<span>{group.name}</span>
			</SidebarMenuButton>
			<SidebarMenuBadge>{projects.length}</SidebarMenuBadge>
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
						<SidebarMenuSub className="mx-0 translate-x-0 gap-0 border-l-0 px-0 py-0">
							{projects.map((project) => (
								<ProjectMenuItem
									key={project.id}
									activeProfileId={activeProfileId}
									project={project}
									projectGroups={projectGroups}
								/>
							))}
						</SidebarMenuSub>
					</motion.div>
				)}
			</AnimatePresence>
		</SidebarMenuItem>
	);
}
