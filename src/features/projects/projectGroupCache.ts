import type { ProjectGroup } from "@/generated";

export function upsertProjectGroup(
	groups: ProjectGroup[] | undefined,
	group: ProjectGroup,
): ProjectGroup[] {
	if (!groups) return [group];

	const nextGroups = groups.slice();
	for (let index = 0; index < nextGroups.length; index++) {
		if (nextGroups[index].id === group.id) {
			nextGroups[index] = group;
			return nextGroups;
		}
	}

	nextGroups.push(group);
	return nextGroups;
}
