import { ChakraProvider } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSystem } from "@/theme/system";
import { initialState } from "../gitDiffReducer";
import GitDiffContent from "./GitDiffContent";

const mocks = vi.hoisted(() => ({
	diffFiles: [] as FileDiffMetadata[],
	openFile: vi.fn(),
	commit: vi.fn(),
	discard: vi.fn(),
	push: vi.fn(),
}));

vi.mock("@/features/projects/fileViewerTabsStore", () => ({
	useFileViewerTabsStore: (selector: (store: { openFile: typeof mocks.openFile }) => unknown) =>
		selector({ openFile: mocks.openFile }),
}));

vi.mock("@pierre/diffs/react", () => ({
	FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => (
		<div data-testid="mock-file-diff">{fileDiff.name}</div>
	),
}));

vi.mock("@/shared/components/OverflowTooltipText", () => ({
	default: ({ displayValue }: { displayValue: string }) => (
		<span>{displayValue}</span>
	),
}));

vi.mock("../hooks", () => ({
	useGitDiffFiles: () => mocks.diffFiles,
	useGitLog: () => ({ data: [] }),
	useCommitGitChanges: () => ({ mutateAsync: mocks.commit, isPending: false }),
	useDiscardGitFileChanges: () => ({ mutateAsync: mocks.discard }),
	useGitAheadCount: () => 0,
	useGitPush: () => ({ mutateAsync: mocks.push, isPending: false }),
}));

function makeFile(name: string): FileDiffMetadata {
	return {
		name,
		type: "change",
		hunks: [],
	} as unknown as FileDiffMetadata;
}

function renderContent() {
	return render(
		<ChakraProvider value={appSystem}>
			<GitDiffContent
				profileId="profile-1"
				worktreePath="/repo"
				onClose={vi.fn()}
				state={initialState}
				dispatch={vi.fn()}
				options={{}}
			/>
		</ChakraProvider>,
	);
}

async function expectIncludedStates(states: boolean[]) {
	await waitFor(() => {
		const checkboxes = screen.getAllByRole<HTMLInputElement>("checkbox");
		expect(checkboxes).toHaveLength(states.length);
		for (const [index, checked] of states.entries()) {
			expect(checkboxes[index].checked).toBe(checked);
		}
	});
}

describe("git diff content included file reconciliation", () => {
	beforeEach(() => {
		Element.prototype.scrollIntoView = vi.fn();
		mocks.diffFiles = [];
		mocks.openFile.mockReset();
		mocks.commit.mockReset();
		mocks.discard.mockReset();
		mocks.push.mockReset();
	});

	it("keeps manual exclusions across rerenders and includes newly added files", async () => {
		mocks.diffFiles = [makeFile("a.ts"), makeFile("b.ts")];
		const view = renderContent();

		await expectIncludedStates([true, true]);

		fireEvent.click(screen.getAllByRole("checkbox")[0]);
		await expectIncludedStates([false, true]);

		view.rerender(
			<ChakraProvider value={appSystem}>
				<GitDiffContent
					profileId="profile-1"
					worktreePath="/repo"
					onClose={vi.fn()}
					state={initialState}
					dispatch={vi.fn()}
					options={{}}
				/>
			</ChakraProvider>,
		);
		await expectIncludedStates([false, true]);

		mocks.diffFiles = [
			makeFile("a.ts"),
			makeFile("b.ts"),
			makeFile("c.ts"),
		];
		view.rerender(
			<ChakraProvider value={appSystem}>
				<GitDiffContent
					profileId="profile-1"
					worktreePath="/repo"
					onClose={vi.fn()}
					state={initialState}
					dispatch={vi.fn()}
					options={{}}
				/>
			</ChakraProvider>,
		);

		await expectIncludedStates([false, true, true]);
	});
});
