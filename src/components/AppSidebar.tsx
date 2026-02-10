import {
	MenuItem as CarbonMenuItem,
	Menu,
	SideNav,
	SideNavItems,
	SideNavLink,
	SideNavMenu,
	SideNavMenuItem,
	useContextMenu,
} from "@carbon/react";
import { FolderOpen, Home, Settings } from "@carbon/react/icons";
import { useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import { useProjects } from "@/contexts/ProjectContext";
import * as m from "@/paraglide/messages.js";

const Link = SideNavLink as React.ComponentType<
	React.ComponentProps<typeof SideNavLink> & {
		element: typeof NavLink;
		to: string;
	}
>;

const MenuItem = SideNavMenuItem as React.ComponentType<
	React.ComponentProps<typeof SideNavMenuItem> & {
		element: typeof NavLink;
		to: string;
	}
>;

function ProjectMenuItem({
	project,
	isActive,
}: {
	project: { id: string; name: string };
	isActive: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const menuProps = useContextMenu(ref);
	const { deleteProject } = useProjects();
	const navigate = useNavigate();

	const handleDelete = async () => {
		await deleteProject(project.id);
		navigate("/projects");
	};

	return (
		<div ref={ref}>
			<MenuItem
				element={NavLink}
				to={`/projects/${project.id}`}
				isActive={isActive}
			>
				{project.name}
			</MenuItem>
			<Menu label="" {...menuProps}>
				<CarbonMenuItem
					label={m.deleteProject()}
					kind="danger"
					onClick={handleDelete}
				/>
			</Menu>
		</div>
	);
}

export default function AppSidebar() {
	const location = useLocation();
	const { projects } = useProjects();
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<>
			<SideNav
				isFixedNav
				expanded
				isChildOfHeader={false}
				aria-label={m.sideNavLabel()}
			>
				<SideNavItems>
					<Link
						element={NavLink}
						to="/"
						renderIcon={Home}
						isActive={location.pathname === "/"}
					>
						{m.home()}
					</Link>
					<SideNavMenu
						title={m.projects()}
						renderIcon={FolderOpen}
						isActive={location.pathname.startsWith("/projects")}
						defaultExpanded={location.pathname.startsWith(
							"/projects",
						)}
					>
						<SideNavMenuItem onClick={() => setDialogOpen(true)}>
							{m.newProject()}
						</SideNavMenuItem>
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
					</SideNavMenu>
					<div className="grow" />
					<Link
						element={NavLink}
						to="/settings"
						renderIcon={Settings}
						isActive={location.pathname === "/settings"}
					>
						{m.settings()}
					</Link>
				</SideNavItems>
			</SideNav>
			<CreateProjectDialog
				isOpen={dialogOpen}
				onClose={() => setDialogOpen(false)}
			/>
		</>
	);
}
