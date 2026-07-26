import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHorizontalResize } from "./useHorizontalResize";

let rafQueue: Array<FrameRequestCallback | null> = [];

function flushFrames() {
	const queue = rafQueue;
	rafQueue = [];
	for (const callback of queue) {
		callback?.(performance.now());
	}
}

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
		rafQueue = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			rafQueue.push(callback);
			return rafQueue.length;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => {
			rafQueue[id - 1] = null;
		});
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("adjusts width from keyboard input and clamps to the provided bounds", () => {
		const onChange = vi.fn();
		const onCommit = vi.fn();
		const { result } = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 240,
				step: 20,
				onChange,
				onCommit,
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
		expect(onCommit.mock.calls).toEqual([
			[220],
			[160],
			[240],
			[180],
		]);
		expect(preventDefault).toHaveBeenCalledTimes(4);
	});

	it("tracks pointer dragging and restores body styles when the drag stops", () => {
		const onChange = vi.fn();
		const onCommit = vi.fn();
		const { result } = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 260,
				onChange,
				onCommit,
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
		expect(onChange).not.toHaveBeenCalled();
		act(() => {
			flushFrames();
		});
		expect(onChange).toHaveBeenLastCalledWith(245);

		act(() => {
			window.dispatchEvent(createPointerEvent("pointermove", 140));
		});
		act(() => {
			flushFrames();
		});
		expect(onChange).toHaveBeenLastCalledWith(260);

		act(() => {
			window.dispatchEvent(new Event("pointerup"));
		});

		expect(result.current.isDragging).toBe(false);
		expect(document.body.style.cursor).toBe("");
		expect(document.body.style.userSelect).toBe("");
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenLastCalledWith(260);
	});

	it("coalesces pointer moves to one frame with the latest value", () => {
		const onChange = vi.fn();
		const { result } = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 260,
				onChange,
			}),
		);

		act(() => {
			result.current.handlePointerDown({
				button: 0,
				clientX: 50,
				preventDefault: vi.fn(),
			} as never);
			window.dispatchEvent(createPointerEvent("pointermove", 70));
			window.dispatchEvent(createPointerEvent("pointermove", 95));
			window.dispatchEvent(createPointerEvent("pointermove", 140));
		});

		expect(onChange).not.toHaveBeenCalled();

		act(() => {
			flushFrames();
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith(260);
	});

	it("flushes and commits the pending pointer value when dragging stops", () => {
		const onChange = vi.fn();
		const onCommit = vi.fn();
		const { result } = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 260,
				onChange,
				onCommit,
			}),
		);

		act(() => {
			result.current.handlePointerDown({
				button: 0,
				clientX: 50,
				preventDefault: vi.fn(),
			} as never);
			window.dispatchEvent(createPointerEvent("pointermove", 140));
			window.dispatchEvent(new Event("pointerup"));
		});

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenLastCalledWith(260);
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenLastCalledWith(260);
	});

	it("commits the starting value when a pointer drag ends without moving", () => {
		const onChange = vi.fn();
		const onCommit = vi.fn();
		const { result } = renderHook(() =>
			useHorizontalResize({
				value: 200,
				min: 160,
				max: 260,
				onChange,
				onCommit,
			}),
		);

		act(() => {
			result.current.handlePointerDown({
				button: 0,
				clientX: 50,
				preventDefault: vi.fn(),
			} as never);
			window.dispatchEvent(new Event("pointerup"));
		});

		expect(onChange).not.toHaveBeenCalled();
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenLastCalledWith(200);
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
