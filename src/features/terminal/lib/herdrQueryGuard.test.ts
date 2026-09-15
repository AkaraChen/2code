import { describe, expect, it, vi } from "vitest";
import {
	blockHerdrQueryReplies,
	isHerdrDeviceQuery,
} from "./herdrQueryGuard";
import { herdrDsrDaFixture } from "./herdrTestFixtures";

describe("isHerdrDeviceQuery", () => {
	it("matches the verified DSR CSI 6n query", () => {
		expect(herdrDsrDaFixture.dsr_query.hex).toBe("1b5b366e");
		expect(isHerdrDeviceQuery({ final: "n" }, [6])).toBe(true);
	});

	it("matches the verified primary DA CSI c query", () => {
		expect(herdrDsrDaFixture.da_query.hex).toBe("1b5b63");
		expect(isHerdrDeviceQuery({ final: "c" }, [])).toBe(true);
		expect(isHerdrDeviceQuery({ final: "c" }, [0])).toBe(true);
	});

	it("does not swallow unrelated CSI or DA replies with a private marker", () => {
		expect(isHerdrDeviceQuery({ final: "n" }, [5])).toBe(false);
		expect(isHerdrDeviceQuery({ final: "n" }, [0])).toBe(false);
		expect(isHerdrDeviceQuery({ final: "R" }, [10, 1])).toBe(false);
		expect(isHerdrDeviceQuery({ prefix: "?", final: "c" }, [62, 22])).toBe(
			false,
		);
	});
});

describe("blockHerdrQueryReplies", () => {
	it("registers CSI handlers that consume DSR/DA and leave other n reports", () => {
		const n = vi.fn();
		const c = vi.fn();
		const terminal = {
			parser: {
				registerCsiHandler: (
					id: { final: string },
					callback: (params: Array<number | number[]>) => boolean,
				) => {
					if (id.final === "n") n.mockImplementation(callback);
					if (id.final === "c") c.mockImplementation(callback);
					return { dispose: vi.fn() };
				},
			},
		};
		blockHerdrQueryReplies(terminal as never);
		expect(n([6])).toBe(true);
		expect(n([5])).toBe(false);
		expect(c([])).toBe(true);
	});
});
