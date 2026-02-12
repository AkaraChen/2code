import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Input,
	Portal,
} from "@chakra-ui/react";
import { useState } from "react";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import { useCreateProfile } from "./hooks";

interface CreateProfileDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
}

export default function CreateProfileDialog({
	isOpen,
	onClose,
	projectId,
}: CreateProfileDialogProps) {
	const [branchName, setBranchName] = useState("");
	const createProfile = useCreateProfile();
	const navigate = useNavigate();

	const handleClose = () => {
		setBranchName("");
		onClose();
	};

	const handleCreate = async () => {
		const profile = await createProfile.mutateAsync({
			projectId,
			branchName,
		});
		handleClose();
		navigate(`/projects/${projectId}/profiles/${profile.id}`);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && branchName.trim() && !createProfile.isPending) {
			handleCreate();
		}
	};

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) handleClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>{m.createProfile()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Field.Root>
								<Field.Label>{m.branchName()}</Field.Label>
								<Input
									placeholder={m.branchNamePlaceholder()}
									value={branchName}
									onChange={(e) =>
										setBranchName(e.target.value)
									}
									onKeyDown={handleKeyDown}
								/>
							</Field.Root>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button
								disabled={
									!branchName.trim() ||
									createProfile.isPending
								}
								loading={createProfile.isPending}
								onClick={handleCreate}
							>
								{m.create()}
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
