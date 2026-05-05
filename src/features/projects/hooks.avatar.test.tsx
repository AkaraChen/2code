import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as generated from "@/generated";
import {
	clearProjectAvatarCacheForTests,
	getCachedProjectAvatar,
	setCachedProjectAvatar,
} from "./projectAvatarCache";
import { useProjectAvatar } from "./hooks";

const getProjectGithubAvatarMock = vi.spyOn(generated, "getProjectGithubAvatar");

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

describe("useProjectAvatar", () => {
	beforeEach(() => {
		clearProjectAvatarCacheForTests();
		getProjectGithubAvatarMock.mockReset();
	});

	it("uses cached avatar directly and skips a query fetch", async () => {
		setCachedProjectAvatar("project-1", "https://avatars.githubusercontent.com/user-a?v=4");
		getProjectGithubAvatarMock.mockResolvedValue("https://avatars.githubusercontent.com/user-b?v=4");

		const { result } = renderHook(() => useProjectAvatar("project-1"), {
			wrapper: createWrapper(),
		});

		await waitFor(() => {
			expect(result.current.data).toBe("https://avatars.githubusercontent.com/user-a?v=4");
		});

		expect(getProjectGithubAvatarMock).not.toHaveBeenCalled();
		expect(getCachedProjectAvatar("project-1")).toBe(
			"https://avatars.githubusercontent.com/user-a?v=4",
		);
	});

	it("fetches and caches avatar when cache is null (fallback), then uses cached value", async () => {
		setCachedProjectAvatar("project-2", null);
		getProjectGithubAvatarMock.mockResolvedValue("https://avatars.githubusercontent.com/user-fetched?v=4");

		const { result } = renderHook(() => useProjectAvatar("project-2"), {
			wrapper: createWrapper(),
		});

		await waitFor(() => {
			expect(getProjectGithubAvatarMock).toHaveBeenCalledWith({
				projectId: "project-2",
			});
		});

		await waitFor(() => {
			expect(result.current.data).toBe("https://avatars.githubusercontent.com/user-fetched?v=4");
		});

		expect(getCachedProjectAvatar("project-2")).toBe(
			"https://avatars.githubusercontent.com/user-fetched?v=4",
		);
	});

	it("fetches and caches avatar when there is no cache", async () => {
		getProjectGithubAvatarMock.mockResolvedValue("https://avatars.githubusercontent.com/user-missing?v=4");

		const { result } = renderHook(() => useProjectAvatar("project-3"), {
			wrapper: createWrapper(),
		});

		await waitFor(() => {
			expect(getProjectGithubAvatarMock).toHaveBeenCalledWith({
				projectId: "project-3",
			});
		});

		await waitFor(() => {
			expect(result.current.data).toBe("https://avatars.githubusercontent.com/user-missing?v=4");
		});
	});

	it("does not fetch avatar when enabled is false", async () => {
		getProjectGithubAvatarMock.mockResolvedValue(
			"https://avatars.githubusercontent.com/user-disabled?v=4",
		);

		const { result } = renderHook(
			() => useProjectAvatar("project-4", { enabled: false }),
			{
				wrapper: createWrapper(),
			},
		);

		await Promise.resolve();
		expect(result.current.data).toBeUndefined();
		expect(getProjectGithubAvatarMock).not.toHaveBeenCalled();
	});
});
