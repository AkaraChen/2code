import {
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchResult } from "@/generated";
import { useFileSearch } from "./hooks";

const { searchFileMock } = vi.hoisted(() => ({
	searchFileMock: vi.fn(),
}));

vi.mock("@/generated", async () => {
	const actual = await vi.importActual<typeof import("@/generated")>(
		"@/generated",
	);
	return {
		...actual,
		searchFile: searchFileMock,
	};
});

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			{children}
		</QueryClientProvider>
	);
}

describe("useFileSearch", () => {
	beforeEach(() => {
		searchFileMock.mockReset();
	});

	it("keeps previous results only within the same profile", async () => {
		const requests = new Map<string, ReturnType<typeof createDeferred<FileSearchResult[]>>>();
		const firstResults: FileSearchResult[] = [
			{
				name: "main.ts",
				path: "/repo-a/src/main.ts",
				relative_path: "src/main.ts",
			},
		];
		const secondResults: FileSearchResult[] = [
			{
				name: "main.test.ts",
				path: "/repo-a/src/main.test.ts",
				relative_path: "src/main.test.ts",
			},
		];

		searchFileMock.mockImplementation(
			({
				profileId,
				query,
			}: {
				profileId: string;
				query: string;
			}) => {
				const request = createDeferred<FileSearchResult[]>();
				requests.set(`${profileId}:${query}`, request);
				return request.promise;
			},
		);

		const { result, rerender } = renderHook(
			({ profileId, query }) => useFileSearch(profileId, query),
			{
				initialProps: { profileId: "profile-1", query: "main" },
				wrapper: createWrapper(),
			},
		);

		await waitFor(() => {
			expect(searchFileMock).toHaveBeenCalledWith({
				profileId: "profile-1",
				query: "main",
			});
		});

		await act(async () => {
			requests.get("profile-1:main")?.resolve(firstResults);
		});

		await waitFor(() => {
			expect(result.current.data).toEqual(firstResults);
		});

		rerender({ profileId: "profile-1", query: "main." });

		await waitFor(() => {
			expect(searchFileMock).toHaveBeenCalledWith({
				profileId: "profile-1",
				query: "main.",
			});
		});

		expect(result.current.data).toEqual(firstResults);
		expect(result.current.isPlaceholderData).toBe(true);

		await act(async () => {
			requests.get("profile-1:main.")?.resolve(secondResults);
		});

		await waitFor(() => {
			expect(result.current.data).toEqual(secondResults);
		});

		rerender({ profileId: "profile-2", query: "main." });

		await waitFor(() => {
			expect(searchFileMock).toHaveBeenCalledWith({
				profileId: "profile-2",
				query: "main.",
			});
		});

		expect(result.current.data).toBeUndefined();
		expect(result.current.isPending).toBe(true);
	});

	it("clears previous results when the query becomes empty", async () => {
		const firstResults: FileSearchResult[] = [
			{
				name: "README.md",
				path: "/repo-a/README.md",
				relative_path: "README.md",
			},
		];

		searchFileMock.mockResolvedValue(firstResults);

		const { result, rerender } = renderHook(
			({ query }) => useFileSearch("profile-1", query),
			{
				initialProps: { query: "readme" },
				wrapper: createWrapper(),
			},
		);

		await waitFor(() => {
			expect(result.current.data).toEqual(firstResults);
		});

		rerender({ query: "" });

		expect(result.current.data).toBeUndefined();
		expect(result.current.isFetching).toBe(false);
		expect(result.current.isPlaceholderData).toBe(false);
	});
});
