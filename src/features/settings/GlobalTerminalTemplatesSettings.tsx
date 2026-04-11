import {
	Box,
	Button,
	CloseButton,
	Dialog,
	Field,
	Flex,
	HStack,
	IconButton,
	Input,
	Portal,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RiDeleteBinLine, RiPencilLine } from "react-icons/ri";
import {
	commandPreview,
	createEmptyGlobalTerminalTemplateDraft,
	normalizeGlobalTerminalTemplates,
	toGlobalTerminalTemplateDraft,
	type GlobalTerminalTemplateDraft,
} from "@/features/terminal/templates";
import * as m from "@/paraglide/messages.js";
import { useTerminalTemplatesStore } from "./stores/terminalTemplatesStore";

interface GlobalTerminalTemplateDialogProps {
	draft: GlobalTerminalTemplateDraft;
	isOpen: boolean;
	isEditing: boolean;
	isPending: boolean;
	onChange: (draft: GlobalTerminalTemplateDraft) => void;
	onClose: () => void;
	onDelete: () => void;
	onSave: () => void;
}

function GlobalTerminalTemplateDialog({
	draft,
	isOpen,
	isEditing,
	isPending,
	onChange,
	onClose,
	onDelete,
	onSave,
}: GlobalTerminalTemplateDialogProps) {
	const canSave = useMemo(
		() => normalizeGlobalTerminalTemplates([draft]).length > 0,
		[draft],
	);

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			size="lg"
			onOpenChange={(event) => {
				if (!event.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>
								{isEditing
									? m.editTerminalTemplate()
									: m.addTerminalTemplate()}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Stack gap="5">
								<Field.Root required>
									<Field.Label>
										{m.terminalTemplateName()}
									</Field.Label>
									<Input
										value={draft.name}
										onChange={(event) =>
											onChange({
												...draft,
												name: event.target.value,
											})
										}
										placeholder={m.terminalTemplateNamePlaceholder()}
									/>
								</Field.Root>

								<Field.Root required>
									<Field.Label>
										{m.terminalTemplateCommands()}
									</Field.Label>
									<Text fontSize="xs" color="fg.muted" mb="1">
										{m.terminalTemplateCommandsDescription()}
									</Text>
									<Textarea
										value={draft.commandsText}
										onChange={(event) =>
											onChange({
												...draft,
												commandsText: event.target.value,
											})
										}
										placeholder={m.scriptPlaceholder()}
										rows={8}
										fontFamily="mono"
										fontSize="sm"
									/>
								</Field.Root>
							</Stack>
						</Dialog.Body>
						<Dialog.Footer justifyContent="space-between">
							<HStack>
								<Dialog.ActionTrigger asChild>
									<Button variant="outline">{m.cancel()}</Button>
								</Dialog.ActionTrigger>
								{isEditing ? (
									<Button
										colorPalette="red"
										variant="subtle"
										onClick={onDelete}
										loading={isPending}
									>
										{m.delete()}
									</Button>
								) : null}
							</HStack>
							<Button
								onClick={onSave}
								disabled={!canSave}
								loading={isPending}
							>
								{m.save()}
							</Button>
						</Dialog.Footer>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}

export function GlobalTerminalTemplatesSettings() {
	const templates = useTerminalTemplatesStore((s) => s.templates);
	const setTemplates = useTerminalTemplatesStore((s) => s.setTemplates);
	const replaceTemplates = useMutation({
		mutationFn: async (nextTemplates: typeof templates) => nextTemplates,
		onSuccess: (nextTemplates) => {
			setTemplates(nextTemplates);
		},
	});
	const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
		null,
	);
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
					template.id === editingTemplateId
						? normalizedTemplate
						: template,
				),
			);
		} else {
			await replaceTemplates.mutateAsync([
				...templates,
				normalizedTemplate,
			]);
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
						<Text fontWeight="semibold">
							{m.globalTerminalTemplates()}
						</Text>
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
					<Box
						rounded="l3"
						borderWidth="1px"
						borderColor="border.subtle"
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
						{templates.map((template) => (
							<Flex
								key={template.id}
								rounded="l3"
								borderWidth="1px"
								borderColor="border.subtle"
								bg="bg.panel"
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
										<RiPencilLine />
									</IconButton>
									<IconButton
										variant="ghost"
										size="sm"
										colorPalette="red"
										aria-label={m.deleteTerminalTemplate()}
										onClick={() => openEditDialog(template.id)}
										disabled={replaceTemplates.isPending}
									>
										<RiDeleteBinLine />
									</IconButton>
								</HStack>
							</Flex>
						))}
					</Stack>
				)}
			</Stack>

			{draft ? (
				<GlobalTerminalTemplateDialog
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
