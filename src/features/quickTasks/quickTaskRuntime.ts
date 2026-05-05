import { Channel } from "@tauri-apps/api/core";
import { create } from "zustand";
import { startQuickTaskPty, stopQuickTaskPty } from "@/generated";
import type { QuickTaskPtyEvent } from "@/generated/types";
import type { QuickTask } from "./types";
import { DEFAULT_QUICK_TASK_SHELL } from "./types";

export type QuickTaskRunStatus =
	| "starting"
	| "running"
	| "stopping"
	| "exited"
	| "failed";

export interface QuickTaskRun {
	runId: string;
	taskId: string;
	name: string;
	cwd: string;
	command: string;
	shell: string;
	status: QuickTaskRunStatus;
	startedAt: number;
	endedAt?: number;
	error?: string;
}

export type QuickTaskOutputEvent =
	| { type: "data"; data: string }
	| { type: "clear" };

type QuickTaskOutputListener = (event: QuickTaskOutputEvent) => void;

interface QuickTaskRuntimeStore {
	runs: Record<string, QuickTaskRun>;
	focusedRunId: string | null;
	isPanelOpen: boolean;
	isMenuOpen: boolean;
	addRun: (run: QuickTaskRun) => void;
	markRunning: (runId: string) => void;
	markStopping: (runId: string) => void;
	markExited: (runId: string) => void;
	markFailed: (runId: string, error: string) => void;
	focusRun: (runId: string) => void;
	setPanelOpen: (isOpen: boolean) => void;
	setMenuOpen: (isOpen: boolean) => void;
}

const MAX_OUTPUT_CHARS = 1_000_000;
const outputBuffers = new Map<string, string[]>();
const outputLengths = new Map<string, number>();
const outputListeners = new Map<string, Set<QuickTaskOutputListener>>();
const activeChannels = new Map<string, Channel<QuickTaskPtyEvent>>();

function isActiveStatus(status: QuickTaskRunStatus) {
	return (
		status === "starting" || status === "running" || status === "stopping"
	);
}

function notifyOutput(runId: string, event: QuickTaskOutputEvent) {
	const listeners = outputListeners.get(runId);
	if (!listeners) return;
	for (const listener of listeners) {
		listener(event);
	}
}

function appendQuickTaskOutput(runId: string, data: string) {
	const chunks = outputBuffers.get(runId) ?? [];
	let length = outputLengths.get(runId) ?? 0;

	chunks.push(data);
	length += data.length;
	while (length > MAX_OUTPUT_CHARS && chunks.length > 0) {
		const removed = chunks.shift();
		length -= removed?.length ?? 0;
	}

	outputBuffers.set(runId, chunks);
	outputLengths.set(runId, length);
	notifyOutput(runId, { type: "data", data });
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function removeQuickTaskOutput(runId: string) {
	outputBuffers.delete(runId);
	outputLengths.delete(runId);
	outputListeners.delete(runId);
}

export const useQuickTaskRuntimeStore = create<QuickTaskRuntimeStore>()(
	(set, get) => ({
		runs: {},
		focusedRunId: null,
		isPanelOpen: false,
		isMenuOpen: false,

		addRun(run) {
			set((state) => {
				const runs = Object.fromEntries(
					Object.entries(state.runs).filter(([runId, existing]) => {
						const keep =
							existing.taskId !== run.taskId ||
							isActiveStatus(existing.status);
						if (!keep) {
							removeQuickTaskOutput(runId);
						}
						return keep;
					}),
				) as Record<string, QuickTaskRun>;

				return {
					runs: { ...runs, [run.runId]: run },
					focusedRunId: run.runId,
					isPanelOpen: true,
				};
			});
		},

		markRunning(runId) {
			set((state) => {
				const run = state.runs[runId];
				if (!run || run.status !== "starting") return state;
				return {
					runs: {
						...state.runs,
						[runId]: { ...run, status: "running" },
					},
				};
			});
		},

		markStopping(runId) {
			set((state) => {
				const run = state.runs[runId];
				if (!run || !isActiveStatus(run.status)) return state;
				return {
					runs: {
						...state.runs,
						[runId]: { ...run, status: "stopping" },
					},
				};
			});
		},

		markExited(runId) {
			set((state) => {
				const run = state.runs[runId];
				if (
					!run ||
					run.status === "exited" ||
					run.status === "failed"
				) {
					return state;
				}
				return {
					runs: {
						...state.runs,
						[runId]: {
							...run,
							status: "exited",
							endedAt: Date.now(),
						},
					},
				};
			});
		},

		markFailed(runId, error) {
			set((state) => {
				const run = state.runs[runId];
				if (!run) return state;
				return {
					runs: {
						...state.runs,
						[runId]: {
							...run,
							status: "failed",
							error,
							endedAt: Date.now(),
						},
					},
				};
			});
		},

		focusRun(runId) {
			if (!get().runs[runId]) return;
			set({
				focusedRunId: runId,
				isPanelOpen: true,
				isMenuOpen: false,
			});
		},

		setPanelOpen(isPanelOpen) {
			if (get().isPanelOpen === isPanelOpen) return;
			set({ isPanelOpen });
		},

		setMenuOpen(isMenuOpen) {
			if (get().isMenuOpen === isMenuOpen) return;
			set({ isMenuOpen });
		},
	}),
);

function finishQuickTaskRun(runId: string) {
	activeChannels.delete(runId);
	appendQuickTaskOutput(runId, "\r\n\x1B[90m[Process exited]\x1B[0m\r\n");
	useQuickTaskRuntimeStore.getState().markExited(runId);
}

export function getQuickTaskOutput(runId: string): string[] {
	return [...(outputBuffers.get(runId) ?? [])];
}

export function subscribeQuickTaskOutput(
	runId: string,
	listener: QuickTaskOutputListener,
) {
	const listeners = outputListeners.get(runId) ?? new Set();
	listeners.add(listener);
	outputListeners.set(runId, listeners);

	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			outputListeners.delete(runId);
		}
	};
}

export function clearQuickTaskOutput(runId: string) {
	outputBuffers.set(runId, []);
	outputLengths.set(runId, 0);
	notifyOutput(runId, { type: "clear" });
}

export async function startQuickTaskRun(task: QuickTask) {
	const state = useQuickTaskRuntimeStore.getState();
	const existing = Object.values(state.runs).find(
		(run) => run.taskId === task.id && isActiveStatus(run.status),
	);

	if (existing) {
		state.focusRun(existing.runId);
		return existing.runId;
	}

	const runId = crypto.randomUUID();
	const shell = task.shell.trim() || DEFAULT_QUICK_TASK_SHELL;
	outputBuffers.set(runId, []);
	outputLengths.set(runId, 0);

	const channel = new Channel<QuickTaskPtyEvent>();
	channel.onmessage = (event) => {
		if (event.event === "output" && event.data != null) {
			appendQuickTaskOutput(event.runId, event.data);
			return;
		}

		if (event.event === "exit") {
			finishQuickTaskRun(event.runId);
		}
	};
	activeChannels.set(runId, channel);

	useQuickTaskRuntimeStore.getState().addRun({
		runId,
		taskId: task.id,
		name: task.name,
		cwd: task.cwd,
		command: task.command,
		shell,
		status: "starting",
		startedAt: Date.now(),
	});

	try {
		await startQuickTaskPty({
			onEvent: channel,
			runId,
			shell,
			cwd: task.cwd,
			command: task.command,
			rows: 24,
			cols: 80,
		});
		useQuickTaskRuntimeStore.getState().markRunning(runId);
	} catch (error) {
		const message = getErrorMessage(error);
		activeChannels.delete(runId);
		appendQuickTaskOutput(runId, `\r\n\x1B[31m${message}\x1B[0m\r\n`);
		useQuickTaskRuntimeStore.getState().markFailed(runId, message);
	}

	return runId;
}

export async function stopQuickTaskRun(runId: string) {
	useQuickTaskRuntimeStore.getState().markStopping(runId);

	try {
		await stopQuickTaskPty({ runId });
	} catch (error) {
		const message = getErrorMessage(error);
		appendQuickTaskOutput(runId, `\r\n\x1B[31m${message}\x1B[0m\r\n`);
		useQuickTaskRuntimeStore.getState().markFailed(runId, message);
	}
}
