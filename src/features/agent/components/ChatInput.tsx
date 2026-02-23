import { Box, Code, Flex, HStack, IconButton, Kbd, Text } from "@chakra-ui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import HighlightExt from "@tiptap/extension-highlight";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Placeholder from "@tiptap/extension-placeholder";
import { useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { all, createLowlight } from "lowlight";
import { useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { LuExpand } from "react-icons/lu";
import { RiSendPlaneLine } from "react-icons/ri";
import { Control, RichTextEditor } from "@/components/ui/rich-text-editor";
import { listSnippets, type Snippet } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { queryKeys } from "@/shared/lib/queryKeys";
import {
	snippetTriggerExt,
	type SnippetTriggerStorage,
} from "./snippetTriggerExt";
import { submitOnEnterExt, type SubmitOnEnterStorage } from "./submitOnEnterExt";

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
	expanded?: boolean;
	onToggleExpand?: () => void;
	modelSelector?: React.ReactNode;
}

export const ChatInput = ({ ref, onSend, disabled = false, expanded = false, onToggleExpand, modelSelector }: ChatInputProps & { ref?: React.RefObject<Editor | null | null> }) => {
	const { data: snippets } = useSuspenseQuery({
		queryKey: queryKeys.snippets.all,
		queryFn: listSnippets,
	});
	const [selectedSnippetIndex, setSelectedSnippetIndex] = useState(0);

	const editor = useEditor({
		extensions: [
			StarterKit.configure({ codeBlock: false }),
			CodeBlockLowlight.configure({ lowlight }),
			HighlightExt.configure({ multicolor: true }),
			TaskList,
			TaskItem.configure({ nested: true }),
			snippetTriggerExt,
			Placeholder.configure({
				placeholder: ({ editor }) =>
					(editor.storage.submitOnEnter as SubmitOnEnterStorage).expanded
						? m.agentChatPlaceholderSheet()
						: m.agentChatPlaceholder(),
			}),
			submitOnEnterExt,
		],
		shouldRerenderOnTransaction: true,
		editorProps: {
			transformPastedText,
			transformPastedHTML,
		},
	});

	useImperativeHandle<Editor | null, Editor | null>(ref, () => editor, [editor]);

	const snippetStorage = editor?.storage.snippetTrigger as
		| SnippetTriggerStorage
		| undefined;
	const isSnippetMenuOpen = !!snippetStorage?.active;
	const snippetQuery = snippetStorage?.query ?? "";

	const filteredSnippets = useMemo(() => {
		const query = snippetQuery.trim().toLowerCase();
		if (!query) return snippets;

		const matched = snippets.filter((snippet) => {
			return (
				snippet.name.toLowerCase().includes(query) ||
				snippet.trigger.toLowerCase().includes(query) ||
				snippet.content.toLowerCase().includes(query)
			);
		});

		return matched.length > 0 ? matched : snippets;
	}, [snippets, snippetQuery]);
	const activeSnippetIndex = filteredSnippets.length === 0
		? 0
		: Math.min(selectedSnippetIndex, filteredSnippets.length - 1);

	const handleSend = useCallback(() => {
		if (!editor || disabled) return;
		const text = editor.getText().trim();
		if (!text) return;
		editor.commands.clearContent();
		onSend(text);
	}, [editor, disabled, onSend]);

	const replaceSnippetTriggerWithContent = useCallback(
		(snippet: Snippet) => {
			if (!editor) return;

			const storage = editor.storage.snippetTrigger as SnippetTriggerStorage;
			if (!storage.range) return;

			editor
				.chain()
				.focus()
				.command(({ tr }) => {
					tr.insertText(
						snippet.content,
						storage.range!.from,
						storage.range!.to,
					);
					return true;
				})
				.run();
		},
		[editor],
	);

	const handleSelectSnippet = useCallback(() => {
		const snippet = filteredSnippets[activeSnippetIndex];
		if (!snippet) return;
		replaceSnippetTriggerWithContent(snippet);
	}, [activeSnippetIndex, filteredSnippets, replaceSnippetTriggerWithContent]);

	useEffect(() => {
		if (!editor) return;
		// eslint-disable-next-line react-hooks/immutability
		editor.storage.submitOnEnter.onSend = onSend;
		editor.storage.submitOnEnter.disabled = disabled;
		editor.setEditable(!disabled);
	}, [editor, onSend, disabled]);

	// Sync expanded into storage, then trigger a transaction so Placeholder re-evaluates
	useEffect(() => {
		if (!editor) return;
		// eslint-disable-next-line react-hooks/immutability
		editor.storage.submitOnEnter.expanded = expanded;
		editor.view.dispatch(editor.view.state.tr);
	}, [editor, expanded]);

	useEffect(() => {
		if (!editor) return;
		// eslint-disable-next-line react-hooks/immutability
		editor.storage.snippetTrigger.onMoveSelection = (direction) => {
			if (filteredSnippets.length === 0) return;

			setSelectedSnippetIndex((prev) => {
				const delta = direction === "down" ? 1 : -1;
				return (
					(prev + delta + filteredSnippets.length) %
					filteredSnippets.length
				);
			});
		};
		editor.storage.snippetTrigger.onSelectItem = handleSelectSnippet;

		return () => {
			editor.storage.snippetTrigger.onMoveSelection = () => {};
			editor.storage.snippetTrigger.onSelectItem = () => {};
		};
	}, [editor, filteredSnippets.length, handleSelectSnippet]);

	if (!editor) return null;

	const isEmpty = editor.isEmpty;

	return (
		<RichTextEditor.Root
			editor={editor}
			disabled={disabled}
			rounded={expanded ? "none" : "xl"}
			h={expanded ? "full" : undefined}
			bg={expanded ? undefined : "bg.panel"}
			css={{
				...(expanded && { borderWidth: "0" }),
				"--content-padding-x": "spacing.3",
				"--content-padding-y": "spacing.2",
				"--content-min-height": "0",
				"& .ProseMirror": {
					fontSize: "sm",
					...(!expanded && { maxH: "200px", overflowY: "auto" }),
				},
			}}
			position="relative"
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

			{expanded ? (
				<Flex direction="column" h="full">
					<Box flex="1" overflowY="auto">
						<RichTextEditor.Content />
					</Box>
					<HStack px="3" py="2" gap="2" borderTopWidth="1px">
						<Box flex="1" minW="0">
							{modelSelector}
						</Box>
						<HStack gap="1" ml="auto">
							<IconButton
								size="sm"
								onClick={handleSend}
								disabled={isEmpty || disabled}
								aria-label="Send"
							>
								<RiSendPlaneLine />
							</IconButton>
						</HStack>
					</HStack>
				</Flex>
			) : (
				<Flex direction="column">
					<Box>
						<RichTextEditor.Content />
					</Box>
					<HStack px="3" py="2" gap="2">
						<Box flex="1" minW="0">
							{modelSelector}
						</Box>
						<HStack gap="1" ml="auto">
							{onToggleExpand && (
								<IconButton
									size="sm"
									variant="ghost"
									onClick={onToggleExpand}
									aria-label="Expand"
								>
									<LuExpand />
								</IconButton>
							)}
							<IconButton
								size="sm"
								onClick={handleSend}
								disabled={isEmpty || disabled}
								aria-label="Send"
							>
								<RiSendPlaneLine />
							</IconButton>
						</HStack>
					</HStack>
				</Flex>
			)}

			{isSnippetMenuOpen && (
				<Box
					position="absolute"
					left="3"
					right="3"
					bottom={expanded ? "14" : "16"}
					zIndex={2}
					borderWidth="1px"
					bg="bg.panel"
					rounded="lg"
					shadow="md"
					overflow="hidden"
				>
					<HStack
						justify="space-between"
						px="3"
						py="2"
						borderBottomWidth="1px"
						bg="bg.subtle"
					>
						<Text fontSize="xs" color="fg.muted">
							{m.snippets()}
						</Text>
						<HStack gap="1">
							<Kbd size="sm">↑</Kbd>
							<Kbd size="sm">↓</Kbd>
							<Kbd size="sm">Enter</Kbd>
						</HStack>
					</HStack>

					<Box maxH="48" overflowY="auto">
						{filteredSnippets.length === 0 ? (
							<Text px="3" py="2" fontSize="sm" color="fg.muted">
								{m.noSnippetsYet()}
							</Text>
						) : (
							filteredSnippets.map((snippet, index) => {
								const selected = activeSnippetIndex === index;
								return (
									<Box
										key={snippet.id}
										as="button"
										w="full"
										px="3"
										py="2"
										textAlign="left"
										bg={selected ? "bg.muted" : "transparent"}
										_hover={{ bg: "bg.muted" }}
										onMouseEnter={() =>
											setSelectedSnippetIndex(index)
										}
										onMouseDown={(event) =>
											event.preventDefault()
										}
										onClick={() =>
											replaceSnippetTriggerWithContent(
												snippet,
											)
										}
									>
										<HStack justify="space-between">
											<Text fontSize="sm" truncate>
												{snippet.name}
											</Text>
											<Code size="sm">
												{snippet.trigger}
											</Code>
										</HStack>
									</Box>
								);
							})
						)}
					</Box>
				</Box>
			)}
		</RichTextEditor.Root>
	);
};
