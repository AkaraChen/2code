import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	getFileTreeIconSymbol,
	resolveFileTreeFileIcon,
} from "@/shared/lib/fileTreeIcons";
import FileTreeFileIcon from "./FileTreeFileIcon";

describe("fileTreeFileIcon", () => {
	it("resolves file icons through @pierre/trees", () => {
		expect(resolveFileTreeFileIcon("index.ts")).toMatchObject({
			name: "file-tree-builtin-typescript",
			remappedFrom: "file-tree-icon-file",
			token: "typescript",
		});
	});

	it("renders the resolved tree icon symbol inline", () => {
		render(<FileTreeFileIcon data-testid="icon" fileName="App.tsx" />);

		const icon = screen.getByTestId("icon");
		expect(icon).toHaveAttribute("data-icon-name", "file-tree-icon-file");
		expect(icon).toHaveAttribute("data-icon-token", "react");
		expect(icon).toHaveAttribute("viewBox", "0 0 16 16");
		expect(icon.querySelector("path")).not.toBeNull();
	});

	it("falls back to the default tree file symbol", () => {
		const icon = resolveFileTreeFileIcon("unknown.ext");

		expect(icon).toMatchObject({
			name: "file-tree-builtin-default",
			token: "default",
		});
		expect(getFileTreeIconSymbol(icon.name).body).toContain("path");
	});
});
