import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Editor, commandsCtx, rootCtx, defaultValueCtx } from "@milkdown/kit/core";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
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
import { editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
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
import type { Ctx } from "@milkdown/kit/ctx";
import type { Profile } from "@/generated";
import { useUpdateProfileNotes } from "@/features/profiles/hooks";
import * as m from "@/paraglide/messages.js";
import { toaster } from "@/shared/providers/appToaster";

interface ProfileNotesEditorProps {
	profile: Profile;
}

type SaveStatus = "idle" | "saving" | "saved" | "failed";

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
			key: new PluginKey("profile-notes-placeholder"),
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
						class: "profile-notes-placeholder",
						"data-placeholder": placeholder,
					});
					return DecorationSet.create(doc, [decoration]);
				},
			},
		});
	});
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
			item.className = "profile-notes-slash-menu__item";
			item.textContent = label;
			item.addEventListener("mousedown", (event) => {
				event.preventDefault();
				runCommand(command, payload);
			});
			return item;
		}

		return new Plugin({
			key: new PluginKey("profile-notes-slash-menu"),
			view: (view) => {
				const content = document.createElement("div");
				content.className = "profile-notes-slash-menu";
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
					debounce: 40,
					root: view.dom.parentElement ?? undefined,
					offset: 8,
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

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
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

function ProfileNotesToolbar({
	editor,
	status,
	toolbarState,
}: {
	editor: Editor | undefined;
	status: SaveStatus;
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

function MilkdownEditor({ profile }: ProfileNotesEditorProps) {
	const updateNotes = useUpdateProfileNotes();
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const [toolbarState, setToolbarState] = useState<ToolbarState>(DEFAULT_TOOLBAR_STATE);
	const updateNotesRef = useRef(updateNotes);
	const profileIdRef = useRef(profile.id);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingMarkdownRef = useRef<string | null>(null);
	const lastSavedMarkdownRef = useRef(profile.notes);

	useEffect(() => {
		updateNotesRef.current = updateNotes;
	}, [updateNotes]);

	useEffect(() => {
		if (profileIdRef.current === profile.id) return;
		profileIdRef.current = profile.id;
		lastSavedMarkdownRef.current = profile.notes;
		pendingMarkdownRef.current = null;
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
	}, [profile.id, profile.notes]);

	useEffect(() => {
		return () => {
			if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
		};
	}, []);

	const saveMarkdown = useCallback(
		(markdown: string) => {
			if (markdown === lastSavedMarkdownRef.current) return;

			setSaveStatus("saving");
			updateNotesRef.current.mutate(
				{ id: profileIdRef.current, notes: markdown },
				{
					onSuccess: (updatedProfile) => {
						lastSavedMarkdownRef.current = updatedProfile.notes;
						if (pendingMarkdownRef.current === updatedProfile.notes) {
							pendingMarkdownRef.current = null;
						}
						setSaveStatus("saved");
						if (saveStatusTimerRef.current) {
							clearTimeout(saveStatusTimerRef.current);
						}
						saveStatusTimerRef.current = setTimeout(() => {
							setSaveStatus("idle");
							saveStatusTimerRef.current = null;
						}, 1600);
					},
					onError: () => {
						setSaveStatus("failed");
						toaster.create({
							title: m.notesSaveFailedTitle(),
							type: "error",
						});
					},
				},
			);
		},
		[],
	);

	const flushPendingSave = useCallback(() => {
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}

		const markdown = pendingMarkdownRef.current;
		if (markdown === null) return;
		saveMarkdown(markdown);
	}, [saveMarkdown]);

	// Flush pending save timer on unmount/profile switch so the last keystrokes persist.
	useEffect(() => {
		return () => {
			flushPendingSave();
		};
	}, [flushPendingSave, profile.id]);

	const handleChange = useCallback(
		(markdown: string) => {
			pendingMarkdownRef.current = markdown;
			setSaveStatus("saving");
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = setTimeout(() => {
				saveTimerRef.current = null;
				saveMarkdown(markdown);
			}, 500);
		},
		[saveMarkdown],
	);

	// Only re-create the editor when the profile ID changes (not on every keystroke).
	// profile.notes is read once as the initial value; subsequent edits are handled by the listener.
	const editor = useEditor(
		(root) => {
			return Editor.make()
				.config(nord)
				.config((ctx) => {
					ctx.set(rootCtx, root);
					ctx.set(defaultValueCtx, profile.notes);
					ctx
						.get(listenerCtx)
						.markdownUpdated((_ctx, markdown) => {
							handleChange(markdown);
							setToolbarState(readToolbarState(_ctx));
						})
						.selectionUpdated((ctx) => {
							setToolbarState(readToolbarState(ctx));
						});
				})
				.use(commonmark)
				.use(gfm)
				.use(history)
				.use(listener)
				.use(createPlaceholderPlugin(m.notesPlaceholder()))
				.use(createSlashCommandPlugin());
		},
		[profile.id],
	);

	return (
		<Flex direction="column" h="full" minH="0">
			<ProfileNotesToolbar
				editor={editor.get()}
				status={saveStatus}
				toolbarState={toolbarState}
			/>
			<Box flex="1" minH="0" p="4">
				<Milkdown />
			</Box>
		</Flex>
	);
}

export default function ProfileNotesEditor({
	profile,
}: ProfileNotesEditorProps) {
	return (
		<Box h="full" overflow="hidden" className="milkdown-wrapper">
			<MilkdownProvider>
				<MilkdownEditor profile={profile} />
			</MilkdownProvider>
		</Box>
	);
}
