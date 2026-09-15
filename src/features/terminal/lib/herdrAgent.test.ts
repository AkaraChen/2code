import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionAgentStatus } from "@/generated";
import { herdrAgentPublishStatus, mapHerdrAgentStatus } from "./herdrAgent";

vi.mock("consola", () => ({
	default: {
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

import consola from "consola";

afterEach(() => {
	vi.mocked(consola.warn).mockClear();
});

describe("mapHerdrAgentStatus", () => {
	it("maps documented Herdr states onto store statuses", () => {
		expect(mapHerdrAgentStatus("unknown")).toBe("idle");
		expect(mapHerdrAgentStatus("working")).toBe("running");
		expect(mapHerdrAgentStatus("blocked")).toBe("waiting");
		expect(mapHerdrAgentStatus("idle")).toBe("idle");
		expect(mapHerdrAgentStatus("done")).toBe("idle");
	});

	it("treats unrecognized statuses as idle and logs once", () => {
		expect(mapHerdrAgentStatus("herdr-unrecognized-task13")).toBe("idle");
		expect(mapHerdrAgentStatus("herdr-unrecognized-task13")).toBe("idle");
		expect(consola.warn).toHaveBeenCalledTimes(1);
		expect(consola.warn).toHaveBeenCalledWith(
			"[2code-agent-status] unrecognized Herdr agent status",
			{ status: "herdr-unrecognized-task13" },
		);
	});
});

describe("herdrAgentPublishStatus", () => {
	it("fails closed to idle when the projection is missing", () => {
		expect(herdrAgentPublishStatus(null)).toEqual({
			status: null,
			agentName: null,
		});
	});

	it("uses display identity when present", () => {
		const dto: SessionAgentStatus = {
			sessionId: "sess-1",
			status: "blocked",
			agentName: "Claude Code",
		};
		expect(herdrAgentPublishStatus(dto)).toEqual({
			status: "waiting",
			agentName: "Claude Code",
		});
	});

	it("drops unrecognized statuses to idle with no badge", () => {
		expect(
			herdrAgentPublishStatus({
				sessionId: "sess-1",
				status: "herdr-unrecognized-task13",
				agentName: "Claude Code",
			}),
		).toEqual({
			status: null,
			agentName: "Claude Code",
		});
	});
});
