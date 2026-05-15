import {
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { FiEdit2, FiTrash2 } from "react-icons/fi";
import {
	commandPreview,
	createEmptyProjectTerminalTemplateDraft,
	type ProjectTerminalTemplateDraft,
} from "@/features/terminal/templates";
import { TerminalTemplateDraftDialog } from "@/features/terminal/TerminalTemplateDraftDialog";
import * as m from "@/paraglide/messages.js";
import {
	removeProjectTemplateDraft,
	replaceProjectTemplateDraft,
} from "./projectTemplateDraftList";

interface ProjectTemplatesEditorProps {
	templateDrafts: ProjectTerminalTemplateDraft[];
	onChange: (drafts: ProjectTerminalTemplateDraft[]) => void;
}

export function ProjectTemplatesEditor({
	templateDrafts,
	onChange,
}: ProjectTemplatesEditorProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState<ProjectTerminalTemplateDraft | null>(null);

	const isOpen = draft !== null;
	const isEditing = editingId !== null;

	function openCreate() {
		setEditingId(null);
		setDraft(createEmptyProjectTerminalTemplateDraft());
	}

	function openEdit(id: string) {
		const t = templateDrafts.find((t) => t.id === id);
		if (!t) return;
		setEditingId(id);
		setDraft({ ...t });
	}

	function closeDialog() {
		setEditingId(null);
		setDraft(null);
	}

	function handleCommit() {
		if (!draft) return;
		if (editingId) {
			onChange(replaceProjectTemplateDraft(templateDrafts, editingId, draft));
		} else {
			onChange([...templateDrafts, draft]);
		}
		closeDialog();
	}

	function handleDelete() {
		if (!editingId) return;
		onChange(removeProjectTemplateDraft(templateDrafts, editingId));
		closeDialog();
	}

	return (
		<>
			<Stack gap="3">
				<HStack justify="space-between" align="start">
					<Stack gap="1">
						<Text fontWeight="semibold">{m.projectTerminalTemplates()}</Text>
						<Text fontSize="sm" color="fg.muted">
							{m.projectTerminalTemplatesDescription()}
						</Text>
					</Stack>
					<Button size="sm" variant="outline" onClick={openCreate}>
						{m.addTerminalTemplate()}
					</Button>
				</HStack>

				{templateDrafts.length === 0 ? (
					<Box
						rounded="l3"
						borderWidth="1px"
						borderColor="border"
						bg="bg.panel"
						px="4"
						py="3"
					>
						<Text fontSize="sm" color="fg.muted">
							{m.noTerminalTemplates()}
						</Text>
					</Box>
				) : (
					<Stack gap="2">
						{templateDrafts.map((t) => (
							<Flex
								key={t.id}
								rounded="l3"
								borderWidth="1px"
								borderColor="border"
								bg="bg.panel"
								px="4"
								py="3"
								align="center"
								justify="space-between"
								gap="4"
							>
								<Stack gap="1" minW="0">
									<Text fontWeight="medium" truncate>
										{t.name || m.terminalTemplate()}
									</Text>
									{t.commandsText.trim() ? (
										<Text
											fontSize="sm"
											color="fg.muted"
											fontFamily="mono"
											truncate
										>
											{commandPreview(t.commandsText)}
										</Text>
									) : null}
									{t.cwd.trim() ? (
										<Text
											fontSize="xs"
											color="fg.subtle"
											fontFamily="mono"
											truncate
										>
											{t.cwd}
										</Text>
									) : null}
								</Stack>
								<HStack gap="1" flexShrink="0">
									<IconButton
										variant="ghost"
										size="sm"
										aria-label={m.editTerminalTemplate()}
										onClick={() => openEdit(t.id)}
									>
										<FiEdit2 />
									</IconButton>
									<IconButton
										variant="ghost"
										size="sm"
										colorPalette="red"
										aria-label={m.deleteTerminalTemplate()}
										onClick={() =>
											onChange(removeProjectTemplateDraft(templateDrafts, t.id))
										}
									>
										<FiTrash2 />
									</IconButton>
								</HStack>
							</Flex>
						))}
					</Stack>
				)}
			</Stack>

			{draft ? (
				<TerminalTemplateDraftDialog
					draft={draft}
					isOpen={isOpen}
					isEditing={isEditing}
					showCwd
					onChange={setDraft}
					onClose={closeDialog}
					onDelete={handleDelete}
					onSave={handleCommit}
				/>
			) : null}
		</>
	);
}
