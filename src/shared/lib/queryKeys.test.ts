import { describe, expect, it } from "vitest";
import { queryKeys, queryNamespaces } from "./queryKeys";

describe("queryKeys", () => {
	describe("projects", () => {
		it("returns static key for all projects", () => {
			expect(queryKeys.projects.all).toEqual(["projects"]);
		});

		it("returns the same reference each time", () => {
			expect(queryKeys.projects.all).toBe(queryKeys.projects.all);
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

	describe("queryNamespaces", () => {
		it("maps each namespace to its string value", () => {
			expect(queryNamespaces.projects).toBe("projects");
			expect(queryNamespaces["git-diff"]).toBe("git-diff");
			expect(queryNamespaces["git-log"]).toBe("git-log");
		});

		it("namespace strings match queryKeys prefixes", () => {
			expect(queryKeys.git.diff("x")[0]).toBe(queryNamespaces["git-diff"]);
			expect(queryKeys.git.log("x")[0]).toBe(queryNamespaces["git-log"]);
			expect(queryKeys.git.branch("x")[0]).toBe(
				queryNamespaces["git-branch"],
			);
		});
	});
});
