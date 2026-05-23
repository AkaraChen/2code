import { beforeEach, describe, expect, it } from "vitest";
import { useBrowserTabsStore } from "./store";

function resetStore() {
	useBrowserTabsStore.setState({
		profiles: {},
	});
}

function getState() {
	return useBrowserTabsStore.getState();
}

describe("useBrowserTabsStore", () => {
	beforeEach(resetStore);

	describe("openUrl", () => {
		it("creates a new browser tab for a URL", () => {
			getState().openUrl("p1", "https://example.com");
			const profile = getState().profiles.p1;
			expect(profile).toBeDefined();
			expect(profile.tabs).toHaveLength(1);
			expect(profile.tabs[0].url).toBe("https://example.com");
			expect(profile.tabs[0].title).toBe("example.com");
			expect(profile.activeTabId).toBe(profile.tabs[0].id);
		});

		it("reuses existing tab for same URL", () => {
			getState().openUrl("p1", "https://example.com");
			const firstTabId = getState().profiles.p1.tabs[0].id;

			// Open same URL again — should NOT create a new tab
			getState().openUrl("p1", "https://example.com");
			const profile = getState().profiles.p1;
			expect(profile.tabs).toHaveLength(1);
			expect(profile.activeTabId).toBe(firstTabId);
		});

		it("reuses existing tab for normalized URL (trailing slash)", () => {
			getState().openUrl("p1", "https://example.com/path");
			getState().openUrl("p1", "https://example.com/path/");
			const profile = getState().profiles.p1;
			expect(profile.tabs).toHaveLength(1);
		});

		it("creates separate tabs for different URLs", () => {
			getState().openUrl("p1", "https://example.com");
			getState().openUrl("p1", "https://other.com");
			const profile = getState().profiles.p1;
			expect(profile.tabs).toHaveLength(2);
		});

		it("scopes tabs per profile", () => {
			getState().openUrl("p1", "https://example.com");
			getState().openUrl("p2", "https://example.com");
			expect(getState().profiles.p1.tabs).toHaveLength(1);
			expect(getState().profiles.p2.tabs).toHaveLength(1);
		});

		it("uses custom title when provided", () => {
			getState().openUrl("p1", "https://example.com", "My Page");
			expect(getState().profiles.p1.tabs[0].title).toBe("My Page");
		});
	});

	describe("closeTab", () => {
		it("removes a tab from the profile", () => {
			getState().openUrl("p1", "https://example.com");
			const tabId = getState().profiles.p1.tabs[0].id;
			getState().closeTab("p1", tabId);
			expect(getState().profiles.p1.tabs).toHaveLength(0);
			expect(getState().profiles.p1.activeTabId).toBeNull();
		});

		it("sets active to next tab when closing active tab", () => {
			getState().openUrl("p1", "https://a.com");
			getState().openUrl("p1", "https://b.com");
			const tabs = getState().profiles.p1.tabs;
			// Active is the second (latest opened)
			getState().closeTab("p1", tabs[1].id);
			expect(getState().profiles.p1.activeTabId).toBe(tabs[0].id);
		});
	});

	describe("setActiveTab", () => {
		it("switches active tab", () => {
			getState().openUrl("p1", "https://a.com");
			getState().openUrl("p1", "https://b.com");
			const firstTabId = getState().profiles.p1.tabs[0].id;
			getState().setActiveTab("p1", firstTabId);
			expect(getState().profiles.p1.activeTabId).toBe(firstTabId);
		});
	});

	describe("updateTabTitle", () => {
		it("updates the title of a tab", () => {
			getState().openUrl("p1", "https://example.com");
			const tabId = getState().profiles.p1.tabs[0].id;
			getState().updateTabTitle("p1", tabId, "New Title");
			expect(getState().profiles.p1.tabs[0].title).toBe("New Title");
		});
	});
});
