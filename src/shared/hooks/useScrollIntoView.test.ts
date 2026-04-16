import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScrollIntoView } from "./useScrollIntoView";

describe("useScrollIntoView", () => {
	it("scrolls the matching child into view when the index changes", () => {
		const scrollIntoView = vi.fn();
		const container = document.createElement("div");
		const first = document.createElement("div");
		first.dataset.index = "0";
		const second = document.createElement("div");
		second.dataset.index = "1";
		second.scrollIntoView = scrollIntoView;
		container.append(first, second);

		const { result, rerender } = renderHook(
			({ index }) => useScrollIntoView<HTMLDivElement>(index),
			{
				initialProps: { index: 0 },
			},
		);

		act(() => {
			result.current.ref.current = container;
		});

		rerender({ index: 1 });

		expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
	});

	it("does nothing when the target child is missing", () => {
		const container = document.createElement("div");
		const child = document.createElement("div");
		child.dataset.index = "0";
		child.scrollIntoView = vi.fn();
		container.append(child);

		const { result, rerender } = renderHook(
			({ index }) => useScrollIntoView<HTMLDivElement>(index),
			{
				initialProps: { index: 0 },
			},
		);

		act(() => {
			result.current.ref.current = container;
		});

		expect(() => rerender({ index: 5 })).not.toThrow();
		expect(child.scrollIntoView).not.toHaveBeenCalled();
	});
});
