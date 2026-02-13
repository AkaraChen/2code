import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Input,
	Portal,
} from "@chakra-ui/react";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import * as m from "@/paraglide/messages.js";
import { useRenameProject } from "./hooks";

interface RenameProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	initName: string;
}

interface FormValues {
	name: string;
}

export default function RenameProjectDialog({
	isOpen,
	onClose,
	projectId,
	initName,
}: RenameProjectDialogProps) {
	const form = useForm<FormValues>({
		defaultValues: { name: initName },
	});
	const renameProject = useRenameProject();

	// Reset to current name when dialog opens (initName may change between opens)
	useEffect(() => {
		if (isOpen) form.reset({ name: initName });
	}, [isOpen, initName, form]);

	const handleRename = form.handleSubmit(async (data) => {
		const trimmed = data.name.trim();
		if (!trimmed || trimmed === initName) {
			onClose();
			return;
		}
		await renameProject.mutateAsync({ id: projectId, name: trimmed });
		onClose();
	});

	const name = useWatch({ control: form.control, name: "name" });

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
			initialFocusEl={() =>
				document.querySelector<HTMLInputElement>("[data-rename-input]")
			}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>{m.renameProject()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Field.Root>
								<Field.Label>{m.newName()}</Field.Label>
								<Input
									data-rename-input
									{...form.register("name")}
									onKeyDown={(e) => {
										if (e.key === "Enter") handleRename();
									}}
								/>
							</Field.Root>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button
								onClick={handleRename}
								disabled={
									!name.trim() || name.trim() === initName
								}
							>
								{m.rename()}
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
