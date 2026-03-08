import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Input,
	Portal,
	Stack,
	Textarea,
} from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import * as m from "@/paraglide/messages.js";
import {
	useCreateSnippet,
	useUpdateSnippet,
} from "@/features/assets/hooks/useSnippets";

interface SnippetFormData {
	name: string;
	trigger: string;
	content: string;
}

interface SnippetFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editingSnippet: {
		id: string;
		name: string;
		trigger: string;
		content: string;
	} | null;
}

export function SnippetFormDialog({
	open,
	onOpenChange,
	editingSnippet,
}: SnippetFormDialogProps) {
	const createMutation = useCreateSnippet();
	const updateMutation = useUpdateSnippet();
	const lastAutoSyncedNameRef = useRef("");

	const form = useForm<SnippetFormData>({
		defaultValues: { name: "", trigger: "", content: "" },
	});

	// Reset form when opening/changing target
	useEffect(() => {
		if (open) {
			if (editingSnippet) {
				lastAutoSyncedNameRef.current = "";
				form.reset({
					name: editingSnippet.name,
					trigger: editingSnippet.trigger,
					content: editingSnippet.content,
				});
			} else {
				lastAutoSyncedNameRef.current = "";
				form.reset({ name: "", trigger: "", content: "" });
			}
		}
	}, [open, editingSnippet, form]);

	const nameField = form.register("name", { required: true });
	const triggerField = form.register("trigger", { required: true });
	const contentField = form.register("content", { required: true });

	const onSubmit = form.handleSubmit(async (data) => {
		if (editingSnippet) {
			await updateMutation.mutateAsync({
				id: editingSnippet.id,
				changeset: {
					name: data.name,
					trigger: data.trigger,
					content: data.content,
				},
			});
		} else {
			await createMutation.mutateAsync(data);
		}
		onOpenChange(false);
	});

	return (
		<Dialog.Root
			lazyMount
			open={open}
			onOpenChange={(e) => onOpenChange(e.open)}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>
								{editingSnippet
									? m.editSnippet()
									: m.createSnippet()}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Stack gap="4">
								<Field.Root>
									<Field.Label>{m.snippetName()}</Field.Label>
									<Input
										{...nameField}
										onChange={(event) => {
											nameField.onChange(event);

											if (editingSnippet !== null) return;

											const nextName = event.target.value;
											const currentContent =
												form.getValues("content");
											const shouldSyncContent =
												currentContent.trim() === "" ||
												currentContent ===
													lastAutoSyncedNameRef.current;

											if (!shouldSyncContent) return;

											form.setValue("content", nextName, {
												shouldDirty: false,
												shouldTouch: true,
											});
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
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button
								onClick={onSubmit}
								loading={
									createMutation.isPending ||
									updateMutation.isPending
								}
							>
								{editingSnippet ? m.save() : m.create()}
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
