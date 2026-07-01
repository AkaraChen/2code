import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
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
import { Spinner } from "@/components/ui/spinner";
import * as m from "@/paraglide/messages.js";
import { useCreateProfile } from "./hooks";

interface CreateProfileDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
}

interface FormValues {
	branchName: string;
}

export default function CreateProfileDialog({
	isOpen,
	onClose,
	projectId,
}: CreateProfileDialogProps) {
	const form = useForm<FormValues>({
		defaultValues: { branchName: "" },
	});
	const createProfile = useCreateProfile();
	const navigate = useNavigate();

	const handleClose = () => {
		form.reset();
		onClose();
	};

	const handleCreate = form.handleSubmit(async (data) => {
		const profile = await createProfile.mutateAsync({
			projectId,
			branchName: data.branchName,
		});
		handleClose();
		navigate(`/projects/${projectId}/profiles/${profile.id}`);
	});

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) handleClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.createProfile()}</DialogTitle>
				</DialogHeader>
				<Field>
					<FieldLabel>{m.branchName()}</FieldLabel>
					<Input
						placeholder={m.branchNamePlaceholder()}
						{...form.register("branchName")}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !createProfile.isPending) {
								handleCreate();
							}
						}}
					/>
				</Field>
				<DialogFooter>
					<Button variant="outline" onClick={handleClose}>
						{m.cancel()}
					</Button>
					<Button
						disabled={createProfile.isPending}
						onClick={handleCreate}
					>
						{createProfile.isPending ? <Spinner /> : null}
						{m.create()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
