import type {
	ProjectGroup,
	ProjectSidebarLayoutUpdate,
	ProjectWithProfiles,
} from "@/generated";

const SIDEBAR_ORDER_STEP = 1000;
export const PINNED_DROP_ID = "sidebar-drop:pinned";
export const TOP_LEVEL_DROP_ID = "sidebar-drop:top-level";

export type SidebarEntryId = `group:${string}` | `project:${string}`;
export type SidebarContainerId =
	| "pinned"
	| "top-level"
	| `group:${string}`;

export interface SidebarGroupEntry {
	id: SidebarEntryId;
	kind: "group";
	group: ProjectGroup;
	projects: ProjectWithProfiles[];
}

export interface SidebarProjectEntry {
	id: SidebarEntryId;
	kind: "project";
	project: ProjectWithProfiles;
}

export type SidebarTopEntry = SidebarGroupEntry | SidebarProjectEntry;

interface SidebarLayoutModel {
	pinnedProjects: ProjectWithProfiles[];
	topEntries: SidebarTopEntry[];
	groupedProjects: Map<string, ProjectWithProfiles[]>;
	projectById: Map<string, ProjectWithProfiles>;
	groupById: Map<string, ProjectGroup>;
}

export interface SidebarLayoutState {
	pinnedProjectIds: string[];
	topEntryIds: SidebarEntryId[];
	groupProjectIds: Map<string, string[]>;
}

export function groupDropId(groupId: string) {
	return `sidebar-drop:group:${groupId}`;
}

export function projectEntryId(projectId: string): SidebarEntryId {
	return `project:${projectId}`;
}

export function groupEntryId(groupId: string): SidebarEntryId {
	return `group:${groupId}`;
}

export function parseEntryId(id: string) {
	if (id.startsWith("project:")) {
		return { kind: "project" as const, id: id.slice("project:".length) };
	}
	if (id.startsWith("group:")) {
		return { kind: "group" as const, id: id.slice("group:".length) };
	}
	return null;
}

export function parseDropId(id: string): SidebarContainerId | null {
	if (id === PINNED_DROP_ID) return "pinned";
	if (id === TOP_LEVEL_DROP_ID) return "top-level";
	if (id.startsWith("sidebar-drop:group:")) {
		return `group:${id.slice("sidebar-drop:group:".length)}`;
	}
	return null;
}

function orderValue(value: number | null | undefined) {
	return value ?? 0;
}

function compareProjects(a: ProjectWithProfiles, b: ProjectWithProfiles) {
	return (
		orderValue(a.sort_order) - orderValue(b.sort_order) ||
		a.created_at.localeCompare(b.created_at) ||
		a.name.localeCompare(b.name)
	);
}

function comparePinnedProjects(
	a: ProjectWithProfiles,
	b: ProjectWithProfiles,
) {
	return (
		orderValue(a.pinned_order) - orderValue(b.pinned_order) ||
		compareProjects(a, b)
	);
}

function compareTopEntries(a: SidebarTopEntry, b: SidebarTopEntry) {
	const aOrder =
		a.kind === "group" ? a.group.sort_order : a.project.sort_order;
	const bOrder =
		b.kind === "group" ? b.group.sort_order : b.project.sort_order;
	const aCreated =
		a.kind === "group" ? a.group.created_at : a.project.created_at;
	const bCreated =
		b.kind === "group" ? b.group.created_at : b.project.created_at;

	return (
		orderValue(aOrder) - orderValue(bOrder) ||
		aCreated.localeCompare(bCreated)
	);
}

export function buildSidebarLayout(
	projects: ProjectWithProfiles[],
	projectGroups: ProjectGroup[],
): SidebarLayoutModel {
	const projectById = new Map(projects.map((project) => [project.id, project]));
	const groupById = new Map(projectGroups.map((group) => [group.id, group]));
	const groupedProjects = new Map<string, ProjectWithProfiles[]>(
		projectGroups.map((group) => [group.id, []]),
	);
	const pinnedProjects: ProjectWithProfiles[] = [];
	const topProjects: ProjectWithProfiles[] = [];

	for (const project of projects) {
		if (project.pinned_order != null) {
			pinnedProjects.push(project);
			continue;
		}

		const groupId = project.group_id ?? null;
		if (groupId && groupById.has(groupId)) {
			groupedProjects.get(groupId)?.push(project);
			continue;
		}

		topProjects.push(project);
	}

	for (const groupProjects of groupedProjects.values()) {
		groupProjects.sort(compareProjects);
	}

	const groupEntries = projectGroups.map<SidebarGroupEntry>((group) => ({
		id: groupEntryId(group.id),
		kind: "group",
		group,
		projects: groupedProjects.get(group.id) ?? [],
	}));
	const projectEntries = topProjects.map<SidebarProjectEntry>((project) => ({
		id: projectEntryId(project.id),
		kind: "project",
		project,
	}));

	return {
		pinnedProjects: pinnedProjects.sort(comparePinnedProjects),
		topEntries: [...groupEntries, ...projectEntries].sort(compareTopEntries),
		groupedProjects,
		projectById,
		groupById,
	};
}

export function toSidebarLayoutState(
	model: SidebarLayoutModel,
): SidebarLayoutState {
	return {
		pinnedProjectIds: model.pinnedProjects.map((project) => project.id),
		topEntryIds: model.topEntries.map((entry) => entry.id),
		groupProjectIds: new Map(
			Array.from(model.groupedProjects.entries()).map(
				([groupId, projects]) => [
					groupId,
					projects.map((project) => project.id),
				],
			),
		),
	};
}

export function createSidebarLayoutUpdates(
	state: SidebarLayoutState,
): ProjectSidebarLayoutUpdate[] {
	const updates: ProjectSidebarLayoutUpdate[] = [];

	state.pinnedProjectIds.forEach((projectId, index) => {
		updates.push({
			kind: "project",
			id: projectId,
			groupId: null,
			sortOrder: 0,
			pinnedOrder: (index + 1) * SIDEBAR_ORDER_STEP,
		});
	});

	state.topEntryIds.forEach((entryId, index) => {
		const parsed = parseEntryId(entryId);
		if (!parsed) return;
		const sortOrder = (index + 1) * SIDEBAR_ORDER_STEP;
		if (parsed.kind === "group") {
			updates.push({
				kind: "group",
				id: parsed.id,
				sortOrder,
			});
		} else {
			updates.push({
				kind: "project",
				id: parsed.id,
				groupId: null,
				sortOrder,
				pinnedOrder: null,
			});
		}
	});

	for (const [groupId, projectIds] of state.groupProjectIds) {
		projectIds.forEach((projectId, index) => {
			updates.push({
				kind: "project",
				id: projectId,
				groupId,
				sortOrder: (index + 1) * SIDEBAR_ORDER_STEP,
				pinnedOrder: null,
			});
		});
	}

	return updates;
}
