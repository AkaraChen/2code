import { Box, Button } from "@chakra-ui/react";
import { Extension } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import HighlightExt from "@tiptap/extension-highlight";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Placeholder from "@tiptap/extension-placeholder";
import { useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { all, createLowlight } from "lowlight";
import { useCallback, useEffect, useRef } from "react";
import { RiSendPlaneLine } from "react-icons/ri";
import { Control, RichTextEditor } from "@/components/ui/rich-text-editor";
import * as m from "@/paraglide/messages.js";

const lowlight = createLowlight(all);

const transformPastedText = (text: string) => {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
};

const transformPastedHTML = (html: string) => {
	return html
		.replace(/<meta[^>]*>/gi, "")
		.replace(/style="[^"]*"/gi, "")
		.replace(/class="[^"]*"/gi, "")
		.replace(/\s*dir="[^"]*"/gi, "")
		.replace(/\s*id="[^"]*"/gi, "")
		.replace(/<p>\s*<\/p>/gi, "")
		.replace(/<div>/gi, "<p>")
		.replace(/<\/div>/gi, "</p>")
		.replace(/<font[^>]*>/gi, "")
		.replace(/<\/font>/gi, "")
		.replace(/<span[^>]*>/gi, "")
		.replace(/<\/span>/gi, "")
		.replace(/<p>(\s|&nbsp;)*<\/p>/gi, "");
};

interface ChatInputProps {
	onSend: (content: string) => void;
	disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
	const sendRef = useRef(onSend);
	sendRef.current = onSend;
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	const editorRef = useRef<ReturnType<typeof useEditor>>(null);

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				codeBlock: false,
			}),
			CodeBlockLowlight.configure({ lowlight }),
			HighlightExt.configure({ multicolor: true }),
			TaskList,
			TaskItem.configure({ nested: true }),
			Placeholder.configure({
				placeholder: m.agentChatPlaceholder(),
			}),
			Extension.create({
				name: "submitOnEnter",
				addKeyboardShortcuts() {
					return {
						Enter: ({ editor: e }) => {
							// Let Enter work normally inside code blocks, lists, task lists, blockquotes
							if (
								e.isActive("codeBlock") ||
								e.isActive("bulletList") ||
								e.isActive("orderedList") ||
								e.isActive("taskList") ||
								e.isActive("blockquote")
							)
								return false;

							if (disabledRef.current) return true;
							const ed = editorRef.current;
							if (!ed) return true;
							const text = ed.getText().trim();
							if (!text) return true;
							ed.commands.clearContent();
							sendRef.current(text);
							return true;
						},
					};
				},
			}),
		],
		immediatelyRender: false,
		shouldRerenderOnTransaction: true,
		editorProps: {
			transformPastedText,
			transformPastedHTML,
		},
	});

	editorRef.current = editor;

	const handleSend = useCallback(() => {
		if (!editor || disabled) return;
		const text = editor.getText().trim();
		if (!text) return;
		editor.commands.clearContent();
		onSend(text);
	}, [editor, disabled, onSend]);

	useEffect(() => {
		if (!editor) return;
		editor.setEditable(!disabled);
	}, [editor, disabled]);

	if (!editor) return null;

	const isEmpty = editor.isEmpty;

	return (
		<RichTextEditor.Root
			editor={editor}
			disabled={disabled}
			rounded="xl"
			css={{
				borderWidth: "0",
				"--content-padding-x": "spacing.3",
				"--content-padding-y": "spacing.2",
				"--content-min-height": "0",
				"& .ProseMirror": {
					fontSize: "sm",
					maxH: "200px",
					overflowY: "auto",
				},
			}}
		>
			{editor && (
				<BubbleMenu editor={editor}>
					<RichTextEditor.Toolbar variant="floating">
						<RichTextEditor.ControlGroup>
							<Control.Bold />
							<Control.Italic />
							<Control.Strikethrough />
							<Control.Code />
							<Control.Highlight />
						</RichTextEditor.ControlGroup>

						<RichTextEditor.ControlGroup>
							<Control.CodeBlock />
							<Control.BulletList />
							<Control.OrderedList />
							<Control.TaskList />
							<Control.Blockquote />
						</RichTextEditor.ControlGroup>
					</RichTextEditor.Toolbar>
				</BubbleMenu>
			)}

			<RichTextEditor.Footer>
				<Box flex="1">
					<RichTextEditor.Content />
				</Box>
				<Button
					size="sm"
					onClick={handleSend}
					disabled={isEmpty || disabled}
				>
					<RiSendPlaneLine />
				</Button>
			</RichTextEditor.Footer>
		</RichTextEditor.Root>
	);
}
