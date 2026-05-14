import { ChakraProvider } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { appSystem } from "@/theme/system";
import { GIT_DIFF_LARGE_FILE_LINE_THRESHOLD } from "../utils";
import GitDiffPane from "./GitDiffPane";

vi.mock("@/paraglide/messages.js", async () => {
	const actual = await vi.importActual<typeof import("@/paraglide/messages.js")>(
		"@/paraglide/messages.js",
	);

	return {
		...actual,
		gitDiffLargeGuardrailTitle: () => "Large diff hidden by default",
		gitDiffLargeGuardrailDescription: ({
			count,
			threshold,
		}: {
			count: number;
			threshold: number;
		}) =>
			`This file changes ${count} lines. Diffs with ${threshold} or more changed lines are hidden by default to keep the dialog responsive.`,
		gitDiffLargeGuardrailReveal: () => "Load diff anyway",
		gitDiffRenamePreviousPath: () => "Previous path",
		gitDiffRenameCurrentPath: () => "Current path",
	};
});

vi.mock("@pierre/diffs/react", () => ({
	FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => (
		<div data-testid="mock-file-diff">{fileDiff.name}</div>
	),
}));

function makeDiffFile(
	name: string,
	changedLineCount: number,
): FileDiffMetadata {
	return {
		name,
		type: "change",
		hunks: [
			{
				hunkContent: [
					{
						type: "change",
						additions: changedLineCount,
						deletions: 0,
					},
				],
			},
		],
	} as unknown as FileDiffMetadata;
}

function renderPane(activeFile: FileDiffMetadata) {
	return render(
		<ChakraProvider value={appSystem}>
			<GitDiffPane activeFile={activeFile} options={{}} emptyMessage="empty" />
		</ChakraProvider>,
	);
}

function makeRenameOnlyFile(): FileDiffMetadata {
	return {
		name: "src/new-name.ts",
		prevName: "src/old-name.ts",
		type: "rename-pure",
		hunks: [],
	} as unknown as FileDiffMetadata;
}

describe("gitDiffPane large diff guardrail", () => {
	it("hides diffs at the guardrail threshold by default", () => {
		renderPane(
			makeDiffFile(
				"src/large.ts",
				GIT_DIFF_LARGE_FILE_LINE_THRESHOLD,
			),
		);

		expect(
			screen.getByTestId("git-diff-large-guardrail"),
		).toBeInTheDocument();
		expect(screen.queryByTestId("mock-file-diff")).not.toBeInTheDocument();
	});

	it("reveals a large diff after explicit confirmation", () => {
		renderPane(
			makeDiffFile(
				"src/large.ts",
				GIT_DIFF_LARGE_FILE_LINE_THRESHOLD + 12,
			),
		);

		fireEvent.click(screen.getByTestId("git-diff-large-guardrail-reveal"));

		expect(screen.queryByTestId("git-diff-large-guardrail")).not.toBeInTheDocument();
		expect(screen.getByTestId("mock-file-diff")).toHaveTextContent(
			"src/large.ts",
		);
	});

	it("renders smaller diffs immediately", () => {
		renderPane(
			makeDiffFile(
				"src/small.ts",
				GIT_DIFF_LARGE_FILE_LINE_THRESHOLD - 1,
			),
		);

		expect(
			screen.queryByTestId("git-diff-large-guardrail"),
		).not.toBeInTheDocument();
		expect(screen.getByTestId("mock-file-diff")).toHaveTextContent(
			"src/small.ts",
		);
	});
});

describe("gitDiffPane rename display", () => {
	it("shows only previous and current paths for pure renames", () => {
		renderPane(makeRenameOnlyFile());

		expect(screen.getByTestId("git-rename-only-diff")).toBeInTheDocument();
		expect(screen.getByText("Previous path")).toBeInTheDocument();
		expect(screen.getByText("src/old-name.ts")).toBeInTheDocument();
		expect(screen.getByText("Current path")).toBeInTheDocument();
		expect(screen.getByText("src/new-name.ts")).toBeInTheDocument();
		expect(screen.queryByTestId("mock-file-diff")).not.toBeInTheDocument();
	});
});
