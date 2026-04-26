import { describe, expect, it } from "vitest";

import { buildBranchTree } from "./branchTree";

const id = (s: string) => s;

describe("buildBranchTree", () => {
	it("returns leaves at root for flat names", () => {
		const tree = buildBranchTree(["a", "b", "c"], id);
		expect(tree.map((n) => n.kind)).toEqual(["leaf", "leaf", "leaf"]);
		expect(tree.map((n) => n.path)).toEqual(["a", "b", "c"]);
	});

	it("groups slash-separated names into folders", () => {
		const tree = buildBranchTree(
			["feat/auth/login", "feat/auth/logout", "fix/typo"],
			id,
		);
		// folders sort first
		expect(tree[0].kind).toBe("folder");
		expect(tree[0].name).toBe("feat");
		expect(tree[1].kind).toBe("folder");
		expect(tree[1].name).toBe("fix");

		const feat = tree[0];
		if (feat.kind !== "folder") throw new Error("not a folder");
		expect(feat.children).toHaveLength(1);
		expect(feat.children[0].kind).toBe("folder");
		expect(feat.children[0].name).toBe("auth");

		const auth = feat.children[0];
		if (auth.kind !== "folder") throw new Error("not a folder");
		expect(auth.children.map((c) => c.path)).toEqual([
			"feat/auth/login",
			"feat/auth/logout",
		]);
	});

	it("places main / master at the top of root leaves", () => {
		const tree = buildBranchTree(
			["zebra", "main", "alpha", "master"],
			id,
		);
		expect(tree.map((n) => n.path)).toEqual([
			"main",
			"master",
			"alpha",
			"zebra",
		]);
	});

	it("priority leaves only apply at root, not inside folders", () => {
		const tree = buildBranchTree(["feat/main", "feat/zebra"], id);
		const feat = tree[0];
		if (feat.kind !== "folder") throw new Error("not a folder");
		expect(feat.children.map((c) => c.path)).toEqual([
			"feat/main",
			"feat/zebra",
		]);
	});

	it("folders before leaves at every level", () => {
		const tree = buildBranchTree(
			["main", "feat/x", "fix/y", "alpha"],
			id,
		);
		expect(tree.map((n) => n.kind)).toEqual([
			"folder",
			"folder",
			"leaf",
			"leaf",
		]);
		expect(tree.map((n) => n.name)).toEqual([
			"feat",
			"fix",
			"main",
			"alpha",
		]);
	});

	it("handles trailing/leading/double slashes by ignoring empty segments", () => {
		const tree = buildBranchTree(["//feat///auth/login//", "/main"], id);
		const feat = tree[0];
		if (feat.kind !== "folder") throw new Error("not a folder");
		expect(feat.name).toBe("feat");
		expect(feat.children[0].kind).toBe("folder");
		expect(feat.children[0].name).toBe("auth");
	});

	it("preserves the leaf payload via the value field", () => {
		type B = { name: string; ahead: number };
		const items: B[] = [
			{ name: "main", ahead: 0 },
			{ name: "feat/login", ahead: 3 },
		];
		const tree = buildBranchTree(items, (b) => b.name);
		const main = tree.find((n) => n.kind === "leaf" && n.name === "main");
		expect(main?.kind).toBe("leaf");
		if (main?.kind !== "leaf") throw new Error("not a leaf");
		expect(main.value.ahead).toBe(0);
	});

	it("returns empty array for empty input", () => {
		expect(buildBranchTree([], id)).toEqual([]);
	});

	it("collapses an empty-string entry to nothing", () => {
		const tree = buildBranchTree(["", "main"], id);
		expect(tree).toHaveLength(1);
		expect(tree[0].path).toBe("main");
	});
});
