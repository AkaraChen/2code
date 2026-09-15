import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HerdrTerminalFrame } from "@/generated";
import {
	resolveTerminalTransportKind,
	startHerdrFrameStream,
	startLocalByteStream,
	transportKindFromBackend,
} from "./terminalTransport";

const {
	getSessionBackend,
	streamHerdrOutput,
	streamPtyOutput,
} = vi.hoisted(() => ({
	getSessionBackend: vi.fn(),
	streamHerdrOutput: vi.fn(() => Promise.resolve()),
	streamPtyOutput: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/generated", () => ({
	getSessionBackend,
	streamHerdrOutput,
	streamPtyOutput,
}));

beforeEach(() => {
	getSessionBackend.mockReset();
	streamHerdrOutput.mockReset();
	streamHerdrOutput.mockResolvedValue(undefined);
	streamPtyOutput.mockReset();
	streamPtyOutput.mockResolvedValue(undefined);
});

describe("transportKindFromBackend", () => {
	it("maps only herdr to the Herdr stream", () => {
		expect(transportKindFromBackend("herdr")).toBe("herdr");
		expect(transportKindFromBackend("local")).toBe("local");
	});
});

describe("resolveTerminalTransportKind", () => {
	it("uses per-session backend_for IPC, not selected_backend", async () => {
		getSessionBackend.mockResolvedValueOnce("herdr");
		await expect(resolveTerminalTransportKind("sess-h")).resolves.toBe(
			"herdr",
		);
		expect(getSessionBackend).toHaveBeenCalledWith({ sessionId: "sess-h" });
		getSessionBackend.mockResolvedValueOnce("local");
		await expect(resolveTerminalTransportKind("sess-l")).resolves.toBe(
			"local",
		);
	});
});

describe("byte vs frame streams", () => {
	it("never starts a Herdr frame stream for a Local-owned id", () => {
		startLocalByteStream({
			sessionId: "local-1",
			streamId: "s1",
			onBytes: () => {},
		});
		expect(streamPtyOutput).toHaveBeenCalledTimes(1);
		expect(streamHerdrOutput).not.toHaveBeenCalled();
	});

	it("never starts a Local byte stream for a Herdr-owned id", () => {
		startHerdrFrameStream({
			sessionId: "herdr-1",
			streamId: "s1",
			onFrame: () => {},
		});
		expect(streamHerdrOutput).toHaveBeenCalledTimes(1);
		expect(streamPtyOutput).not.toHaveBeenCalled();
	});

	it("delivers Herdr frames as objects, not Local ArrayBuffer chunks", () => {
		const frames: HerdrTerminalFrame[] = [];
		startHerdrFrameStream({
			sessionId: "herdr-1",
			streamId: "s1",
			onFrame: (frame) => {
				frames.push(frame);
			},
		});
		const channel = streamHerdrOutput.mock.calls[0]?.[0].onOutput as {
			onmessage: (frame: HerdrTerminalFrame) => void;
		};
		const frame: HerdrTerminalFrame = {
			seq: 1,
			full: true,
			width: 80,
			height: 24,
			bytes: [0x1b, 0x5b, 0x32, 0x4a],
		};
		channel.onmessage(frame);
		expect(frames).toEqual([frame]);
	});
});

describe("production GUI transport", () => {
	it("does not call Herdr JSON mutations or takeover from the xterm adapter", () => {
		const src = [
			readFileSync("src/features/terminal/lib/terminalTransport.ts", "utf8"),
			readFileSync("src/features/terminal/lib/herdrFrames.ts", "utf8"),
			readFileSync("src/features/terminal/lib/herdrQueryGuard.ts", "utf8"),
		].join("\n");
		expect(src).not.toContain("pane.send_");
		expect(src).not.toContain("tab.create");
		expect(src).not.toContain("pane.split");
		expect(src).not.toContain("workspace.");
		expect(src).not.toContain("worktree.");
		expect(src).not.toContain("server.stop");
		expect(src).not.toContain("--takeover");
		expect(src).not.toContain("herdr-client.sock");
		expect(src).not.toContain("selected_backend");
		expect(src).not.toContain("selectedBackend");
	});
});
