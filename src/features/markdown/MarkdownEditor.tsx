import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import {
	Badge,
	Box,
	Flex,
	HStack,
	IconButton,
	Input,
	Menu,
	Portal,
	Separator,
	Tooltip,
} from "@chakra-ui/react";
import {
	Milkdown,
	MilkdownProvider,
	useEditor,
} from "@milkdown/react";
import {
	Editor,
	commandsCtx,
	rootCtx,
	defaultValueCtx,
	editorStateCtx,
	editorViewCtx,
	serializerCtx,
} from "@milkdown/kit/core";
import { codeBlockComponent, codeBlockConfig } from "@milkdown/kit/component/code-block";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import {
	type UpdateLinkCommandPayload,
	insertHrCommand,
	createCodeBlockCommand,
	toggleLinkCommand,
	updateLinkCommand,
	toggleEmphasisCommand,
	toggleInlineCodeCommand,
	toggleStrongCommand,
	turnIntoTextCommand,
	wrapInBlockquoteCommand,
	wrapInBulletListCommand,
	wrapInHeadingCommand,
	wrapInOrderedListCommand,
	commonmark,
} from "@milkdown/kit/preset/commonmark";
import {
	addColAfterCommand,
	addColBeforeCommand,
	addRowAfterCommand,
	addRowBeforeCommand,
	deleteSelectedCellsCommand,
	insertTableCommand,
	toggleStrikethroughCommand,
	gfm,
} from "@milkdown/kit/preset/gfm";
import { SlashProvider } from "@milkdown/kit/plugin/slash";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { $prose, type $Command } from "@milkdown/kit/utils";
import { nord } from "@milkdown/theme-nord";
import {
	FiAlertCircle,
	FiBold,
	FiCheck,
	FiCode,
	FiCodepen,
	FiColumns,
	FiCornerDownRight,
	FiHash,
	FiItalic,
	FiLink,
	FiList,
	FiMenu,
	FiMinus,
	FiPlus,
	FiSave,
	FiTable,
	FiTrash2,
	FiType,
	FiX,
} from "react-icons/fi";
import { basicSetup } from "codemirror";
import type { Ctx } from "@milkdown/kit/ctx";
import * as m from "@/paraglide/messages.js";

export interface MarkdownEditorProps {
	editorKey: string;
	initialMarkdown: string;
	onMarkdownChange: (markdown: string) => void;
	onRequestSave?: (markdown: string) => void;
	placeholder?: string;
	saveStatus?: MarkdownEditorSaveStatus;
}

export type MarkdownEditorSaveStatus = "idle" | "saving" | "saved" | "failed";

interface ToolbarState {
	bold: boolean;
	italic: boolean;
	code: boolean;
	strike: boolean;
	link: boolean;
	linkHref: string;
	block:
		| "paragraph"
		| "heading-1"
		| "heading-2"
		| "heading-3"
		| "quote"
		| "code-block"
		| "bullet-list"
		| "ordered-list";
}

const DEFAULT_TOOLBAR_STATE: ToolbarState = {
	bold: false,
	italic: false,
	code: false,
	strike: false,
	link: false,
	linkHref: "",
	block: "paragraph",
};

const CODE_BLOCK_EXPAND_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<path d="m6 9 6 6 6-6" />
</svg>
`;

const CODE_BLOCK_SEARCH_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<circle cx="11" cy="11" r="7" />
	<path d="m20 20-3.5-3.5" />
</svg>
`;

const CODE_BLOCK_CLEAR_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<path d="M18 6 6 18" />
	<path d="m6 6 12 12" />
</svg>
`;

const CODE_BLOCK_COPY_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<rect width="12" height="12" x="8" y="8" rx="2" />
	<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
</svg>
`;

const CODE_BLOCK_EDIT_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<path d="M12 20h9" />
	<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
</svg>
`;

const CODE_BLOCK_HIDE_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<path d="m2 2 20 20" />
	<path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
	<path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 5 10 8a13.4 13.4 0 0 1-2 3.3" />
	<path d="M6.5 6.5C4.2 8 2.7 10.4 2 12c1 3 5 8 10 8a10.5 10.5 0 0 0 4.4-1" />
</svg>
`;

const CODE_BLOCK_EXTENSIONS = [
	basicSetup,
	oneDark,
];

function loadShellLanguage() {
	return import("@codemirror/legacy-modes/mode/shell").then(
		(module) => new LanguageSupport(StreamLanguage.define(module.shell)),
	);
}

const CODE_BLOCK_LANGUAGES = [
	LanguageDescription.of({
		name: "TypeScript",
		alias: ["ts"],
		extensions: ["ts", "mts", "cts"],
		load: () => import("@codemirror/lang-javascript").then((module) => module.javascript({ typescript: true })),
	}),
	LanguageDescription.of({
		name: "TSX",
		extensions: ["tsx"],
		load: () => import("@codemirror/lang-javascript").then((module) => module.javascript({ jsx: true, typescript: true })),
	}),
	LanguageDescription.of({
		name: "JavaScript",
		alias: ["js", "node"],
		extensions: ["js", "mjs", "cjs"],
		load: () => import("@codemirror/lang-javascript").then((module) => module.javascript()),
	}),
	LanguageDescription.of({
		name: "JSX",
		extensions: ["jsx"],
		load: () => import("@codemirror/lang-javascript").then((module) => module.javascript({ jsx: true })),
	}),
	LanguageDescription.of({
		name: "JSON",
		extensions: ["json", "jsonc", "map"],
		load: () => import("@codemirror/lang-json").then((module) => module.json()),
	}),
	LanguageDescription.of({
		name: "HTML",
		alias: ["xhtml"],
		extensions: ["html", "htm"],
		load: () => import("@codemirror/lang-html").then((module) => module.html()),
	}),
	LanguageDescription.of({
		name: "CSS",
		extensions: ["css"],
		load: () => import("@codemirror/lang-css").then((module) => module.css()),
	}),
	LanguageDescription.of({
		name: "Markdown",
		alias: ["md"],
		extensions: ["md", "markdown", "mdx"],
		load: () => import("@codemirror/lang-markdown").then((module) => module.markdown()),
	}),
	LanguageDescription.of({
		name: "Rust",
		extensions: ["rs"],
		load: () => import("@codemirror/lang-rust").then((module) => module.rust()),
	}),
	LanguageDescription.of({
		name: "Python",
		alias: ["py"],
		extensions: ["py", "pyw"],
		load: () => import("@codemirror/lang-python").then((module) => module.python()),
	}),
	LanguageDescription.of({
		name: "Go",
		extensions: ["go"],
		load: () => import("@codemirror/lang-go").then((module) => module.go()),
	}),
	LanguageDescription.of({
		name: "SQL",
		extensions: ["sql"],
		load: () => import("@codemirror/lang-sql").then((module) => module.sql()),
	}),
	LanguageDescription.of({
		name: "YAML",
		alias: ["yml"],
		extensions: ["yaml", "yml"],
		load: () => import("@codemirror/lang-yaml").then((module) => module.yaml()),
	}),
	LanguageDescription.of({
		name: "XML",
		extensions: ["xml", "svg"],
		load: () => import("@codemirror/lang-xml").then((module) => module.xml()),
	}),
	LanguageDescription.of({
		name: "C",
		extensions: ["c", "h"],
		load: () => import("@codemirror/lang-cpp").then((module) => module.cpp()),
	}),
	LanguageDescription.of({
		name: "C++",
		alias: ["cpp"],
		extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"],
		load: () => import("@codemirror/lang-cpp").then((module) => module.cpp()),
	}),
	LanguageDescription.of({
		name: "Shell",
		alias: ["bash", "sh", "zsh"],
		extensions: ["sh", "bash", "zsh"],
		filename: /^(\.bashrc|\.zshrc|\.profile)$/,
		load: loadShellLanguage,
	}),
];

function toolbarStatesEqual(a: ToolbarState, b: ToolbarState) {
	return (
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.code === b.code &&
		a.strike === b.strike &&
		a.link === b.link &&
		a.linkHref === b.linkHref &&
		a.block === b.block
	);
}

function configureCodeBlock(ctx: Ctx) {
	ctx.update(codeBlockConfig.key, (defaultConfig) => ({
		...defaultConfig,
		extensions: CODE_BLOCK_EXTENSIONS,
		languages: CODE_BLOCK_LANGUAGES,
		expandIcon: CODE_BLOCK_EXPAND_ICON,
		searchIcon: CODE_BLOCK_SEARCH_ICON,
		clearSearchIcon: CODE_BLOCK_CLEAR_ICON,
		searchPlaceholder: m.notesCodeBlockSearchLanguage(),
		noResultText: m.notesCodeBlockNoLanguage(),
		copyText: m.notesCodeBlockCopy(),
		copyIcon: CODE_BLOCK_COPY_ICON,
		previewLabel: m.preview(),
		previewLoading: m.notesCodeBlockPreviewLoading(),
		previewToggleButton: (previewOnlyMode) =>
			previewOnlyMode
				? `${CODE_BLOCK_EDIT_ICON} ${m.notesCodeBlockEdit()}`
				: `${CODE_BLOCK_HIDE_ICON} ${m.notesCodeBlockHidePreview()}`,
	}));
}

function getMarkState(ctx: Ctx, markName: string) {
	const state = ctx.get(editorStateCtx);
	const markType = state.schema.marks[markName];
	if (!markType) return { active: false, attrs: null as Record<string, unknown> | null };

	const { empty, from, to, $from } = state.selection;
	if (empty) {
		const mark = markType.isInSet(state.storedMarks ?? $from.marks());
		return { active: !!mark, attrs: mark?.attrs ?? null };
	}

	let active = false;
	let attrs: Record<string, unknown> | null = null;
	state.doc.nodesBetween(from, to, (node) => {
		const mark = markType.isInSet(node.marks);
		if (!mark) return;
		active = true;
		attrs = mark.attrs;
		return false;
	});
	return { active, attrs };
}

function readToolbarState(ctx: Ctx): ToolbarState {
	const state = ctx.get(editorStateCtx);
	const { $from } = state.selection;
	const link = getMarkState(ctx, "link");
	let block: ToolbarState["block"] = "paragraph";

	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const node = $from.node(depth);
		if (node.type.name === "heading") {
			const level = Number(node.attrs.level);
			block = level === 1 || level === 2 || level === 3
				? `heading-${level}`
				: "paragraph";
			break;
		}
		if (node.type.name === "blockquote") {
			block = "quote";
			break;
		}
		if (node.type.name === "code_block") {
			block = "code-block";
			break;
		}
		if (node.type.name === "bullet_list") {
			block = "bullet-list";
			break;
		}
		if (node.type.name === "ordered_list") {
			block = "ordered-list";
			break;
		}
	}

	return {
		bold: getMarkState(ctx, "strong").active,
		italic: getMarkState(ctx, "emphasis").active,
		code: getMarkState(ctx, "inlineCode").active,
		strike: getMarkState(ctx, "strike_through").active,
		link: link.active,
		linkHref: typeof link.attrs?.href === "string" ? link.attrs.href : "",
		block,
	};
}

function createPlaceholderPlugin(placeholder: string) {
	return $prose(() => {
		return new Plugin({
			key: new PluginKey("markdown-editor-placeholder"),
			props: {
				decorations(state) {
					const doc = state.doc;
					if (
						doc.childCount !== 1 ||
						doc.firstChild?.type.name !== "paragraph" ||
						doc.firstChild.content.size > 0
					) {
						return null;
					}

					const decoration = Decoration.node(0, doc.firstChild.nodeSize, {
						class: "markdown-editor-placeholder",
						"data-placeholder": placeholder,
					});
					return DecorationSet.create(doc, [decoration]);
				},
			},
		});
	});
}

function shouldShowSlashMenu(view: EditorView) {
	const { selection } = view.state;
	if (!selection.empty) return false;

	const { $from } = selection;
	if ($from.parent.type.name !== "paragraph" || $from.parentOffset === 0) {
		return false;
	}

	const previousChar = $from.parent.textBetween(
		$from.parentOffset - 1,
		$from.parentOffset,
		undefined,
		"\uFFFC",
	);
	return previousChar === "/";
}

function createSlashCommandPlugin() {
	return $prose((ctx) => {
		let provider: SlashProvider | null = null;

		function runCommand<T>(command: $Command<T>, payload?: T) {
			const view = ctx.get(editorViewCtx);
			const { state } = view;
			const cursorPos = state.selection.from;
			if (cursorPos > 0) {
				const previousChar = state.doc.textBetween(cursorPos - 1, cursorPos);
				if (previousChar === "/") {
					view.dispatch(state.tr.delete(cursorPos - 1, cursorPos));
				}
			}
			ctx.get(commandsCtx).call(command.key, payload);
			provider?.hide();
			view.focus();
		}

		function createItem<T>(
			label: string,
			command: $Command<T>,
			payload?: T,
		) {
			const item = document.createElement("button");
			item.type = "button";
			item.className = "markdown-editor-slash-menu__item";
			item.textContent = label;
			item.addEventListener("mousedown", (event) => {
				event.preventDefault();
				runCommand(command, payload);
			});
			return item;
		}

		return new Plugin({
			key: new PluginKey("markdown-editor-slash-menu"),
			view: (view) => {
				const content = document.createElement("div");
				content.className = "markdown-editor-slash-menu";
				content.append(
					createItem(m.notesFormatParagraph(), turnIntoTextCommand),
					createItem(m.notesFormatHeading1(), wrapInHeadingCommand, 1),
					createItem(m.notesFormatHeading2(), wrapInHeadingCommand, 2),
					createItem(m.notesFormatHeading3(), wrapInHeadingCommand, 3),
					createItem(m.notesFormatBulletList(), wrapInBulletListCommand),
					createItem(m.notesFormatOrderedList(), wrapInOrderedListCommand),
					createItem(m.notesFormatQuote(), wrapInBlockquoteCommand),
					createItem(m.notesFormatCodeBlock(), createCodeBlockCommand),
					createItem(m.notesInsertTable(), insertTableCommand, { row: 3, col: 3 }),
					createItem(m.notesInsertDivider(), insertHrCommand),
				);

				provider = new SlashProvider({
					content,
					debounce: 120,
					root: view.dom.parentElement ?? undefined,
					offset: 8,
					shouldShow: shouldShowSlashMenu,
				});
				provider.update(view);

				return {
					update: (nextView, prevState) => provider?.update(nextView, prevState),
					destroy: () => {
						provider?.destroy();
						content.remove();
					},
				};
			},
		});
	});
}

function runEditorCommand<T>(
	editor: Editor | undefined,
	command: $Command<T>,
	payload?: T,
) {
	if (!editor) return;
	editor.action((ctx) => {
		ctx.get(commandsCtx).call(command.key, payload);
	});
}

function NotesToolbarButton({
	label,
	children,
	isActive,
	onRun,
}: {
	label: string;
	children: React.ReactNode;
	isActive?: boolean;
	onRun: () => void;
}) {
	return (
		<Tooltip.Root openDelay={300}>
			<Tooltip.Trigger asChild>
				<IconButton
					aria-label={label}
					size="xs"
					variant="ghost"
					color={isActive ? "fg" : "fg.muted"}
					bg={isActive ? "bg.muted" : "transparent"}
					rounded="l2"
					onMouseDown={(event) => event.preventDefault()}
					onClick={onRun}
				>
					{children}
				</IconButton>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content>{label}</Tooltip.Content>
				</Tooltip.Positioner>
			</Portal>
		</Tooltip.Root>
	);
}

function SaveStatusIndicator({ status }: { status: MarkdownEditorSaveStatus }) {
	const content = useMemo(() => {
		switch (status) {
			case "saving":
				return { icon: <FiSave />, label: m.notesSaving(), colorPalette: "gray" };
			case "saved":
				return { icon: <FiCheck />, label: m.notesSaved(), colorPalette: "green" };
			case "failed":
				return { icon: <FiAlertCircle />, label: m.notesSaveFailedShort(), colorPalette: "red" };
			default:
				return null;
		}
	}, [status]);

	if (!content) return <Box flex="1" />;

	return (
		<Flex flex="1" justify="end" minW="20">
			<Badge size="sm" variant="subtle" colorPalette={content.colorPalette}>
				{content.icon}
				{content.label}
			</Badge>
		</Flex>
	);
}

function MarkdownToolbar({
	editor,
	status,
	toolbarState,
}: {
	editor: Editor | undefined;
	status: MarkdownEditorSaveStatus;
	toolbarState: ToolbarState;
}) {
	const [linkHref, setLinkHref] = useState("");
	const [linkOpen, setLinkOpen] = useState(false);
	const runCommand = useCallback(
		<T,>(command: $Command<T>, payload?: T) => {
			runEditorCommand(editor, command, payload);
		},
		[editor],
	);
	const openLinkEditor = useCallback(() => {
		setLinkHref(toolbarState.linkHref);
		setLinkOpen((open) => !open);
	}, [toolbarState.linkHref]);
	const applyLink = useCallback(() => {
		const href = linkHref.trim();
		if (!href) return;
		const payload: UpdateLinkCommandPayload = { href };
		if (toolbarState.link) {
			runCommand(updateLinkCommand, payload);
		} else {
			runCommand(toggleLinkCommand, payload);
		}
		setLinkOpen(false);
	}, [linkHref, runCommand, toolbarState.link]);
	const removeLink = useCallback(() => {
		runCommand(toggleLinkCommand, {});
		setLinkHref("");
		setLinkOpen(false);
	}, [runCommand]);

	return (
		<Flex
			align="center"
			gap="1"
			px="2"
			py="1"
			borderBottomWidth="1px"
			borderColor="border"
			bg="bg.panel"
			overflowX="auto"
			flexShrink={0}
		>
			<HStack gap="1" flexShrink={0}>
				<Menu.Root>
					<Menu.Trigger asChild>
						<IconButton
							aria-label={m.notesCommandMenu()}
							size="xs"
							variant="ghost"
							color="fg.muted"
							rounded="l2"
							onMouseDown={(event) => event.preventDefault()}
						>
							<FiMenu />
						</IconButton>
					</Menu.Trigger>
					<Portal>
						<Menu.Positioner>
							<Menu.Content minW="44">
								<Menu.Item
									value="paragraph"
									onClick={() => runCommand(turnIntoTextCommand)}
								>
									<FiType />
									{m.notesFormatParagraph()}
								</Menu.Item>
								<Menu.Item
									value="heading-1"
									onClick={() => runCommand(wrapInHeadingCommand, 1)}
								>
									<FiHash />
									{m.notesFormatHeading1()}
								</Menu.Item>
								<Menu.Item
									value="heading-2"
									onClick={() => runCommand(wrapInHeadingCommand, 2)}
								>
									<FiHash />
									{m.notesFormatHeading2()}
								</Menu.Item>
								<Menu.Item
									value="heading-3"
									onClick={() => runCommand(wrapInHeadingCommand, 3)}
								>
									<FiHash />
									{m.notesFormatHeading3()}
								</Menu.Item>
								<Menu.Separator />
								<Menu.Item
									value="blockquote"
									onClick={() => runCommand(wrapInBlockquoteCommand)}
								>
									<FiCornerDownRight />
									{m.notesFormatQuote()}
								</Menu.Item>
								<Menu.Item
									value="code-block"
									onClick={() => runCommand(createCodeBlockCommand)}
								>
									<FiCodepen />
									{m.notesFormatCodeBlock()}
								</Menu.Item>
								<Menu.Item
									value="table"
									onClick={() => runCommand(insertTableCommand, { row: 3, col: 3 })}
								>
									<FiTable />
									{m.notesInsertTable()}
								</Menu.Item>
								<Menu.Item value="divider" onClick={() => runCommand(insertHrCommand)}>
									<FiMinus />
									{m.notesInsertDivider()}
								</Menu.Item>
							</Menu.Content>
						</Menu.Positioner>
					</Portal>
				</Menu.Root>
			</HStack>

			<Separator orientation="vertical" h="5" mx="1" />

			<HStack gap="0.5">
				<NotesToolbarButton
					label={`${m.notesFormatBold()}  ⌘B`}
					isActive={toolbarState.bold}
					onRun={() => runCommand(toggleStrongCommand)}
				>
					<FiBold />
				</NotesToolbarButton>
				<NotesToolbarButton
					label={`${m.notesFormatItalic()}  ⌘I`}
					isActive={toolbarState.italic}
					onRun={() => runCommand(toggleEmphasisCommand)}
				>
					<FiItalic />
				</NotesToolbarButton>
				<NotesToolbarButton
					label={`${m.notesFormatCode()}  ⌘E`}
					isActive={toolbarState.code}
					onRun={() => runCommand(toggleInlineCodeCommand)}
				>
					<FiCode />
				</NotesToolbarButton>
				<NotesToolbarButton
					label={m.notesFormatStrike()}
					isActive={toolbarState.strike}
					onRun={() => runCommand(toggleStrikethroughCommand)}
				>
					<Box as="span" textDecoration="line-through" fontWeight="semibold">
						S
					</Box>
				</NotesToolbarButton>
				<NotesToolbarButton
					label={m.notesFormatLink()}
					isActive={toolbarState.link}
					onRun={openLinkEditor}
				>
					<FiLink />
				</NotesToolbarButton>
			</HStack>

			<Separator orientation="vertical" h="5" mx="1" />

			<HStack gap="0.5">
				<NotesToolbarButton
					label={m.notesFormatBulletList()}
					isActive={toolbarState.block === "bullet-list"}
					onRun={() => runCommand(wrapInBulletListCommand)}
				>
					<FiList />
				</NotesToolbarButton>
				<NotesToolbarButton
					label={m.notesFormatOrderedList()}
					isActive={toolbarState.block === "ordered-list"}
					onRun={() => runCommand(wrapInOrderedListCommand)}
				>
					<Box as="span" fontSize="xs" fontWeight="semibold">
						1.
					</Box>
				</NotesToolbarButton>
				<NotesToolbarButton
					label={m.notesFormatQuote()}
					isActive={toolbarState.block === "quote"}
					onRun={() => runCommand(wrapInBlockquoteCommand)}
				>
					<FiCornerDownRight />
				</NotesToolbarButton>
			</HStack>

			<Separator orientation="vertical" h="5" mx="1" />

			<Menu.Root>
				<Menu.Trigger asChild>
					<IconButton
						aria-label={m.notesTableMenu()}
						size="xs"
						variant="ghost"
						color="fg.muted"
						rounded="l2"
						onMouseDown={(event) => event.preventDefault()}
					>
						<FiTable />
					</IconButton>
				</Menu.Trigger>
				<Portal>
					<Menu.Positioner>
						<Menu.Content minW="44">
							<Menu.Item
								value="insert-table"
								onClick={() => runCommand(insertTableCommand, { row: 3, col: 3 })}
							>
								<FiTable />
								{m.notesInsertTable()}
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item value="add-row" onClick={() => runCommand(addRowAfterCommand)}>
								<FiPlus />
								{m.notesTableAddRow()}
							</Menu.Item>
							<Menu.Item value="add-column" onClick={() => runCommand(addColAfterCommand)}>
								<FiColumns />
								{m.notesTableAddColumn()}
							</Menu.Item>
							<Menu.Item value="add-row-before" onClick={() => runCommand(addRowBeforeCommand)}>
								<FiPlus />
								{m.notesTableAddRowBefore()}
							</Menu.Item>
							<Menu.Item value="add-column-before" onClick={() => runCommand(addColBeforeCommand)}>
								<FiColumns />
								{m.notesTableAddColumnBefore()}
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item value="delete-cells" onClick={() => runCommand(deleteSelectedCellsCommand)}>
								<FiTrash2 />
								{m.notesTableDeleteCells()}
							</Menu.Item>
						</Menu.Content>
					</Menu.Positioner>
				</Portal>
			</Menu.Root>

			{linkOpen && (
				<HStack gap="1" flexShrink={0} minW="56">
					<Input
						size="xs"
						value={linkHref}
						placeholder="https://"
						onChange={(event) => setLinkHref(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") applyLink();
							if (event.key === "Escape") setLinkOpen(false);
						}}
					/>
					<IconButton
						aria-label={m.notesApplyLink()}
						size="xs"
						variant="ghost"
						onMouseDown={(event) => event.preventDefault()}
						onClick={applyLink}
					>
						<FiCheck />
					</IconButton>
					<IconButton
						aria-label={m.notesRemoveLink()}
						size="xs"
						variant="ghost"
						onMouseDown={(event) => event.preventDefault()}
						onClick={removeLink}
					>
						<FiX />
					</IconButton>
				</HStack>
			)}

			<SaveStatusIndicator status={status} />
		</Flex>
	);
}

function MilkdownEditor({
	editorKey,
	initialMarkdown,
	onMarkdownChange,
	onRequestSave,
	placeholder = m.notesPlaceholder(),
	saveStatus = "idle",
}: MarkdownEditorProps) {
	const [toolbarState, setToolbarState] = useState<ToolbarState>(DEFAULT_TOOLBAR_STATE);
	const onMarkdownChangeRef = useRef(onMarkdownChange);
	const onRequestSaveRef = useRef(onRequestSave);
	const editorKeyRef = useRef(editorKey);
	const paneRef = useRef<HTMLDivElement | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const toolbarFrameRef = useRef<number | null>(null);
	const pendingMarkdownRef = useRef<string | null>(null);
	const pendingDocRef = useRef<ProseNode | null>(null);
	const toolbarStateRef = useRef<ToolbarState>(DEFAULT_TOOLBAR_STATE);
	const serializerRef = useRef<((doc: ProseNode) => string) | null>(null);

	useEffect(() => {
		onMarkdownChangeRef.current = onMarkdownChange;
	}, [onMarkdownChange]);

	useEffect(() => {
		onRequestSaveRef.current = onRequestSave;
	}, [onRequestSave]);

	useEffect(() => {
		if (editorKeyRef.current === editorKey) return;
		editorKeyRef.current = editorKey;
		pendingMarkdownRef.current = null;
		pendingDocRef.current = null;
		toolbarStateRef.current = DEFAULT_TOOLBAR_STATE;
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
	}, [editorKey]);

	useEffect(() => {
		return () => {
			if (toolbarFrameRef.current !== null) cancelAnimationFrame(toolbarFrameRef.current);
		};
	}, []);

	const emitMarkdownChange = useCallback((markdown: string) => {
		pendingMarkdownRef.current = null;
		onMarkdownChangeRef.current(markdown);
	}, []);

	const flushPendingMarkdown = useCallback(() => {
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}

		const serializer = serializerRef.current;
		const doc = pendingDocRef.current;
		if (doc && serializer) {
			pendingMarkdownRef.current = serializer(doc);
			pendingDocRef.current = null;
		}

		const markdown = pendingMarkdownRef.current;
		if (markdown === null) return null;
		pendingMarkdownRef.current = null;
		onMarkdownChangeRef.current(markdown);
		return markdown;
	}, []);

	// Flush pending serialization on unmount/key switch so the last keystrokes propagate.
	useEffect(() => {
		return () => {
			flushPendingMarkdown();
		};
	}, [flushPendingMarkdown, editorKey]);

	useEffect(() => {
		const handleWindowKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (event.key.toLowerCase() !== "s") return;
			if (!event.metaKey && !event.ctrlKey) return;

			const pane = paneRef.current;
			if (!pane || pane.getClientRects().length === 0 || !pane.contains(event.target as Node)) {
				return;
			}

			const markdown = flushPendingMarkdown();
			if (markdown === null) return;
			event.preventDefault();
			onRequestSaveRef.current?.(markdown);
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		return () => window.removeEventListener("keydown", handleWindowKeyDown);
	}, [flushPendingMarkdown]);

	const scheduleToolbarState = useCallback((ctx: Ctx) => {
		if (toolbarFrameRef.current !== null) return;
		toolbarFrameRef.current = requestAnimationFrame(() => {
			toolbarFrameRef.current = null;
			const nextState = readToolbarState(ctx);
			if (toolbarStatesEqual(toolbarStateRef.current, nextState)) return;
			toolbarStateRef.current = nextState;
			setToolbarState(nextState);
		});
	}, []);

	const handleDocChange = useCallback(
		(ctx: Ctx, doc: ProseNode) => {
			serializerRef.current = ctx.get(serializerCtx);
			pendingDocRef.current = doc;
			pendingMarkdownRef.current = null;
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = setTimeout(() => {
				saveTimerRef.current = null;
				const serializer = serializerRef.current;
				const pendingDoc = pendingDocRef.current;
				if (!serializer || !pendingDoc) return;
				const markdown = serializer(pendingDoc);
				pendingDocRef.current = null;
				emitMarkdownChange(markdown);
			}, 650);
		},
		[emitMarkdownChange],
	);

	// Only re-create the editor when the content identity changes (not on every keystroke).
	// initialMarkdown is read once as the initial value; subsequent edits are handled by the listener.
	const editor = useEditor(
		(root) => {
			return Editor.make()
				.config(nord)
				.config(configureCodeBlock)
				.config((ctx) => {
					ctx.set(rootCtx, root);
					ctx.set(defaultValueCtx, initialMarkdown);
					ctx
						.get(listenerCtx)
						.updated((ctx, doc) => {
							handleDocChange(ctx, doc);
							scheduleToolbarState(ctx);
						})
						.selectionUpdated((ctx) => {
							scheduleToolbarState(ctx);
						});
				})
				.use(commonmark)
				.use(codeBlockComponent)
				.use(gfm)
				.use(history)
				.use(listener)
				.use(createPlaceholderPlugin(placeholder))
				.use(createSlashCommandPlugin());
		},
		[editorKey],
	);

	return (
		<Flex ref={paneRef} direction="column" h="full" minH="0">
			<MarkdownToolbar
				editor={editor.get()}
				status={saveStatus}
				toolbarState={toolbarState}
			/>
			<Box flex="1" minH="0" overflowY="auto" p="4">
				<Milkdown />
			</Box>
		</Flex>
	);
}

export default function MarkdownEditor(props: MarkdownEditorProps) {
	return (
		<Box h="full" overflow="hidden" className="milkdown-wrapper">
			<MilkdownProvider>
				<MilkdownEditor {...props} />
			</MilkdownProvider>
		</Box>
	);
}
