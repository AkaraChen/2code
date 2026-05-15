import { bench, describe } from "vitest";
import {
	closeTerminalTab,
	type ProjectTerminalState,
} from "./store";

const tabs = Array.from({ length: 5_000 }, (_, index) => ({
	id: `session-${index}`,
	title: `Terminal ${index}`,
}));
const targetTabId = tabs[3_750].id;
let sink = 0;

function makeProfile(): ProjectTerminalState {
	return {
		tabs: tabs.map((tab) => ({ ...tab })),
		activeTabId: targetTabId,
		counter: tabs.length,
	};
}

function closeTerminalTabWithFilter(
	profile: ProjectTerminalState,
	tabId: string,
) {
	const wasActiveTab = tabId === profile.activeTabId;
	const idx = profile.tabs.findIndex((t) => t.id === tabId);
	profile.tabs = profile.tabs.filter((t) => t.id !== tabId);

	if (wasActiveTab && profile.tabs.length > 0) {
		const newIdx = Math.min(idx, profile.tabs.length - 1);
		profile.activeTabId = profile.tabs[newIdx].id;
	}
}

describe("terminal tab closing", () => {
	bench("findIndex plus filter close", () => {
		const profile = makeProfile();
		closeTerminalTabWithFilter(profile, targetTabId);
		sink = profile.tabs.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("findIndex plus splice close", () => {
		const profile = makeProfile();
		closeTerminalTab(profile, targetTabId);
		sink = profile.tabs.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
