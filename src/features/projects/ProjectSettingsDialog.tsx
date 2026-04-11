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
	Spinner,
	Stack,
	Tabs,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { FiEdit2, FiTrash2 } from "react-icons/fi";
import {
	commandPreview,
	commandsToText,
	createEmptyProjectTerminalTemplateDraft,
	normalizeProjectTerminalTemplates,
	textToCommands,
	toProjectTerminalTemplateDraft,
	type ProjectTerminalTemplateDraft,
} from "@/features/terminal/templates";
import * as m from "@/paraglide/messages.js";
import { useProjectConfig, useSaveProjectConfig } from "./hooks";

interface ProjectSettingsDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
}

interface FormValues {
	initScript: string;
	setupScript: string;
	teardownScript: string;
}

// ── Project template draft dialog ─────────────────────────────────────────────

interface ProjectTemplateDraftDialogProps {
	draft: ProjectTerminalTemplateDraft;
	isOpen: boolean;
	isEditing: boolean;
	onChange: (draft: ProjectTerminalTemplateDraft) => void;
	onClose: () => void;
	onDelete: () => void;
	onCommit: () => void;
}

function ProjectTemplateDraftDialog({
	draft,
	isOpen,
	isEditing,
	onChange,
	onClose,
	onDelete,
	onCommit,
}: ProjectTemplateDraftDialogProps) {
	const canSave = draft.name.trim().length > 0;

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			size="lg"
			onOpenChange={(e) => {
				if (!e.open) onClose();
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
										onChange={(e) =>
											onChange({
												...draft,
												name: e.target.value,
											})
										}
										placeholder={m.terminalTemplateNamePlaceholder()}
									/>
								</Field.Root>
								<Field.Root>
									<Field.Label>
										{m.terminalTemplateCwd()}
									</Field.Label>
									<Text
										fontSize="xs"
										color="fg.muted"
										mb="1"
									>
										{m.terminalTemplateCwdDescription()}
									</Text>
									<Input
										value={draft.cwd}
										onChange={(e) =>
											onChange({
												...draft,
												cwd: e.target.value,
											})
										}
										placeholder={m.terminalTemplateCwdPlaceholder()}
										fontFamily="mono"
										fontSize="sm"
									/>
								</Field.Root>
								<Field.Root required>
									<Field.Label>
										{m.terminalTemplateCommands()}
									</Field.Label>
									<Text
										fontSize="xs"
										color="fg.muted"
										mb="1"
									>
										{m.terminalTemplateCommandsDescription()}
									</Text>
									<Textarea
										value={draft.commandsText}
										onChange={(e) =>
											onChange({
												...draft,
												commandsText: e.target.value,
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
									<Button variant="outline">
										{m.cancel()}
									</Button>
								</Dialog.ActionTrigger>
								{isEditing ? (
									<Button
										colorPalette="red"
										variant="subtle"
										onClick={onDelete}
									>
										{m.delete()}
									</Button>
								) : null}
							</HStack>
							<Button onClick={onCommit} disabled={!canSave}>
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

// ── Project templates tab content ─────────────────────────────────────────────

interface ProjectTemplatesEditorProps {
	templateDrafts: ProjectTerminalTemplateDraft[];
	onChange: (drafts: ProjectTerminalTemplateDraft[]) => void;
}

function ProjectTemplatesEditor({
	templateDrafts,
	onChange,
}: ProjectTemplatesEditorProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState<ProjectTerminalTemplateDraft | null>(
		null,
	);

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
			onChange(
				templateDrafts.map((t) => (t.id === editingId ? draft : t)),
			);
		} else {
			onChange([...templateDrafts, draft]);
		}
		closeDialog();
	}

	function handleDelete() {
		if (!editingId) return;
		onChange(templateDrafts.filter((t) => t.id !== editingId));
		closeDialog();
	}

	return (
		<>
			<Stack gap="4">
				<HStack justify="space-between" align="start">
					<Stack gap="1">
						<Text fontWeight="semibold">
							{m.projectTerminalTemplates()}
						</Text>
						<Text fontSize="sm" color="fg.muted">
							{m.projectTerminalTemplatesDescription()}
						</Text>
					</Stack>
					<Button
						size="sm"
						variant="outline"
						onClick={openCreate}
					>
						{m.addTerminalTemplate()}
					</Button>
				</HStack>

				{templateDrafts.length === 0 ? (
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
						{templateDrafts.map((t) => (
							<Flex
								key={t.id}
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
											onChange(
												templateDrafts.filter(
													(x) => x.id !== t.id,
												),
											)
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
				<ProjectTemplateDraftDialog
					draft={draft}
					isOpen={isOpen}
					isEditing={isEditing}
					onChange={setDraft}
					onClose={closeDialog}
					onDelete={handleDelete}
					onCommit={handleCommit}
				/>
			) : null}
		</>
	);
}

// ── Main form ─────────────────────────────────────────────────────────────────

function ProjectSettingsForm({
	projectId,
	onClose,
}: {
	projectId: string;
	onClose: () => void;
}) {
	const { data: config } = useProjectConfig(projectId);
	const saveConfig = useSaveProjectConfig();
	const [templateDrafts, setTemplateDrafts] = useState<
		ProjectTerminalTemplateDraft[]
	>(() =>
		(config.terminal_templates ?? []).map(toProjectTerminalTemplateDraft),
	);
	const form = useForm<FormValues>({
		defaultValues: {
			initScript: commandsToText(config.init_script),
			setupScript: commandsToText(config.setup_script),
			teardownScript: commandsToText(config.teardown_script),
		},
	});

	const handleSave = form.handleSubmit(async (data) => {
		await saveConfig.mutateAsync({
			projectId,
			config: {
				init_script: textToCommands(data.initScript),
				setup_script: textToCommands(data.setupScript),
				teardown_script: textToCommands(data.teardownScript),
				terminal_templates:
					normalizeProjectTerminalTemplates(templateDrafts),
			},
		});
		onClose();
	});

	return (
		<>
			<Dialog.Body pb="2">
				<Tabs.Root defaultValue="scripts" variant="plain">
					<Tabs.List bg="bg.muted" rounded="l3" p="1" mb="5">
						<Tabs.Trigger value="scripts">
							{m.scripts()}
						</Tabs.Trigger>
						<Tabs.Trigger value="templates">
							{m.templates()}
						</Tabs.Trigger>
						<Tabs.Indicator rounded="l2" />
					</Tabs.List>

					<Tabs.Content value="scripts">
						<Stack gap="5">
							<Field.Root>
								<Field.Label>{m.initScript()}</Field.Label>
								<Text
									fontSize="xs"
									color="fg.muted"
									mb="1"
								>
									{m.initScriptDesc()}
								</Text>
								<Textarea
									{...form.register("initScript")}
									placeholder={m.scriptPlaceholder()}
									rows={4}
									fontFamily="mono"
									fontSize="sm"
								/>
							</Field.Root>

							<Field.Root>
								<Field.Label>{m.setupScript()}</Field.Label>
								<Text
									fontSize="xs"
									color="fg.muted"
									mb="1"
								>
									{m.setupScriptDesc()}
								</Text>
								<Textarea
									{...form.register("setupScript")}
									placeholder={m.scriptPlaceholder()}
									rows={4}
									fontFamily="mono"
									fontSize="sm"
								/>
							</Field.Root>

							<Field.Root>
								<Field.Label>
									{m.teardownScript()}
								</Field.Label>
								<Text
									fontSize="xs"
									color="fg.muted"
									mb="1"
								>
									{m.teardownScriptDesc()}
								</Text>
								<Textarea
									{...form.register("teardownScript")}
									placeholder={m.scriptPlaceholder()}
									rows={4}
									fontFamily="mono"
									fontSize="sm"
								/>
							</Field.Root>
						</Stack>
					</Tabs.Content>

					<Tabs.Content value="templates">
						<ProjectTemplatesEditor
							templateDrafts={templateDrafts}
							onChange={setTemplateDrafts}
						/>
					</Tabs.Content>
				</Tabs.Root>
			</Dialog.Body>
			<Dialog.Footer>
				<Dialog.ActionTrigger asChild>
					<Button variant="outline">{m.cancel()}</Button>
				</Dialog.ActionTrigger>
				<Button
					onClick={handleSave}
					loading={saveConfig.isPending}
				>
					{m.save()}
				</Button>
			</Dialog.Footer>
		</>
	);
}

// ── Dialog shell ──────────────────────────────────────────────────────────────

export default function ProjectSettingsDialog({
	isOpen,
	onClose,
	projectId,
}: ProjectSettingsDialogProps) {
	return (
		<Dialog.Root
			lazyMount
			unmountOnExit
			open={isOpen}
			size="lg"
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>
								{m.projectSettings()}
							</Dialog.Title>
						</Dialog.Header>
						<Suspense
							fallback={
								<Dialog.Body>
									<Stack
										alignItems="center"
										justifyContent="center"
										minH="200px"
									>
										<Spinner
											size="md"
											color="colorPalette.500"
										/>
									</Stack>
								</Dialog.Body>
							}
						>
							<ProjectSettingsForm
								projectId={projectId}
								onClose={onClose}
							/>
						</Suspense>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
