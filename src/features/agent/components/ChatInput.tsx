import { Box, Button } from "@chakra-ui/react";
import { Extension } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef } from "react";
import { RiSendPlaneLine } from "react-icons/ri";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import * as m from "@/paraglide/messages.js";

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
				heading: false,
				horizontalRule: false,
				blockquote: false,
			}),
			Placeholder.configure({
				placeholder: m.agentChatPlaceholder(),
			}),
			Extension.create({
				name: "submitOnEnter",
				addKeyboardShortcuts() {
					return {
						Enter: () => {
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
