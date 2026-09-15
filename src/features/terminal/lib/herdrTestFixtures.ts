import type { HerdrTerminalFrame } from "@/generated";
import dsrDa from "../../../../src-tauri/crates/infra/tests/fixtures/herdr/frames/dsr-da.json";
import fullRedraw from "../../../../src-tauri/crates/infra/tests/fixtures/herdr/frames/full-redraw.json";
import incremental from "../../../../src-tauri/crates/infra/tests/fixtures/herdr/frames/incremental.json";
import type { HerdrFrameView } from "./herdrFrames";

interface FrameRecord {
	seq: number;
	full: boolean;
	width: number;
	height: number;
	bytes: string;
}

function bytesFromBase64(b64: string): number[] {
	const binary = atob(b64);
	const bytes: number[] = [];
	for (let i = 0; i < binary.length; i++) {
		bytes.push(binary.charCodeAt(i));
	}
	return bytes;
}

function frameFromRecord(record: FrameRecord): HerdrFrameView & HerdrTerminalFrame {
	return {
		seq: record.seq,
		full: record.full,
		width: record.width,
		height: record.height,
		bytes: bytesFromBase64(record.bytes),
	};
}

export const herdrFullRedrawFrame = frameFromRecord(
	fullRedraw.record as FrameRecord,
);
export const herdrIncrementalFrame = frameFromRecord(
	incremental.record as FrameRecord,
);

export const herdrDsrDaFixture = dsrDa;

export function latin1(bytes: Uint8Array): string {
	let text = "";
	for (const byte of bytes) {
		text += String.fromCharCode(byte);
	}
	return text;
}
