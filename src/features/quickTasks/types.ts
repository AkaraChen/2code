export const DEFAULT_QUICK_TASK_SHELL = "/bin/zsh";

export interface QuickTask {
	id: string;
	name: string;
	cwd: string;
	command: string;
	shell: string;
}

export interface QuickTaskDraft {
	id: string;
	name: string;
	cwd: string;
	command: string;
	shell: string;
}

export function createQuickTaskId() {
	return crypto.randomUUID();
}

export function createEmptyQuickTaskDraft(): QuickTaskDraft {
	return {
		id: createQuickTaskId(),
		name: "",
		cwd: "",
		command: "",
		shell: DEFAULT_QUICK_TASK_SHELL,
	};
}

export function toQuickTaskDraft(task: QuickTask): QuickTaskDraft {
	return { ...task };
}

export function normalizeQuickTaskDraft(
	draft: QuickTaskDraft,
): QuickTask | null {
	const name = draft.name.trim();
	const cwd = draft.cwd.trim();
	const command = draft.command.trim();
	const shell = draft.shell.trim() || DEFAULT_QUICK_TASK_SHELL;

	if (!name || !cwd || !command) return null;

	return {
		id: draft.id || createQuickTaskId(),
		name,
		cwd,
		command,
		shell,
	};
}

export function quickTaskCommandPreview(command: string): string {
	const lines = command
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return "";
	if (lines.length === 1) return lines[0];
	return `${lines[0]} +${lines.length - 1}`;
}
