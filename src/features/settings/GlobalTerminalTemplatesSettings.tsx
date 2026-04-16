import {
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { FiEdit2, FiTrash2 } from "react-icons/fi";
import {
	commandPreview,
	createEmptyGlobalTerminalTemplateDraft,
	normalizeGlobalTerminalTemplates,
	toGlobalTerminalTemplateDraft,
	type GlobalTerminalTemplateDraft,
} from "@/features/terminal/templates";
import { TerminalTemplateDraftDialog } from "@/features/terminal/TerminalTemplateDraftDialog";
import * as m from "@/paraglide/messages.js";
import { useTerminalTemplatesStore } from "./stores/terminalTemplatesStore";

export function GlobalTerminalTemplatesSettings() {
	const templates = useTerminalTemplatesStore((s) => s.templates);
	const setTemplates = useTerminalTemplatesStore((s) => s.setTemplates);
	const replaceTemplates = useMutation({
		mutationFn: async (nextTemplates: typeof templates) => nextTemplates,
		onSuccess: (nextTemplates) => {
			setTemplates(nextTemplates);
		},
	});
	const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
	const [draft, setDraft] = useState<GlobalTerminalTemplateDraft | null>(null);

	const isOpen = draft !== null;
	const isEditing = editingTemplateId !== null;

	function openCreateDialog() {
		setEditingTemplateId(null);
		setDraft(createEmptyGlobalTerminalTemplateDraft());
	}

	function openEditDialog(templateId: string) {
		const template = templates.find((item) => item.id === templateId);
		if (!template) return;
		setEditingTemplateId(template.id);
		setDraft(toGlobalTerminalTemplateDraft(template));
	}

	function closeDialog() {
		setEditingTemplateId(null);
		setDraft(null);
	}

	async function handleSave() {
		if (!draft) return;
		const [normalizedTemplate] = normalizeGlobalTerminalTemplates([draft]);
		if (!normalizedTemplate) return;

		if (editingTemplateId) {
			await replaceTemplates.mutateAsync(
				templates.map((template) =>
					template.id === editingTemplateId ? normalizedTemplate : template,
				),
			);
		} else {
			await replaceTemplates.mutateAsync([...templates, normalizedTemplate]);
		}

		closeDialog();
	}

	async function handleDelete() {
		if (!editingTemplateId) return;
		await replaceTemplates.mutateAsync(
			templates.filter((template) => template.id !== editingTemplateId),
		);
		closeDialog();
	}

	return (
		<>
			<Stack gap="4">
				<HStack justify="space-between" align="start">
					<Stack gap="1">
						<Text fontWeight="semibold">{m.globalTerminalTemplates()}</Text>
						<Text fontSize="sm" color="fg.muted">
							{m.globalTerminalTemplatesDescription()}
						</Text>
					</Stack>
					<Button
						size="sm"
						variant="outline"
						onClick={openCreateDialog}
						disabled={replaceTemplates.isPending}
					>
						{m.addTerminalTemplate()}
					</Button>
				</HStack>

				{templates.length === 0 ? (
					<Box rounded="l3" borderWidth="1px" borderColor="border" px="4" py="3">
						<Text fontSize="sm" color="fg.muted">
							{m.noTerminalTemplates()}
						</Text>
					</Box>
				) : (
					<Stack gap="2">
						{templates.map((template) => (
							<Flex
								key={template.id}
								rounded="l3"
								borderWidth="1px"
								borderColor="border"
								px="4"
								py="3"
								align="center"
								justify="space-between"
								gap="4"
							>
								<Stack gap="1" minW="0">
									<Text fontWeight="medium" truncate>
										{template.name}
									</Text>
									<Text
										fontSize="sm"
										color="fg.muted"
										fontFamily="mono"
										truncate
									>
										{commandPreview(template.commands.join("\n"))}
									</Text>
								</Stack>
								<HStack gap="1" flexShrink="0">
									<IconButton
										variant="ghost"
										size="sm"
										aria-label={m.editTerminalTemplate()}
										onClick={() => openEditDialog(template.id)}
										disabled={replaceTemplates.isPending}
									>
										<FiEdit2 />
									</IconButton>
									<IconButton
										variant="ghost"
										size="sm"
										colorPalette="red"
										aria-label={m.deleteTerminalTemplate()}
										onClick={() => openEditDialog(template.id)}
										disabled={replaceTemplates.isPending}
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
					isPending={replaceTemplates.isPending}
					onChange={setDraft}
					onClose={closeDialog}
					onDelete={handleDelete}
					onSave={handleSave}
				/>
			) : null}
		</>
	);
}
