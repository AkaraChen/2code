import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import { useTerminalStore } from "./store";
import TerminalLayer from "./TerminalLayer";

const {
	closeTerminalTabMock,
	createTerminalTabMock,
	listProjectsMock,
	profileLayoutProps,
} = vi.hoisted(() => ({
	closeTerminalTabMock: vi.fn(),
	createTerminalTabMock: vi.fn(),
	listProjectsMock: vi.fn(),
	profileLayoutProps: [] as { profileId: string; isActive: boolean }[],
}));

vi.mock("@/generated", () => ({
	listProjects: listProjectsMock,
}));

vi.mock("./state", () => ({
	restorationPromise: Promise.resolve(),
}));

vi.mock("./hooks", () => ({
	useCloseTerminalTab: () => ({ mutate: closeTerminalTabMock }),
	useCreateTerminalTab: () => ({ mutate: createTerminalTabMock }),
}));

vi.mock("@/features/projects/ProfileLayout", () => ({
	default: ({
		children,
		isActive,
		profile,
	}: {
		children: ReactNode;
		isActive: boolean;
		profile: { id: string };
	}) => {
		profileLayoutProps.push({ profileId: profile.id, isActive });
		return <div data-testid={`profile-layout-${profile.id}`}>{children}</div>;
	},
}));

vi.mock("./TerminalTabs", () => ({
	default: ({ isActive, profileId }: { isActive: boolean; profileId: string }) => (
		<div data-active={isActive ? "true" : "false"} data-testid={`tabs-${profileId}`} />
	),
}));

vi.mock("./TerminalFileLinkPickerDialog", () => ({
	TerminalFileLinkPickerDialog: () => null,
}));

function createWrapper(route: string) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});

	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[route]}>
				<Suspense fallback={null}>{children}</Suspense>
			</MemoryRouter>
		</QueryClientProvider>
	);
}

describe("terminalLayer", () => {
	beforeEach(() => {
		closeTerminalTabMock.mockReset();
		createTerminalTabMock.mockReset();
		profileLayoutProps.length = 0;
		listProjectsMock.mockResolvedValue([
			{
				id: "project-1",
				name: "Project",
				folder: "/repo",
				created_at: "2026-01-01 00:00:00",
				group_id: null,
				sort_order: 0,
				pinned_at: null,
				pinned_order: null,
				profiles: [
					{
						id: "profile-1",
						project_id: "project-1",
						branch_name: "main",
						worktree_path: "/repo",
						created_at: "2026-01-01 00:00:00",
						is_default: true,
						notes: "",
					},
					{
						id: "profile-2",
						project_id: "project-1",
						branch_name: "feature",
						worktree_path: "/repo-feature",
						created_at: "2026-01-01 00:00:00",
						is_default: false,
						notes: "",
					},
				],
			},
		]);
		useTerminalStore.setState({
			profiles: {},
			agentStatuses: {},
			agentCompletions: {},
			sessionProfileIds: {},
		});
		useFileViewerTabsStore.setState({ profiles: {} });
	});

	it("marks only the routed profile layout active while keeping other layouts mounted", async () => {
		useTerminalStore.getState().addTab("profile-1", "session-1", "Terminal 1");
		useTerminalStore.getState().addTab("profile-2", "session-2", "Terminal 2");

		await act(async () => {
			render(<TerminalLayer />, {
				wrapper: createWrapper("/projects/project-1/profiles/profile-2"),
			});
		});

		await waitFor(() => {
			expect(profileLayoutProps).toEqual(
				expect.arrayContaining([
					{ profileId: "profile-1", isActive: false },
					{ profileId: "profile-2", isActive: true },
				]),
			);
		});
	});
});
