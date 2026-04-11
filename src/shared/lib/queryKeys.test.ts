import { describe, expect, it } from "vitest";
import { queryKeys, queryNamespaces } from "./queryKeys";

describe("queryNamespaces", () => {
	it("contains all expected namespace strings", () => {
		expect(queryNamespaces).toEqual({
			project: "project",
			"project-config": "project-config",
			"git-branch": "git-branch",
			"git-diff": "git-diff",
			"git-diff-stats": "git-diff-stats",
			"git-log": "git-log",
			"git-commit-diff": "git-commit-diff",
			"topbar-apps": "topbar-apps",
		});
	});
});

describe("queryKeys", () => {
	describe("projects", () => {
		it("returns static key for all projects", () => {
			expect(queryKeys.projects.all).toEqual(["projects"]);
		});

		it("returns the same reference each time", () => {
			expect(queryKeys.projects.all).toBe(queryKeys.projects.all);
		});
	});

	describe("projectConfig", () => {
		it("includes projectId in key", () => {
			expect(queryKeys.projectConfig("project-1")).toEqual([
				"project-config",
				"project-1",
			]);
		});
	});

	describe("topbar", () => {
		it("returns static key for supported apps", () => {
			expect(queryKeys.topbar.apps).toEqual(["topbar-apps"]);
		});
	});

	describe("git", () => {
		it("branch() includes folder in key", () => {
			expect(queryKeys.git.branch("/path/to/repo")).toEqual([
				"git-branch",
				"/path/to/repo",
			]);
		});

		it("diff() includes profileId in key", () => {
			expect(queryKeys.git.diff("profile-1")).toEqual([
				"git-diff",
				"profile-1",
			]);
		});

		it("diffStats() includes profileId in key", () => {
			expect(queryKeys.git.diffStats("profile-1")).toEqual([
				"git-diff-stats",
				"profile-1",
			]);
		});

		it("log() includes profileId in key", () => {
			expect(queryKeys.git.log("profile-1")).toEqual([
				"git-log",
				"profile-1",
			]);
		});

		it("commitDiff() includes profileId and hash", () => {
			expect(queryKeys.git.commitDiff("p1", "abc123")).toEqual([
				"git-commit-diff",
				"p1",
				"abc123",
			]);
		});

		it("returns different references for different args", () => {
			expect(queryKeys.git.diff("a")).not.toBe(queryKeys.git.diff("b"));
		});

		it("returns different references on each call (factory)", () => {
			expect(queryKeys.git.diff("a")).not.toBe(queryKeys.git.diff("a"));
		});
	});
});
