import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, ProjectWithProfiles } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import ProfileNotesEditor from "./ProfileNotesEditor";

const {
	toasterCreateMock,
	updateProfileNotesMock,
} = vi.hoisted(() => ({
	toasterCreateMock: vi.fn(),
	updateProfileNotesMock: vi.fn(),
}));

vi.mock("@/features/markdown/MarkdownEditor", () => ({
	default: ({
		initialMarkdown,
		onMarkdownChange,
		saveStatus,
	}: {
		initialMarkdown: string;
		onMarkdownChange: (markdown: string) => void;
		saveStatus: string;
	}) => (
		<div>
			<div data-testid="initial-markdown">{initialMarkdown}</div>
			<div data-testid="save-status">{saveStatus}</div>
			<button type="button" onClick={() => onMarkdownChange("A")}>
				Save A
			</button>
			<button type="button" onClick={() => onMarkdownChange("B")}>
				Save B
			</button>
		</div>
	),
}));

vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>(
		"@/generated",
	);
	return {
		...actual,
		updateProfileNotes: updateProfileNotesMock,
	};
});

vi.mock("sonner", () => ({
	toast: {
		error: toasterCreateMock,
		success: toasterCreateMock,
	},
}));

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, reject, resolve };
}

function createProfile(notes: string): Profile {
	return {
		id: "profile-1",
		project_id: "project-1",
		branch_name: "main",
		worktree_path: "/repo",
		created_at: "2026-01-01 00:00:00",
		is_default: true,
		notes,
	};
}

function createProject(profile: Profile): ProjectWithProfiles {
	return {
		id: "project-1",
		name: "Project",
		folder: "/repo",
		created_at: "2026-01-01 00:00:00",
		group_id: null,
		sort_order: 0,
		pinned_at: null,
		pinned_order: null,
		profiles: [profile],
	};
}

function createWrapper(queryClient: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			{children}
		</QueryClientProvider>
	);
}

describe("profileNotesEditor", () => {
	beforeEach(() => {
		toasterCreateMock.mockReset();
		updateProfileNotesMock.mockReset();
	});

	it("ignores stale autosave successes that resolve after newer saves", async () => {
		const initialProfile = createProfile("");
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(queryKeys.projects.all, [
			createProject(initialProfile),
		]);
		const firstSave = createDeferred<Profile>();
		const secondSave = createDeferred<Profile>();
		updateProfileNotesMock
			.mockReturnValueOnce(firstSave.promise)
			.mockReturnValueOnce(secondSave.promise);

		render(<ProfileNotesEditor profile={initialProfile} />, {
			wrapper: createWrapper(queryClient),
		});

		fireEvent.click(screen.getByRole("button", { name: "Save A" }));
		fireEvent.click(screen.getByRole("button", { name: "Save B" }));

		secondSave.resolve(createProfile("B"));
		await waitFor(() => {
			expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
		});
		firstSave.resolve(createProfile("A"));

		await waitFor(() => {
			expect(
				queryClient.getQueryData<ProjectWithProfiles[]>(queryKeys.projects.all)?.[0]
					?.profiles[0]?.notes,
			).toBe("B");
		});

		fireEvent.click(screen.getByRole("button", { name: "Save B" }));
		expect(updateProfileNotesMock).toHaveBeenCalledTimes(2);
	});

	it("ignores stale autosave errors after a newer save succeeds", async () => {
		const initialProfile = createProfile("");
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(queryKeys.projects.all, [
			createProject(initialProfile),
		]);
		const firstSave = createDeferred<Profile>();
		const secondSave = createDeferred<Profile>();
		updateProfileNotesMock
			.mockReturnValueOnce(firstSave.promise)
			.mockReturnValueOnce(secondSave.promise);

		render(<ProfileNotesEditor profile={initialProfile} />, {
			wrapper: createWrapper(queryClient),
		});

		fireEvent.click(screen.getByRole("button", { name: "Save A" }));
		fireEvent.click(screen.getByRole("button", { name: "Save B" }));

		secondSave.resolve(createProfile("B"));
		await waitFor(() => {
			expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
		});
		firstSave.reject(new Error("stale failure"));

		await waitFor(() => {
			expect(toasterCreateMock).not.toHaveBeenCalled();
		});
		expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
	});
});
