import { beforeEach, describe, expect, it } from "vitest";

import { useGitPanelStore } from "./gitPanelStore";

const reset = () =>
	useGitPanelStore.setState({ width: 420, panelByProfile: {} });

describe("gitPanelStore", () => {
	beforeEach(reset);

	it("getOpen returns false by default", () => {
		expect(useGitPanelStore.getState().getOpen("p1")).toBe(false);
	});

	it("togglePanel flips open state per profile", () => {
		useGitPanelStore.getState().togglePanel("p1");
		expect(useGitPanelStore.getState().getOpen("p1")).toBe(true);
		// p2 should be unaffected
		expect(useGitPanelStore.getState().getOpen("p2")).toBe(false);
		useGitPanelStore.getState().togglePanel("p1");
		expect(useGitPanelStore.getState().getOpen("p1")).toBe(false);
	});

	it("setTab sets the active tab per profile", () => {
		useGitPanelStore.getState().setTab("p1", "history");
		expect(useGitPanelStore.getState().getTab("p1")).toBe("history");
		expect(useGitPanelStore.getState().getTab("p2")).toBe("changes");
	});

	it("setDraft merges into the draft", () => {
		useGitPanelStore
			.getState()
			.setDraft("p1", { subject: "feat: x", body: "" });
		expect(useGitPanelStore.getState().getDraft("p1").subject).toBe("feat: x");
		useGitPanelStore.getState().setDraft("p1", { body: "details" });
		expect(useGitPanelStore.getState().getDraft("p1")).toEqual({
			subject: "feat: x",
			body: "details",
		});
	});

	it("clearDraft resets subject + body + amendLast", () => {
		useGitPanelStore
			.getState()
			.setDraft("p1", { subject: "x", body: "y" });
		useGitPanelStore.getState().setAmendLast("p1", true);
		useGitPanelStore.getState().clearDraft("p1");
		expect(useGitPanelStore.getState().getDraft("p1")).toEqual({
			subject: "",
			body: "",
		});
		expect(useGitPanelStore.getState().getAmendLast("p1")).toBe(false);
	});

	it("setWidth clamps to [280, 800]", () => {
		useGitPanelStore.getState().setWidth(100);
		expect(useGitPanelStore.getState().width).toBe(280);
		useGitPanelStore.getState().setWidth(2000);
		expect(useGitPanelStore.getState().width).toBe(800);
		useGitPanelStore.getState().setWidth(500);
		expect(useGitPanelStore.getState().width).toBe(500);
	});

	it("draft survives toggling the panel", () => {
		useGitPanelStore
			.getState()
			.setDraft("p1", { subject: "draft", body: "" });
		useGitPanelStore.getState().togglePanel("p1");
		useGitPanelStore.getState().togglePanel("p1");
		expect(useGitPanelStore.getState().getDraft("p1").subject).toBe("draft");
	});
});
