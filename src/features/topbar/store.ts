import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	type ControlId,
	type EditorAppId,
	isEditorAppId,
	isTerminalAppId,
	type TerminalAppId,
} from "./types";

export const defaultActiveControls: ControlId[] = [
	"github-desktop",
	"editor",
	"pr-status",
];

export const defaultEditorApp: EditorAppId = "vscode";
export const defaultTerminalApp: TerminalAppId = "ghostty";

interface TopBarStore {
	activeControls: ControlId[];
	controlOptions: Record<string, Record<string, unknown>>;
	editorApp: EditorAppId;
	terminalApp: TerminalAppId;
	setActiveControls: (controls: ControlId[]) => void;
	setControlOption: (
		controlId: ControlId,
		key: string,
		value: unknown,
	) => void;
	setEditorApp: (app: EditorAppId) => void;
	setTerminalApp: (app: TerminalAppId) => void;
	resetToDefaults: () => void;
}

interface PersistedTopBarState {
	// Persisted lists may contain retired ids (e.g. "git-diff" or the old
	// per-app editor/terminal controls), so keep migration inputs as strings.
	activeControls?: string[];
	controlOptions?: Record<string, Record<string, unknown>>;
	editorApp?: EditorAppId;
	terminalApp?: TerminalAppId;
}

function withPrStatusControl(controls: string[]) {
	if (controls.includes("pr-status")) return controls;

	const gitDiffIndex = controls.indexOf("git-diff");
	if (gitDiffIndex === -1) return [...controls, "pr-status"];

	return [
		...controls.slice(0, gitDiffIndex + 1),
		"pr-status",
		...controls.slice(gitDiffIndex + 1),
	];
}

// v5: per-app editor/terminal controls collapsed into generic "editor" and
// "terminal" controls; the chosen app moved to editorApp/terminalApp.
function collapsePerAppControls(controls: string[]) {
	const collapsed: string[] = [];
	let editorApp: EditorAppId | undefined;
	let terminalApp: TerminalAppId | undefined;

	for (const id of controls) {
		let next = id;
		if (isEditorAppId(id)) {
			editorApp ??= id;
			next = "editor";
		} else if (isTerminalAppId(id)) {
			terminalApp ??= id;
			next = "terminal";
		}
		if (!collapsed.includes(next)) collapsed.push(next);
	}

	return { collapsed, editorApp, terminalApp };
}

export const useTopBarStore = create<TopBarStore>()(
	persist(
		(set) => ({
			activeControls: [...defaultActiveControls],
			controlOptions: {},
			editorApp: defaultEditorApp,
			terminalApp: defaultTerminalApp,
			setActiveControls: (controls) => set({ activeControls: controls }),
			setControlOption: (controlId, key, value) =>
				set((state) => ({
					controlOptions: {
						...state.controlOptions,
						[controlId]: {
							...state.controlOptions[controlId],
							[key]: value,
						},
					},
				})),
			setEditorApp: (app) => set({ editorApp: app }),
			setTerminalApp: (app) => set({ terminalApp: app }),
			resetToDefaults: () =>
				set({
					activeControls: [...defaultActiveControls],
					controlOptions: {},
					editorApp: defaultEditorApp,
					terminalApp: defaultTerminalApp,
				}),
		}),
		{
			name: "topbar-settings",
			version: 5,
			migrate: (persistedState, version) => {
				if (version >= 5 || !persistedState) return persistedState;

				const state = persistedState as PersistedTopBarState;
				let controls = state.activeControls ?? [...defaultActiveControls];
				if (version < 2) {
					controls = withPrStatusControl(controls);
				}
				// v3: git-diff moved into the sidebar git panel;
				// v4: reveal-in-finder replaced by clicking the project name
				controls = controls.filter(
					(id) => id !== "git-diff" && id !== "reveal-in-finder",
				);
				const { collapsed, editorApp, terminalApp } =
					collapsePerAppControls(controls);
				return {
					...state,
					activeControls: collapsed as ControlId[],
					editorApp: editorApp ?? defaultEditorApp,
					terminalApp: terminalApp ?? defaultTerminalApp,
				};
			},
		},
	),
);
