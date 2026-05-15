import { describe, expect, it } from "vitest";
import type { ProjectWithProfiles } from "@/generated";
import { removeProjectById } from "./projectCache";

const projects: ProjectWithProfiles[] = [
	{
		id: "project-1",
		name: "Project 1",
		folder: "/repo/one",
		created_at: "2026-01-01T00:00:00Z",
		group_id: null,
		profiles: [],
	},
	{
		id: "project-2",
		name: "Project 2",
		folder: "/repo/two",
		created_at: "2026-01-01T00:00:00Z",
		group_id: null,
		profiles: [],
	},
];

describe("removeProjectById", () => {
	it("removes the matching project", () => {
		expect(removeProjectById(projects, "project-1")).toEqual([projects[1]]);
	});

	it("returns a copied array when the project is missing", () => {
		const result = removeProjectById(projects, "missing");
		expect(result).toEqual(projects);
		expect(result).not.toBe(projects);
	});
});
