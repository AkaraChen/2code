import { concatBytes } from "../overlap";

export const LIVE_OUTPUT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
export const LIVE_OUTPUT_FALLBACK_FLUSH_MS = 50;
export const LIVE_OUTPUT_MAX_WRITE_CHUNK_BYTES = 512 * 1024;

export interface LiveOutputQueueOptions {
	write: (data: Uint8Array, onDone?: () => void) => void;
	onFlushed?: () => void;
	maxBufferedBytes?: number;
	maxWriteChunkBytes?: number;
	fallbackFlushMs?: number;
	requestFrame?: (callback: FrameRequestCallback) => number;
	cancelFrame?: (id: number) => void;
	setTimer?: (callback: () => void, ms: number) => number;
	clearTimer?: (id: number) => void;
}

export class LiveOutputQueue {
	private readonly write: (data: Uint8Array, onDone?: () => void) => void;
	private readonly onFlushed?: () => void;
	private readonly maxBufferedBytes: number;
	private readonly maxWriteChunkBytes: number;
	private readonly fallbackFlushMs: number;
	private readonly requestFrame: (callback: FrameRequestCallback) => number;
	private readonly cancelFrame: (id: number) => void;
	private readonly setTimer: (callback: () => void, ms: number) => number;
	private readonly clearTimer: (id: number) => void;
	private readonly encoder = new TextEncoder();
	private chunks: Uint8Array[] = [];
	private bufferedBytes = 0;
	private droppedBytes = 0;
	private frameId: number | null = null;
	private timerId: number | null = null;
	private disposed = false;

	constructor(options: LiveOutputQueueOptions) {
		this.write = options.write;
		this.onFlushed = options.onFlushed;
		this.maxBufferedBytes =
			options.maxBufferedBytes ?? LIVE_OUTPUT_MAX_BUFFERED_BYTES;
		this.maxWriteChunkBytes =
			options.maxWriteChunkBytes ?? LIVE_OUTPUT_MAX_WRITE_CHUNK_BYTES;
		this.fallbackFlushMs =
			options.fallbackFlushMs ?? LIVE_OUTPUT_FALLBACK_FLUSH_MS;
		this.requestFrame =
			options.requestFrame ?? window.requestAnimationFrame.bind(window);
		this.cancelFrame =
			options.cancelFrame ?? window.cancelAnimationFrame.bind(window);
		this.setTimer = options.setTimer ?? window.setTimeout.bind(window);
		this.clearTimer = options.clearTimer ?? window.clearTimeout.bind(window);
	}

	push(chunk: Uint8Array): void {
		if (this.disposed || chunk.length === 0) return;
		this.chunks.push(chunk);
		this.bufferedBytes += chunk.length;
		while (
			this.bufferedBytes > this.maxBufferedBytes
			&& this.chunks.length > 1
		) {
			const dropped = this.chunks.shift() as Uint8Array;
			this.bufferedBytes -= dropped.length;
			this.droppedBytes += dropped.length;
		}
		this.scheduleFlush();
	}

	flushNow(): void {
		this.cancelScheduled();
		if (this.disposed || this.chunks.length === 0) return;

		const pending = this.chunks;
		this.chunks = [];
		this.bufferedBytes = 0;

		if (this.droppedBytes > 0) {
			const droppedKib = Math.ceil(this.droppedBytes / 1024);
			this.droppedBytes = 0;
			pending.unshift(
				this.encoder.encode(
					`\x1B[0m\r\n\x1B[90m[2code: dropped ${droppedKib} KiB of output while the window was hidden]\x1B[0m\r\n`,
				),
			);
		}

		const slices = this.buildWriteSlices(pending);
		for (let index = 0; index < slices.length; index += 1) {
			this.write(
				slices[index] as Uint8Array,
				index === slices.length - 1 ? this.onFlushed : undefined,
			);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.cancelScheduled();
		this.chunks = [];
		this.bufferedBytes = 0;
		this.droppedBytes = 0;
	}

	private scheduleFlush(): void {
		if (this.frameId === null) {
			this.frameId = this.requestFrame(() => {
				this.frameId = null;
				this.flushNow();
			});
		}
		if (this.timerId === null) {
			this.timerId = this.setTimer(() => {
				this.timerId = null;
				this.flushNow();
			}, this.fallbackFlushMs);
		}
	}

	private cancelScheduled(): void {
		if (this.frameId !== null) {
			this.cancelFrame(this.frameId);
			this.frameId = null;
		}
		if (this.timerId !== null) {
			this.clearTimer(this.timerId);
			this.timerId = null;
		}
	}

	private buildWriteSlices(chunks: readonly Uint8Array[]): Uint8Array[] {
		const slices: Uint8Array[] = [];
		let current: Uint8Array[] = [];
		let currentBytes = 0;

		for (const chunk of chunks) {
			if (
				currentBytes > 0
				&& currentBytes + chunk.length > this.maxWriteChunkBytes
			) {
				slices.push(concatBytes(current));
				current = [];
				currentBytes = 0;
			}
			current.push(chunk);
			currentBytes += chunk.length;
		}

		if (currentBytes > 0) {
			slices.push(concatBytes(current));
		}
		return slices;
	}
}
