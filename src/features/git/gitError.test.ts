import { describe, expect, it } from "vitest";

import { describeGitError, isGitError } from "./gitError";

describe("isGitError", () => {
	it("accepts a backend git error shape", () => {
		expect(
			isGitError({
				kind: { kind: "non_fast_forward" },
				message: "rejected",
			}),
		).toBe(true);

		expect(
			isGitError({
				kind: {
					kind: "merge_conflict",
					details: { paths: ["a.rs"] },
				},
				message: "conflict",
			}),
		).toBe(true);
	});

	it("rejects non-error values", () => {
		expect(isGitError(null)).toBe(false);
		expect(isGitError("oops")).toBe(false);
		expect(isGitError({})).toBe(false);
		expect(isGitError({ kind: "string" })).toBe(false);
		expect(isGitError({ kind: { kind: "x" } })).toBe(false);
	});
});

describe("describeGitError", () => {
	it("non_fast_forward suggests pull or force-with-lease", () => {
		const out = describeGitError({
			kind: { kind: "non_fast_forward" },
			message: "rejected",
		});
		expect(out.title.toLowerCase()).toContain("push");
		expect(out.description.toLowerCase()).toMatch(/pull|force/);
	});

	it("merge_conflict lists up to 3 paths", () => {
		const out = describeGitError({
			kind: {
				kind: "merge_conflict",
				details: { paths: ["a.rs", "b.rs", "c.rs", "d.rs"] },
			},
			message: "conflict",
		});
		expect(out.description).toContain("a.rs");
		expect(out.description).toContain("b.rs");
		expect(out.description).toContain("c.rs");
		expect(out.description).toContain("+1 more");
		expect(out.description).not.toContain("d.rs,");
	});

	it("branch_exists includes branch name", () => {
		const out = describeGitError({
			kind: {
				kind: "branch_exists",
				details: { branch: "feat/x" },
			},
			message: "exists",
		});
		expect(out.description).toContain("feat/x");
	});

	it("other falls back to message", () => {
		const out = describeGitError({
			kind: { kind: "other", details: "some weird stderr" },
			message: "wrapper message",
		});
		expect(out.description).toBe("wrapper message");
	});
});
