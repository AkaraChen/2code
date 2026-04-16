import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHorizontalResize } from "./useHorizontalResize";

function createPointerEvent(type: string, clientX: number) {
	const event = new Event(type) as PointerEvent;
	Object.defineProperty(event, "clientX", {
		value: clientX,
		enumerable: true,
	});
	return event;
}

describe("useHorizontalResize", () => {
	beforeEach(() => {
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	});

	it("adjusts width from keyboard input and clamps to the provided bounds", () => {
		const onChange = vi.fn();
		const { result } = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 240,
				step: 20,
				onChange,
			}),
		);

		const preventDefault = vi.fn();
		act(() => {
			result.current.handleKeyDown({
				key: "ArrowRight",
				preventDefault,
			} as never);
		});
		act(() => {
			result.current.handleKeyDown({
				key: "Home",
				preventDefault,
			} as never);
		});
		act(() => {
			result.current.handleKeyDown({
				key: "End",
				preventDefault,
			} as never);
		});
		act(() => {
			result.current.handleKeyDown({
				key: "ArrowLeft",
				preventDefault,
			} as never);
		});

		expect(onChange.mock.calls).toEqual([
			[220],
			[160],
			[240],
			[180],
		]);
		expect(preventDefault).toHaveBeenCalledTimes(4);
	});

	it("tracks pointer dragging and restores body styles when the drag stops", () => {
		const onChange = vi.fn();
		const { result } = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 260,
				onChange,
			}),
		);

		const preventDefault = vi.fn();
		act(() => {
			result.current.handlePointerDown({
				button: 0,
				clientX: 50,
				preventDefault,
			} as never);
		});

		expect(result.current.isDragging).toBe(true);
		expect(document.body.style.cursor).toBe("col-resize");
		expect(document.body.style.userSelect).toBe("none");
		expect(preventDefault).toHaveBeenCalled();

		act(() => {
			window.dispatchEvent(createPointerEvent("pointermove", 95));
		});
		expect(onChange).toHaveBeenLastCalledWith(245);

		act(() => {
			window.dispatchEvent(createPointerEvent("pointermove", 140));
		});
		expect(onChange).toHaveBeenLastCalledWith(260);

		act(() => {
			window.dispatchEvent(new Event("pointerup"));
		});

		expect(result.current.isDragging).toBe(false);
		expect(document.body.style.cursor).toBe("");
		expect(document.body.style.userSelect).toBe("");
	});

	it("ignores drag and keyboard input when disabled or when a non-primary pointer starts the drag", () => {
		const onChange = vi.fn();
		const { result } = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 260,
				disabled: true,
				onChange,
			}),
		);

		act(() => {
			result.current.handlePointerDown({
				button: 0,
				clientX: 50,
				preventDefault: vi.fn(),
			} as never);
			result.current.handleKeyDown({
				key: "ArrowRight",
				preventDefault: vi.fn(),
			} as never);
		});
		expect(result.current.isDragging).toBe(false);
		expect(onChange).not.toHaveBeenCalled();

		const enabled = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 260,
				onChange,
			}),
		);
		act(() => {
			enabled.result.current.handlePointerDown({
				button: 1,
				clientX: 50,
				preventDefault: vi.fn(),
			} as never);
		});
		expect(enabled.result.current.isDragging).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});
});
