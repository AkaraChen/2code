import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "@/features/projects/fileViewerTabsStore";
import {
	createFileTreeTerminalDropPayload,
	writeFileTreeTerminalDropPayload,
} from "@/shared/lib/fileTreeTerminalDrop";
import { writeToPty } from "@/generated";
import TerminalTabs from "./TerminalTabs";
import { useTerminalStore } from "./store";

const { restorePendingTerminalTabMock, terminalRenderCounts } = vi.hoisted(() => ({
	restorePendingTerminalTabMock: vi.fn(),
	terminalRenderCounts: new Map<string, number>(),
}));

vi.mock("./Terminal", async () => {
	const { memo } = await import("react");

	return {
		Terminal: memo(({
			sessionId,
			isActive,
		}: {
			sessionId: string;
			isActive: boolean;
		}) => {
			terminalRenderCounts.set(
				sessionId,
				(terminalRenderCounts.get(sessionId) ?? 0) + 1,
			);
			return (
				<div
					data-active={isActive ? "true" : "false"}
					data-testid={`terminal-${sessionId}`}
				/>
			);
		}),
	};
});

vi.mock("./restoration", () => ({
	restorePendingTerminalTab: restorePendingTerminalTabMock,
}));

vi.mock("./TerminalTemplateMenu", () => ({
	default: () => <div data-testid="terminal-template-menu" />,
}));

vi.mock("@/features/projects/UnsavedFileCloseDialog", () => ({
	default: () => null,
}));

const writeToPtyMock = writeToPty as unknown as Mock;
const profileId = "profile-1";

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<>{children}</>
		</QueryClientProvider>
	);
}

function createTestDataTransfer(): DataTransfer {
	const data = new Map<string, string>();
	const types: string[] = [];
	const transfer = {
		dropEffect: "none",
		effectAllowed: "uninitialized",
		files: [] as unknown as FileList,
		items: [] as unknown as DataTransferItemList,
		types,
		clearData: vi.fn((format?: string) => {
			if (format) {
				data.delete(format);
				const index = types.indexOf(format);
				if (index >= 0) types.splice(index, 1);
			} else {
				data.clear();
				types.splice(0);
			}
		}),
		getData: vi.fn((format: string) => data.get(format) ?? ""),
		setData: vi.fn((format: string, value: string) => {
			data.set(format, value);
			if (!types.includes(format)) types.push(format);
		}),
		setDragImage: vi.fn(),
	} as unknown as DataTransfer;
	return transfer;
}

function createFileTreeDrop(paths: string[]) {
	const dataTransfer = createTestDataTransfer();
	writeFileTreeTerminalDropPayload(
		dataTransfer,
		createFileTreeTerminalDropPayload({
			profileId,
			rootPath: "/root",
			relativePaths: paths.map((path) => path.replace("/root/", "")),
			absolutePaths: paths,
		}),
	);
	return dataTransfer;
}

function renderTerminalTabs(
	options: { isActive?: boolean; profileId?: string } = {},
) {
	const targetProfileId = options.profileId ?? profileId;
	return render(
		<TerminalTabs
			projectId="project-1"
			profileId={targetProfileId}
			cwd="/root"
			isActive={options.isActive ?? true}
		/>,
		{ wrapper: createWrapper() },
	);
}

describe("terminalTabs file tree drops", () => {
	beforeEach(() => {
		useTerminalStore.setState({
			profiles: {},
			agentStatuses: {},
			agentCompletions: {},
			sessionProfileIds: {},
		});
		useFileViewerTabsStore.setState({ profiles: {} });
		useFileViewerDirtyStore.setState({
			profiles: {},
			drafts: {},
			savedValues: {},
		});
		writeToPtyMock.mockClear();
		writeToPtyMock.mockResolvedValue(undefined);
		restorePendingTerminalTabMock.mockReset();
		restorePendingTerminalTabMock.mockReturnValue(new Promise(() => {}));
		terminalRenderCounts.clear();
	});

	it("activates the dropped terminal tab and writes dropped paths to its PTY", async () => {
		useTerminalStore.getState().addTab(profileId, "session-1", "Terminal 1");
		useTerminalStore.getState().addTab(profileId, "session-2", "Terminal 2");
		useTerminalStore.getState().setActiveTab(profileId, "session-1");
		useFileViewerTabsStore.getState().openFile(profileId, "/root/src/App.tsx");
		renderTerminalTabs();

		const dataTransfer = createFileTreeDrop([
			"/root/src/index.ts",
			"/root/src/components",
		]);
		const terminalTab = screen.getByRole("tab", { name: /Terminal 2/ });

		fireEvent.dragOver(terminalTab, { dataTransfer });
		fireEvent.drop(terminalTab, { dataTransfer });

		await waitFor(() => {
			expect(writeToPtyMock).toHaveBeenCalledWith({
				sessionId: "session-2",
				data: "/root/src/index.ts /root/src/components",
			});
		});
		expect(useTerminalStore.getState().profiles[profileId].activeTabId).toBe(
			"session-2",
		);
		expect(
			useFileViewerTabsStore.getState().profiles[profileId]?.fileTabActive,
		).toBe(false);
		expect(screen.getByTestId("terminal-session-2")).toHaveAttribute(
			"data-active",
			"true",
		);
	});

	it("keeps terminal instances mounted but inactive when the profile is hidden", () => {
		useTerminalStore.getState().addTab(profileId, "session-1", "Terminal 1");
		useTerminalStore.getState().setActiveTab(profileId, "session-1");

		renderTerminalTabs({ isActive: false });

		expect(screen.getByTestId("terminal-session-1")).toHaveAttribute(
			"data-active",
			"false",
		);
	});

	it("restores an active pending tab without mounting a terminal for the old session", () => {
		useTerminalStore.getState().addRestoringTab(
			profileId,
			"old-session",
			"Terminal 1",
			{
				oldSessionId: "old-session",
				shell: "/bin/zsh",
				cwd: "/root",
				rows: 24,
				cols: 80,
			},
		);

		renderTerminalTabs();

		expect(restorePendingTerminalTabMock).toHaveBeenCalledTimes(1);
		expect(screen.queryByTestId("terminal-old-session")).not.toBeInTheDocument();
	});

	it("does not restore pending tabs while the profile is hidden", () => {
		useTerminalStore.getState().addRestoringTab(
			profileId,
			"old-session",
			"Terminal 1",
			{
				oldSessionId: "old-session",
				shell: "/bin/zsh",
				cwd: "/root",
				rows: 24,
				cols: 80,
			},
		);

		renderTerminalTabs({ isActive: false });

		expect(restorePendingTerminalTabMock).not.toHaveBeenCalled();
		expect(screen.queryByTestId("terminal-old-session")).not.toBeInTheDocument();
	});

	it("renders running status as a breathing dot without label text", () => {
		useTerminalStore.getState().addTab(profileId, "session-1", "Terminal 1");
		useTerminalStore.getState().setAgentStatus("session-1", "running");

		const { container } = renderTerminalTabs();

		const dot = container.querySelector('[data-agent-status="running"]');
		expect(dot).toBeInTheDocument();
		expect(dot).toHaveClass("agent-status-dot--running");
		expect(screen.queryByText("Working")).not.toBeInTheDocument();
	});

	it("renders waiting status as a yellow dot without label text", () => {
		useTerminalStore.getState().addTab(profileId, "session-1", "Terminal 1");
		useTerminalStore.getState().setAgentStatus("session-1", "waiting");

		const { container } = renderTerminalTabs();

		const dot = container.querySelector('[data-agent-status="waiting"]');
		expect(dot).toBeInTheDocument();
		expect(dot).toHaveClass("bg-yellow-400");
		expect(screen.queryByText("Needs input")).not.toBeInTheDocument();
	});

	it("does not re-render other profiles or terminal children for one tab status change", () => {
		const otherProfileId = "profile-2";
		useTerminalStore.getState().addTab(profileId, "session-1", "Terminal 1");
		useTerminalStore.getState().addTab(
			otherProfileId,
			"session-2",
			"Terminal 2",
		);
		const own = renderTerminalTabs();
		let otherCommits = 0;
		const other = render(
			<Profiler id="other-profile" onRender={() => { otherCommits += 1; }}>
				<TerminalTabs
					projectId="project-1"
					profileId={otherProfileId}
					cwd="/root"
				/>
			</Profiler>,
			{ wrapper: createWrapper() },
		);
		const ownTerminalRenders = terminalRenderCounts.get("session-1") ?? 0;
		const otherTerminalRenders = terminalRenderCounts.get("session-2") ?? 0;
		const otherProfileCommits = otherCommits;

		act(() => {
			useTerminalStore.getState().setAgentStatus("session-1", "running");
		});

		expect(
			own.container.querySelector('[data-agent-status="running"]'),
		).toBeInTheDocument();
		expect(
			other.container.querySelector('[data-agent-status="running"]'),
		).not.toBeInTheDocument();
		expect(terminalRenderCounts.get("session-1")).toBe(ownTerminalRenders);
		expect(terminalRenderCounts.get("session-2")).toBe(otherTerminalRenders);
		expect(otherCommits).toBe(otherProfileCommits);
	});

	it("renders a dismissable completion notification after running becomes idle", async () => {
		useTerminalStore.getState().addTab(profileId, "session-1", "Terminal 1");
		useTerminalStore.getState().setAgentStatus("session-1", "running");
		useTerminalStore.getState().setAgentStatus("session-1", "idle");

		const { container } = renderTerminalTabs();

		const dot = container.querySelector('[data-agent-status="completed"]');
		expect(dot).toBeInTheDocument();
		expect(dot).toHaveClass("bg-green-500");

		fireEvent.click(screen.getByLabelText("Dismiss completion notification"));

		await waitFor(() => {
			expect(
				container.querySelector('[data-agent-status="completed"]'),
			).not.toBeInTheDocument();
		});
		expect(useTerminalStore.getState().agentCompletions["session-1"]).toBeUndefined();
	});
});
