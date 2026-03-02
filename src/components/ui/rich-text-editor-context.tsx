"use client";

import type { Editor } from "@tiptap/react";
import { createContext, use } from "react";

interface RichTextEditorContextValue {
	editor: Editor | null;
}

export const RichTextEditorContext =
	createContext<RichTextEditorContextValue | null>(null);

export function useRichTextEditorContext() {
	const context = use(RichTextEditorContext);
	if (!context) {
		throw new Error(
			"useRichTextEditorContext must be used within RichTextEditor.Root",
		);
	}
	return context;
}
