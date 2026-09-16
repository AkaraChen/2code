import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HerdrTerminalFrame, SessionAgentStatus } from "@/generated";
import restorationSrc from "../restoration.ts?raw";
import terminalSrc from "../Terminal.tsx?raw";
import addonsSrc from "./addons.ts?raw";
import herdrAgentSrc from "./herdrAgent.ts?raw";
import herdrFramesSrc from "./herdrFrames.ts?raw";
import herdrQueryGuardSrc from "./herdrQueryGuard.ts?raw";
import herdrScrollSrc from "./herdrScroll.ts?raw";
import terminalTransportSrc from "./terminalTransport.ts?raw";
import {
	hydrateHerdrAgentStatus,
	resolveTerminalTransportKind,
	startHerdrAgentStream,
	startHerdrFrameStream,
	transportKindFromBackend,
} from "./terminalTransport";

const {
	getSessionAgentStatus,
	getSessionBackend,
	streamHerdrOutput,
	streamSessionAgentStatus,
} = vi.hoisted(() => ({
	getSessionAgentStatus: vi.fn(),
	getSessionBackend: vi.fn(),
	streamHerdrOutput: vi.fn(() => Promise.resolve()),
	streamSessionAgentStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/generated", () => ({
	getSessionAgentStatus,
	getSessionBackend,
	streamHerdrOutput,
	streamSessionAgentStatus,
}));

beforeEach(() => {
	getSessionAgentStatus.mockReset();
	getSessionAgentStatus.mockResolvedValue(null);
	getSessionBackend.mockReset();
	streamHerdrOutput.mockReset();
	streamHerdrOutput.mockResolvedValue(undefined);
	streamSessionAgentStatus.mockReset();
	streamSessionAgentStatus.mockResolvedValue(undefined);
});

describe("transportKindFromBackend", () => {
	it("maps every backend to the Herdr stream", () => {
		expect(transportKindFromBackend("herdr")).toBe("herdr");
	});
});

describe("resolveTerminalTransportKind", () => {
	it("uses per-session backend IPC and always returns herdr", async () => {
		getSessionBackend.mockResolvedValueOnce("herdr");
		await expect(resolveTerminalTransportKind("sess-h")).resolves.toBe(
			"herdr",
		);
		expect(getSessionBackend).toHaveBeenCalledWith({ sessionId: "sess-h" });
	});

	it("documents unbound ids as the selected Herdr default", () => {
		expect(terminalTransportSrc).not.toContain("Unbound ids are Local");
		expect(terminalTransportSrc).toContain(
			"Unbound ids are Herdr",
		);
	});
});

describe("byte vs frame streams", () => {
	it("never starts a Local byte stream", () => {
		expect(terminalTransportSrc).not.toContain("streamPtyOutput");
		expect(terminalTransportSrc).not.toContain("startLocalByteStream");
		expect(terminalSrc).not.toContain("startLocalByteStream");
		expect(terminalSrc).not.toContain("getPtySessionHistory");
	});

	it("starts a Herdr frame stream", () => {
		startHerdrFrameStream({
			sessionId: "herdr-1",
			streamId: "s1",
			onFrame: () => {},
		});
		expect(streamHerdrOutput).toHaveBeenCalledTimes(1);
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
		const calls = streamHerdrOutput.mock.calls as unknown as Array<
			[{ onOutput: { onmessage: (frame: HerdrTerminalFrame) => void } }]
		>;
		expect(calls.length).toBeGreaterThan(0);
		const frame: HerdrTerminalFrame = {
			seq: 1,
			full: true,
			width: 80,
			height: 24,
			bytes: [0x1B, 0x5B, 0x32, 0x4A],
		};
		calls[0][0].onOutput.onmessage(frame);
		expect(frames).toEqual([frame]);
	});
});

describe("herdr agent status IPC", () => {
	it("hydrates mapped session DTOs without Local PTY parsing", async () => {
		const dto: SessionAgentStatus = {
			sessionId: "herdr-1",
			status: "blocked",
			agentName: "Claude Code",
		};
		getSessionAgentStatus.mockResolvedValueOnce(dto);
		await expect(hydrateHerdrAgentStatus("herdr-1")).resolves.toEqual(dto);
		expect(getSessionAgentStatus).toHaveBeenCalledWith({
			sessionId: "herdr-1",
		});
	});

	it("streams agent DTOs on the Herdr path only", () => {
		const updates: SessionAgentStatus[] = [];
		startHerdrAgentStream({
			sessionId: "herdr-1",
			onUpdate: (dto) => {
				updates.push(dto);
			},
		});
		expect(streamSessionAgentStatus).toHaveBeenCalledTimes(1);
		const calls = streamSessionAgentStatus.mock.calls as unknown as Array<
			[
				{
					onUpdate: {
						onmessage: (dto: SessionAgentStatus) => void;
					};
				},
			]
		>;
		const dto: SessionAgentStatus = {
			sessionId: "herdr-1",
			status: "working",
			agentName: null,
		};
		calls[0][0].onUpdate.onmessage(dto);
		expect(updates).toEqual([dto]);
	});
});

describe("production GUI transport", () => {
	it("does not call Herdr JSON mutations or takeover from the xterm adapter", () => {
		const src = [
			terminalTransportSrc,
			herdrAgentSrc,
			herdrFramesSrc,
			herdrQueryGuardSrc,
			herdrScrollSrc,
			addonsSrc,
			restorationSrc,
			terminalSrc,
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
		expect(src).not.toContain("pane.read");
		expect(src).not.toContain("pane.report_agent");
		expect(src).not.toContain("agent.start");
		expect(src).not.toContain("agent.prompt");
		expect(src).not.toContain("streamPtyOutput");
		expect(src).not.toContain("restorePtySession");
		expect(src).not.toContain("deletePtySessionRecord");
		expect(addonsSrc).toContain("@xterm/addon-search");
	});
});
