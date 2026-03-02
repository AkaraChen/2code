"use client";

import { IconButton } from "@chakra-ui/react";
import * as React from "react";
import {
	LuBold,
	LuCode,
	LuHighlighter,
	LuItalic,
	LuList,
	LuListChecks,
	LuListOrdered,
	LuMinus,
	LuQuote,
	LuRedo2,
	LuSquareCode,
	LuStrikethrough,
	LuUndo2,
} from "react-icons/lu";
import { useRichTextEditorContext } from "@/components/ui/rich-text-editor-context";
import * as m from "@/paraglide/messages.js";

interface BooleanControlOptions {
	icon: React.ReactElement;
	label: string;
	isActive: (
		editor: ReturnType<typeof useRichTextEditorContext>["editor"],
	) => boolean;
	command: (
		editor: NonNullable<
			ReturnType<typeof useRichTextEditorContext>["editor"]
		>,
	) => void;
}

export function createBooleanControl(options: BooleanControlOptions) {
	const Control = function BooleanControl({
		ref,
	}: {
		ref?: React.RefObject<HTMLButtonElement>;
	}) {
		const { editor } = useRichTextEditorContext();
		if (!editor) return null;
		const active = options.isActive(editor);
		return (
			<IconButton
				ref={ref}
				size="xs"
				variant={active ? "subtle" : "ghost"}
				aria-label={options.label}
				onClick={() => options.command(editor)}
			>
				{options.icon}
			</IconButton>
		);
	};
	Control.displayName = options.label;
	return Control;
}

export function createSelectControl(_options: Record<string, unknown>) {
	return () => null;
}

export function createSwatchControl(_options: Record<string, unknown>) {
	return () => null;
}

// Pre-built controls

export const Bold = createBooleanControl({
	label: m.richTextBold(),
	icon: <LuBold />,
	isActive: (e) => !!e?.isActive("bold"),
	command: (e) => {
		e.chain().focus().toggleBold().run();
	},
});

export const Italic = createBooleanControl({
	label: m.richTextItalic(),
	icon: <LuItalic />,
	isActive: (e) => !!e?.isActive("italic"),
	command: (e) => {
		e.chain().focus().toggleItalic().run();
	},
});

export const Strikethrough = createBooleanControl({
	label: m.richTextStrikethrough(),
	icon: <LuStrikethrough />,
	isActive: (e) => !!e?.isActive("strike"),
	command: (e) => {
		e.chain().focus().toggleStrike().run();
	},
});

export const Code = createBooleanControl({
	label: m.richTextCode(),
	icon: <LuCode />,
	isActive: (e) => !!e?.isActive("code"),
	command: (e) => {
		e.chain().focus().toggleCode().run();
	},
});

export const Highlight = createBooleanControl({
	label: m.richTextHighlight(),
	icon: <LuHighlighter />,
	isActive: (e) => !!e?.isActive("highlight"),
	command: (e) => {
		e.chain().focus().toggleHighlight().run();
	},
});

export const BulletList = createBooleanControl({
	label: m.richTextBulletList(),
	icon: <LuList />,
	isActive: (e) => !!e?.isActive("bulletList"),
	command: (e) => {
		e.chain().focus().toggleBulletList().run();
	},
});

export const OrderedList = createBooleanControl({
	label: m.richTextOrderedList(),
	icon: <LuListOrdered />,
	isActive: (e) => !!e?.isActive("orderedList"),
	command: (e) => {
		e.chain().focus().toggleOrderedList().run();
	},
});

export const TaskList = createBooleanControl({
	label: m.richTextTaskList(),
	icon: <LuListChecks />,
	isActive: (e) => !!e?.isActive("taskList"),
	command: (e) => {
		e.chain().focus().toggleTaskList().run();
	},
});

export const Blockquote = createBooleanControl({
	label: m.richTextBlockquote(),
	icon: <LuQuote />,
	isActive: (e) => !!e?.isActive("blockquote"),
	command: (e) => {
		e.chain().focus().toggleBlockquote().run();
	},
});

export const Hr = createBooleanControl({
	label: m.richTextHr(),
	icon: <LuMinus />,
	isActive: () => false,
	command: (e) => {
		e.chain().focus().setHorizontalRule().run();
	},
});

export const CodeBlock = createBooleanControl({
	label: m.richTextCodeBlock(),
	icon: <LuSquareCode />,
	isActive: (e) => !!e?.isActive("codeBlock"),
	command: (e) => {
		e.chain().focus().toggleCodeBlock().run();
	},
});

export const Undo = createBooleanControl({
	label: m.richTextUndo(),
	icon: <LuUndo2 />,
	isActive: () => false,
	command: (e) => {
		e.chain().focus().undo().run();
	},
});

export const Redo = createBooleanControl({
	label: m.richTextRedo(),
	icon: <LuRedo2 />,
	isActive: () => false,
	command: (e) => {
		e.chain().focus().redo().run();
	},
});
