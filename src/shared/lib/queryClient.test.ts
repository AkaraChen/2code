import { describe, expect, it } from "vitest";
import { queryClient } from "./queryClient";

describe("queryClient", () => {
	it("disables refetch-on-focus and retries queries once by default", () => {
		const queryDefaults = queryClient.getDefaultOptions().queries;
		expect(queryDefaults?.refetchOnWindowFocus).toBe(false);
		expect(queryDefaults?.retry).toBe(1);
	});

	it("marks queries fresh for 30 seconds by default", () => {
		expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(30_000);
	});
});
