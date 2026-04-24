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
			"git-status": "git-status",
			"git-log": "git-log",
			"git-commit-diff": "git-commit-diff",
			"git-binary-preview": "git-binary-preview",
			"git-ahead-count": "git-ahead-count",
			"topbar-apps": "topbar-apps",
			"fs-file": "fs-file",
			"fs-search": "fs-search",
			"fs-tree": "fs-tree",
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

		it("status() includes profileId in key", () => {
			expect(queryKeys.git.status("profile-1")).toEqual([
				"git-status",
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

		it("binaryPreview() includes cache-busting inputs", () => {
			expect(
				queryKeys.git.binaryPreview(
					"profile-1",
					"assets/logo.png",
					"after",
					"abc123",
					"rev-1",
				),
			).toEqual([
				"git-binary-preview",
				"profile-1",
				"assets/logo.png",
				"after",
				"abc123",
				"rev-1",
			]);
		});

		it("aheadCount() includes profileId in key", () => {
			expect(queryKeys.git.aheadCount("profile-1")).toEqual([
				"git-ahead-count",
				"profile-1",
			]);
		});

		it("returns different references for different args", () => {
			expect(queryKeys.git.diff("a")).not.toBe(queryKeys.git.diff("b"));
		});

		it("returns different references on each call (factory)", () => {
			expect(queryKeys.git.diff("a")).not.toBe(queryKeys.git.diff("a"));
		});
	});

	describe("filesystem", () => {
		it("tree() includes the folder path", () => {
			expect(queryKeys.fs.tree("/tmp/worktree")).toEqual([
				"fs-tree",
				"/tmp/worktree",
			]);
		});

		it("file() includes the file path", () => {
			expect(queryKeys.fs.file("/tmp/worktree/README.md")).toEqual([
				"fs-file",
				"/tmp/worktree/README.md",
			]);
		});

		it("search() includes profileId and query", () => {
			expect(queryKeys.fs.search("profile-1", "readme")).toEqual([
				"fs-search",
				"profile-1",
				"readme",
			]);
		});
	});
});
