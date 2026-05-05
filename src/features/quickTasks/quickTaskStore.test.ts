import { beforeEach, describe, expect, it } from "vitest";
import { migrateQuickTaskState, useQuickTaskStore } from "./quickTaskStore";
import type { QuickTask } from "./types";

const exampleTask: QuickTask = {
	id: "task-1",
	name: "Dev Server",
	cwd: "/tmp/project",
	command: "bun run dev",
	shell: "/bin/zsh",
};

function resetStore() {
	useQuickTaskStore.setState({ tasks: [] });
}

describe("migrateQuickTaskState", () => {
	it("falls back to an empty list when persisted state is missing", () => {
		expect(migrateQuickTaskState(undefined)).toEqual({ tasks: [] });
	});

	it("keeps valid tasks from persisted state", () => {
		expect(
			migrateQuickTaskState({
				tasks: [exampleTask, { invalid: true }],
			}),
		).toEqual({ tasks: [exampleTask] });
	});

	it("fills a default shell for old persisted tasks", () => {
		expect(
			migrateQuickTaskState({
				tasks: [{ ...exampleTask, shell: "" }],
			}),
		).toEqual({
			tasks: [{ ...exampleTask, shell: "/bin/zsh" }],
		});
	});
});

describe("useQuickTaskStore", () => {
	beforeEach(resetStore);

	it("upserts and deletes tasks", () => {
		useQuickTaskStore.getState().upsertTask(exampleTask);
		expect(useQuickTaskStore.getState().tasks).toEqual([exampleTask]);

		useQuickTaskStore.getState().upsertTask({
			...exampleTask,
			name: "Updated",
		});
		expect(useQuickTaskStore.getState().tasks).toEqual([
			{ ...exampleTask, name: "Updated" },
		]);

		useQuickTaskStore.getState().deleteTask(exampleTask.id);
		expect(useQuickTaskStore.getState().tasks).toEqual([]);
	});
});
