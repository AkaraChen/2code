import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				initialFocus={() =>
					document.querySelector<HTMLInputElement>("[data-rename-input]")
				}
			>
				<DialogHeader>
					<DialogTitle>{m.renameProject()}</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleRename} className="contents">
					<Field>
						<FieldLabel>{m.newName()}</FieldLabel>
						<Input data-rename-input {...form.register("name")} />
					</Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							{m.cancel()}
						</Button>
						<Button
							type="submit"
							disabled={!name.trim() || name.trim() === initName}
						>
							{m.rename()}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
