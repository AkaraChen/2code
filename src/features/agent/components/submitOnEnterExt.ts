import { Extension } from "@tiptap/core";

declare module '@tiptap/core' {
	interface Storage {
		submitOnEnter: SubmitOnEnterStorage;
	}
}

export interface SubmitOnEnterStorage {
	onSend: (text: string) => void;
	disabled: boolean;
	expanded: boolean;
}

export const submitOnEnterExt = Extension.create({
	name: "submitOnEnter",
	addStorage(): SubmitOnEnterStorage {
		return { onSend: () => {}, disabled: false, expanded: false };
	},
	addKeyboardShortcuts() {
		return {
			Enter: ({ editor }) => {
				const storage = editor.storage.submitOnEnter as SubmitOnEnterStorage;
				const snippetTrigger = editor.storage as {
					snippetTrigger?: { active?: boolean };
				};
				if (snippetTrigger.snippetTrigger?.active) return true;

				if (storage.expanded) return false;

				if (
					editor.isActive("codeBlock") ||
					editor.isActive("bulletList") ||
					editor.isActive("orderedList") ||
					editor.isActive("taskList") ||
					editor.isActive("blockquote")
				)
					return false;

				if (storage.disabled) return true;
				const text = editor.getText().trim();
				if (!text) return true;
				editor.commands.clearContent();
				storage.onSend(text);
				return true;
			},
		};
	},
});
