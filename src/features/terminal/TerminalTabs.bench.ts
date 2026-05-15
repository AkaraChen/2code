import { bench, describe } from "vitest";

const terminalTabs = Array.from({ length: 1_000 }, (_, index) => ({
	id: `session-${index}`,
}));
const fileTabs = Array.from({ length: 1_000 }, (_, index) => ({
	filePath: `src/file-${index}.ts`,
}));
const selectedValues = Array.from({ length: 10_000 }, (_, index) =>
	index % 2 === 0
		? `src/file-${index % fileTabs.length}.ts`
		: `session-${index % terminalTabs.length}`,
);
const terminalTabIdSet = new Set(terminalTabs.map((tab) => tab.id));
const fileTabPathSet = new Set(fileTabs.map((tab) => tab.filePath));

describe("terminal tab lookup", () => {
	bench("linear scan", () => {
		let count = 0;
		for (const value of selectedValues) {
			if (fileTabs.some((tab) => tab.filePath === value)) {
				count++;
		} else if (terminalTabs.some((tab) => tab.id === value)) {
			count++;
		}
	}
		if (count !== selectedValues.length) {
			throw new Error("linear scan missed tab values");
		}
	});

	bench("set lookup", () => {
		let count = 0;
		for (const value of selectedValues) {
			if (fileTabPathSet.has(value)) {
				count++;
		} else if (terminalTabIdSet.has(value)) {
			count++;
		}
	}
		if (count !== selectedValues.length) {
			throw new Error("set lookup missed tab values");
		}
	});
});
