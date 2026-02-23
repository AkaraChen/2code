import { Extension, type Editor } from "@tiptap/core";

declare module "@tiptap/core" {
	interface Storage {
		snippetTrigger: SnippetTriggerStorage;
	}
}

export interface SnippetTriggerStorage {
	active: boolean;
	query: string;
	range: { from: number; to: number } | null;
	trigger: "!" | "！" | null;
	manualClosed: boolean;
	matchedText: string;
	onMoveSelection: (direction: "up" | "down") => void;
	onSelectItem: () => void;
}

interface TriggerState {
	query: string;
	range: { from: number; to: number };
	text: string;
	trigger: "!" | "！";
}

function getTriggerState(editor: Editor): TriggerState | null {
	const { from, empty } = editor.state.selection;

	if (!empty) return null;

	const textToCursor = editor.state.doc.textBetween(1, from, "\n", "\n");
	if (textToCursor.includes("\n")) return null;

	const match = textToCursor.match(/^([!！])([^\n]*)$/);
	if (!match) return null;

	return {
		text: textToCursor,
		trigger: match[1] as "!" | "！",
		query: match[2].trimStart(),
		range: { from: 1, to: from },
	};
}

function syncStorage(editor: Editor, storage: SnippetTriggerStorage) {
	const state = getTriggerState(editor);

	if (!state) {
		storage.active = false;
		storage.query = "";
		storage.range = null;
		storage.trigger = null;
		storage.manualClosed = false;
		storage.matchedText = "";
		return;
	}

	if (storage.matchedText !== state.text) {
		storage.manualClosed = false;
	}

	storage.matchedText = state.text;
	storage.query = state.query;
	storage.range = state.range;
	storage.trigger = state.trigger;
	storage.active = !storage.manualClosed;
}

export const snippetTriggerExt = Extension.create({
	name: "snippetTrigger",
	priority: 1_000,

	addStorage(): SnippetTriggerStorage {
		return {
			active: false,
			query: "",
			range: null,
			trigger: null,
			manualClosed: false,
			matchedText: "",
			onMoveSelection: () => {},
			onSelectItem: () => {},
		};
	},

	onCreate() {
		syncStorage(this.editor, this.storage);
	},

	onTransaction() {
		syncStorage(this.editor, this.storage);
	},

	addKeyboardShortcuts() {
		return {
			ArrowDown: () => {
				if (!this.storage.active) return false;
				this.storage.onMoveSelection("down");
				return true;
			},
			ArrowUp: () => {
				if (!this.storage.active) return false;
				this.storage.onMoveSelection("up");
				return true;
			},
			Enter: () => {
				if (!this.storage.active) return false;
				this.storage.onSelectItem();
				return true;
			},
			Tab: () => {
				if (!this.storage.active) return false;
				this.storage.onSelectItem();
				return true;
			},
			Escape: () => {
				if (!this.storage.active) return false;
				this.storage.manualClosed = true;
				this.storage.active = false;
				this.editor.view.dispatch(
					this.editor.state.tr.setMeta("snippetTriggerClosed", true),
				);
				return true;
			},
		};
	},
});
