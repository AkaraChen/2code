import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	GlobalTerminalTemplateDraft,
	ProjectTerminalTemplateDraft,
} from "./templates";
import {
	commandPreview,
	commandsToText,
	createEmptyGlobalTerminalTemplateDraft,
	createEmptyProjectTerminalTemplateDraft,
	normalizeGlobalTerminalTemplates,
	normalizeProjectTerminalTemplates,
	resolveGlobalTerminalTemplate,
	resolveProjectTerminalTemplate,
	textToCommands,
	toGlobalTerminalTemplateDraft,
	toProjectTerminalTemplateDraft,
} from "./templates";

const { joinMock } = vi.hoisted(() => ({
	joinMock: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

vi.mock("@tauri-apps/api/path", () => ({
	join: joinMock,
}));

describe("terminal templates", () => {
	beforeEach(() => {
		joinMock.mockClear();
		vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000000",
		);
	});

	it("serializes and parses command text while trimming blanks", () => {
		expect(commandsToText(["bun install", "bun test"])).toBe(
			"bun install\nbun test",
		);
		expect(textToCommands("bun install\n\n bun test \n  ")).toEqual([
			"bun install",
			"bun test",
		]);
	});

	it("builds previews from the first command and remaining count", () => {
		expect(commandPreview("")).toBe("");
		expect(commandPreview("bun test")).toBe("bun test");
		expect(commandPreview("bun install\nbun test\nbun lint")).toBe(
			"bun install +2",
		);
	});

	it("creates empty drafts with generated ids", () => {
		expect(createEmptyGlobalTerminalTemplateDraft()).toEqual({
			id: "00000000-0000-4000-8000-000000000000",
			name: "",
			commandsText: "",
		});
		expect(createEmptyProjectTerminalTemplateDraft()).toEqual({
			id: "00000000-0000-4000-8000-000000000000",
			name: "",
			commandsText: "",
			cwd: "",
		});
	});

	it("converts saved templates back into editable drafts", () => {
		expect(
			toGlobalTerminalTemplateDraft({
				id: "global-1",
				name: "Install",
				commands: ["bun install", "bun test"],
			}),
		).toEqual({
			id: "global-1",
			name: "Install",
			commandsText: "bun install\nbun test",
		});

		expect(
			toProjectTerminalTemplateDraft({
				id: "project-1",
				name: "Project setup",
				cwd: "scripts",
				commands: ["./bootstrap.sh"],
			}),
		).toEqual({
			id: "project-1",
			name: "Project setup",
			cwd: "scripts",
			commandsText: "./bootstrap.sh",
		});
	});

	it("normalizes global drafts by trimming names, generating ids, and dropping invalid rows", () => {
		const drafts: GlobalTerminalTemplateDraft[] = [
			{
				id: "",
				name: "  Install deps  ",
				commandsText: "bun install\n\nbun test",
			},
			{
				id: "keep-me",
				name: "  ",
				commandsText: "bun test",
			},
			{
				id: "missing-commands",
				name: "No commands",
				commandsText: " \n ",
			},
		];

		expect(normalizeGlobalTerminalTemplates(drafts)).toEqual([
			{
				id: "00000000-0000-4000-8000-000000000000",
				name: "Install deps",
				commands: ["bun install", "bun test"],
			},
		]);
	});

	it("normalizes project drafts and trims cwd values", () => {
		const drafts: ProjectTerminalTemplateDraft[] = [
			{
				id: "project-1",
				name: "  Start app  ",
				cwd: "  apps/desktop  ",
				commandsText: "bun dev",
			},
			{
				id: "project-2",
				name: "Ignore me",
				cwd: "scripts",
				commandsText: "",
			},
		];

		expect(normalizeProjectTerminalTemplates(drafts)).toEqual([
			{
				id: "project-1",
				name: "Start app",
				cwd: "apps/desktop",
				commands: ["bun dev"],
			},
		]);
	});

	it("resolves project templates relative to the worktree when cwd is set", async () => {
		await expect(
			resolveProjectTerminalTemplate(
				{
					id: "project-1",
					name: "Scripts",
					cwd: "scripts",
					commands: ["./bootstrap.sh"],
				},
				"/repo",
			),
		).resolves.toEqual({
			id: "project-1",
			name: "Scripts",
			cwd: "/repo/scripts",
			commands: ["./bootstrap.sh"],
			scope: "project",
			displayCwd: "scripts",
		});
		expect(joinMock).toHaveBeenCalledWith("/repo", "scripts");
	});

	it("resolves project templates to the worktree root when cwd is empty", async () => {
		await expect(
			resolveProjectTerminalTemplate(
				{
					id: "project-1",
					name: "Root",
					cwd: "   ",
					commands: ["bun test"],
				},
				"/repo",
			),
		).resolves.toEqual({
			id: "project-1",
			name: "Root",
			cwd: "/repo",
			commands: ["bun test"],
			scope: "project",
			displayCwd: null,
		});
		expect(joinMock).not.toHaveBeenCalled();
	});

	it("resolves global templates without changing the cwd", () => {
		expect(
			resolveGlobalTerminalTemplate(
				{
					id: "global-1",
					name: "Root task",
					commands: ["bun lint"],
				},
				"/repo",
			),
		).toEqual({
			id: "global-1",
			name: "Root task",
			cwd: "/repo",
			commands: ["bun lint"],
			scope: "global",
			displayCwd: null,
		});
	});
});
