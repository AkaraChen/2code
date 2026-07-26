import { describe, expect, it, vi } from "vitest";
import { LiveOutputQueue } from "./liveOutputQueue";

function bytes(values: number[]) {
	return new Uint8Array(values);
}

function repeated(value: number, length: number) {
	return new Uint8Array(length).fill(value);
}

function createHarness(
	options: {
		maxBufferedBytes?: number;
		maxWriteChunkBytes?: number;
		autoCompleteWrites?: boolean;
	} = {},
) {
	let frameCallback: FrameRequestCallback | null = null;
	let timerCallback: (() => void) | null = null;
	const writes: { data: Uint8Array; onDone?: () => void }[] = [];
	const onFlushed = vi.fn();
	const cancelFrame = vi.fn();
	const clearTimer = vi.fn();
	const requestFrame = vi.fn((callback: FrameRequestCallback) => {
		frameCallback = callback;
		return 1;
	});
	const setTimer = vi.fn((callback: () => void) => {
		timerCallback = callback;
		return 2;
	});
	const queue = new LiveOutputQueue({
		write: (data, onDone) => {
			writes.push({ data, onDone });
			if (options.autoCompleteWrites) onDone?.();
		},
		onFlushed,
		maxBufferedBytes: options.maxBufferedBytes,
		maxWriteChunkBytes: options.maxWriteChunkBytes,
		requestFrame,
		cancelFrame,
		setTimer,
		clearTimer,
	});

	return {
		queue,
		writes,
		onFlushed,
		requestFrame,
		cancelFrame,
		setTimer,
		clearTimer,
		fireFrame: () => frameCallback?.(0),
		fireTimer: () => timerCallback?.(),
	};
}

describe("live output queue", () => {
	it("flushes queued chunks on the animation frame path", () => {
		const harness = createHarness();

		harness.queue.push(bytes([1, 2]));
		harness.queue.push(bytes([3]));
		harness.fireFrame();

		expect(harness.writes).toHaveLength(1);
		expect([...harness.writes[0]!.data]).toEqual([1, 2, 3]);
		expect(harness.writes[0]!.onDone).toBe(harness.onFlushed);
		expect(harness.clearTimer).toHaveBeenCalledWith(2);
	});

	it("flushes from the fallback timer when frames do not run", () => {
		const harness = createHarness({ autoCompleteWrites: true });

		harness.queue.push(bytes([4, 5]));
		harness.fireTimer();

		expect(harness.writes).toHaveLength(1);
		expect([...harness.writes[0]!.data]).toEqual([4, 5]);
		expect(harness.cancelFrame).toHaveBeenCalledWith(1);
		expect(harness.onFlushed).toHaveBeenCalledTimes(1);
	});

	it("does not flush twice when the slower scheduler fires later", () => {
		const harness = createHarness();

		harness.queue.push(bytes([1]));
		harness.fireFrame();
		harness.fireTimer();

		expect(harness.writes).toHaveLength(1);
		expect(harness.clearTimer).toHaveBeenCalledWith(2);
	});

	it("drops oldest whole chunks after the byte cap", () => {
		const harness = createHarness({ maxBufferedBytes: 8192 });

		harness.queue.push(repeated(1, 4096));
		harness.queue.push(repeated(2, 4096));
		harness.queue.push(repeated(3, 4096));
		harness.queue.flushNow();

		expect(harness.writes).toHaveLength(1);
		const output = harness.writes[0]!.data;
		const notice = new TextDecoder().decode(output.subarray(0, 96));
		expect(notice).toContain("dropped 4 KiB");
		const tail = output.subarray(output.length - 8192);
		expect([...tail.subarray(0, 4096)]).toEqual([...repeated(2, 4096)]);
		expect([...tail.subarray(4096)]).toEqual([...repeated(3, 4096)]);
	});

	it("writes large flushes in bounded slices at chunk boundaries", () => {
		const harness = createHarness({ maxWriteChunkBytes: 8192 });

		for (let index = 0; index < 5; index += 1) {
			harness.queue.push(repeated(index, 4096));
		}
		harness.queue.flushNow();

		expect(harness.writes.map((write) => write.data.length)).toEqual([
			8192,
			8192,
			4096,
		]);
		expect(harness.writes[0]!.onDone).toBeUndefined();
		expect(harness.writes[1]!.onDone).toBeUndefined();
		expect(harness.writes[2]!.onDone).toBe(harness.onFlushed);
	});

	it("does not split one oversized input chunk", () => {
		const harness = createHarness({ maxWriteChunkBytes: 8192 });

		harness.queue.push(repeated(7, 10_000));
		harness.queue.flushNow();

		expect(harness.writes.map((write) => write.data.length)).toEqual([
			10_000,
		]);
	});

	it("dispose cancels schedulers and prevents later writes", () => {
		const harness = createHarness();

		harness.queue.push(bytes([1]));
		harness.queue.dispose();
		harness.queue.flushNow();
		harness.queue.push(bytes([2]));

		expect(harness.cancelFrame).toHaveBeenCalledWith(1);
		expect(harness.clearTimer).toHaveBeenCalledWith(2);
		expect(harness.writes).toHaveLength(0);
	});

	it("ignores empty chunks", () => {
		const harness = createHarness();

		harness.queue.push(new Uint8Array(0));

		expect(harness.requestFrame).not.toHaveBeenCalled();
		expect(harness.setTimer).not.toHaveBeenCalled();
	});
});
