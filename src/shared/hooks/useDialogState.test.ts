import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDialogState } from "./useDialogState";

describe("useDialogState", () => {
	it("defaults to closed when no initial state is provided", () => {
		const { result } = renderHook(() => useDialogState());
		expect(result.current.isOpen).toBe(false);
	});

	it("supports an initially open dialog", () => {
		const { result } = renderHook(() => useDialogState(true));
		expect(result.current.isOpen).toBe(true);
	});

	it("opens and closes the dialog through the returned handlers", () => {
		const { result } = renderHook(() => useDialogState());

		act(() => {
			result.current.onOpen();
		});
		expect(result.current.isOpen).toBe(true);

		act(() => {
			result.current.onClose();
		});
		expect(result.current.isOpen).toBe(false);
	});
});
