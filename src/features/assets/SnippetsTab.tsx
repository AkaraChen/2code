import {
	Alert,
	Button,
	CloseButton,
	Code,
	Dialog,
	EmptyState,
	Field,
	Flex,
	HStack,
	IconButton,
	Input,
	Portal,
	Stack,
	Table,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import {
	useCreateSnippet,
	useDeleteSnippet,
	useSnippets,
	useUpdateSnippet,
} from "./hooks/useSnippets";

interface SnippetFormData {
	name: string;
	trigger: string;
	content: string;
}

export function SnippetsTab() {
	const { data: snippets } = useSnippets();
	const createMutation = useCreateSnippet();
	const updateMutation = useUpdateSnippet();
	const deleteMutation = useDeleteSnippet();
	const [editingId, setEditingId] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
	const lastAutoSyncedNameRef = useRef("");

	const form = useForm<SnippetFormData>({
		defaultValues: { name: "", trigger: "", content: "" },
	});

	const openCreate = () => {
		setEditingId(null);
		lastAutoSyncedNameRef.current = "";
		form.reset({ name: "", trigger: "", content: "" });
		setDialogOpen(true);
	};

	const openEdit = (snippet: {
		id: string;
		name: string;
		trigger: string;
		content: string;
	}) => {
		setEditingId(snippet.id);
		lastAutoSyncedNameRef.current = "";
		form.reset({
			name: snippet.name,
			trigger: snippet.trigger,
			content: snippet.content,
		});
		setDialogOpen(true);
	};

	const nameField = form.register("name", { required: true });
	const triggerField = form.register("trigger", { required: true });
	const contentField = form.register("content", { required: true });

	const onSubmit = form.handleSubmit(async (data) => {
		if (editingId) {
			await updateMutation.mutateAsync({
				id: editingId,
				changeset: {
					name: data.name,
					trigger: data.trigger,
					content: data.content,
				},
			});
		} else {
			await createMutation.mutateAsync(data);
		}
		setDialogOpen(false);
	});

	return (
		<Stack gap="4">
			<Alert.Root status="info" size="sm">
				<Alert.Indicator />
				<Alert.Content>
					<Alert.Description>
						{m.snippetsDescription()}
					</Alert.Description>
				</Alert.Content>
			</Alert.Root>

			<Flex>
				<Button size="sm" onClick={openCreate}>
					<LuPlus /> {m.create()}
				</Button>
			</Flex>

			{snippets.length === 0 ? (
				<EmptyState.Root>
					<EmptyState.Content>
						<EmptyState.Description>
							{m.noSnippetsYet()}
						</EmptyState.Description>
					</EmptyState.Content>
				</EmptyState.Root>
			) : (
				<Table.Root size="sm" variant="outline">
					<Table.Header>
						<Table.Row>
							<Table.ColumnHeader>
								{m.snippetName()}
							</Table.ColumnHeader>
							<Table.ColumnHeader>
								{m.snippetTrigger()}
							</Table.ColumnHeader>
							<Table.ColumnHeader>
								{m.snippetContent()}
							</Table.ColumnHeader>
							<Table.ColumnHeader w="100px" />
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{snippets.map((snippet) => (
							<Table.Row key={snippet.id}>
								<Table.Cell>{snippet.name}</Table.Cell>
								<Table.Cell>
									<Code size="sm">{snippet.trigger}</Code>
								</Table.Cell>
								<Table.Cell>
									<Text truncate maxW="200px">
										{snippet.content}
									</Text>
								</Table.Cell>
								<Table.Cell>
									<HStack>
										<IconButton
											size="xs"
											variant="ghost"
											onClick={() => openEdit(snippet)}
											aria-label="Edit"
										>
											<LuPencil />
										</IconButton>
										<IconButton
											size="xs"
											variant="ghost"
											colorPalette="red"
											onClick={() =>
												setDeleteTarget(snippet.id)
											}
											aria-label="Delete"
										>
											<LuTrash2 />
										</IconButton>
									</HStack>
								</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table.Root>
			)}

			{/* Create/Edit dialog */}
			<Dialog.Root
				lazyMount
				open={dialogOpen}
				onOpenChange={(e) => setDialogOpen(e.open)}
			>
				<Portal>
					<Dialog.Backdrop />
					<Dialog.Positioner>
						<Dialog.Content>
							<Dialog.Header>
								<Dialog.Title>
									{editingId
										? m.editSnippet()
										: m.createSnippet()}
								</Dialog.Title>
							</Dialog.Header>
							<Dialog.Body>
								<Stack gap="4">
									<Field.Root>
										<Field.Label>
											{m.snippetName()}
										</Field.Label>
										<Input
											{...nameField}
											onChange={(event) => {
												nameField.onChange(event);

												if (editingId !== null) {
													return;
												}

												const nextName =
													event.target.value;
												const currentContent =
													form.getValues("content");
												const shouldSyncContent =
													currentContent.trim() ===
														"" ||
													currentContent ===
														lastAutoSyncedNameRef.current;

												if (!shouldSyncContent) {
													return;
												}

												form.setValue(
													"content",
													nextName,
													{
														shouldDirty: false,
														shouldTouch: true,
													},
												);
												lastAutoSyncedNameRef.current =
													nextName;
											}}
											placeholder={m.snippetNamePlaceholder()}
											autoComplete="off"
										/>
									</Field.Root>
									<Field.Root>
										<Field.Label>
											{m.snippetTrigger()}
										</Field.Label>
										<Input
											{...triggerField}
											placeholder={m.snippetTriggerPlaceholder()}
											autoComplete="off"
										/>
									</Field.Root>
									<Field.Root>
										<Field.Label>
											{m.snippetContent()}
										</Field.Label>
										<Textarea
											{...contentField}
											placeholder={m.snippetContentPlaceholder()}
											rows={4}
											autoComplete="off"
										/>
									</Field.Root>
								</Stack>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.ActionTrigger asChild>
									<Button variant="outline">
										{m.cancel()}
									</Button>
								</Dialog.ActionTrigger>
								<Button
									onClick={onSubmit}
									loading={
										createMutation.isPending ||
										updateMutation.isPending
									}
								>
									{editingId ? m.save() : m.create()}
								</Button>
							</Dialog.Footer>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Content>
					</Dialog.Positioner>
				</Portal>
			</Dialog.Root>

			{/* Delete confirmation dialog */}
			<Dialog.Root
				lazyMount
				open={deleteTarget !== null}
				onOpenChange={(e) => {
					if (!e.open) setDeleteTarget(null);
				}}
			>
				<Portal>
					<Dialog.Backdrop />
					<Dialog.Positioner>
						<Dialog.Content>
							<Dialog.Header>
								<Dialog.Title>
									{m.deleteSnippet()}
								</Dialog.Title>
							</Dialog.Header>
							<Dialog.Body>
								<Text>{m.confirmDeleteSnippet()}</Text>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.ActionTrigger asChild>
									<Button variant="outline">
										{m.cancel()}
									</Button>
								</Dialog.ActionTrigger>
								<Button
									colorPalette="red"
									onClick={() => {
										if (deleteTarget) {
											deleteMutation.mutate(deleteTarget);
										}
										setDeleteTarget(null);
									}}
								>
									{m.delete()}
								</Button>
							</Dialog.Footer>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Content>
					</Dialog.Positioner>
				</Portal>
			</Dialog.Root>
		</Stack>
	);
}
