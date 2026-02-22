import {
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
import { useState } from "react";
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

	const form = useForm<SnippetFormData>({
		defaultValues: { name: "", trigger: "", content: "" },
	});

	const openCreate = () => {
		setEditingId(null);
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
		form.reset({
			name: snippet.name,
			trigger: snippet.trigger,
			content: snippet.content,
		});
		setDialogOpen(true);
	};

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
			<Flex justify="flex-end">
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
												deleteMutation.mutate(
													snippet.id,
												)
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
											{...form.register("name", {
												required: true,
											})}
											placeholder={m.snippetNamePlaceholder()}
										/>
									</Field.Root>
									<Field.Root>
										<Field.Label>
											{m.snippetTrigger()}
										</Field.Label>
										<Input
											{...form.register("trigger", {
												required: true,
											})}
											placeholder={m.snippetTriggerPlaceholder()}
										/>
									</Field.Root>
									<Field.Root>
										<Field.Label>
											{m.snippetContent()}
										</Field.Label>
										<Textarea
											{...form.register("content", {
												required: true,
											})}
											placeholder={m.snippetContentPlaceholder()}
											rows={4}
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
		</Stack>
	);
}
