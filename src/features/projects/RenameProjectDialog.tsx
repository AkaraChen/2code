import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Input,
	Portal,
} from "@chakra-ui/react";
import { useRef, useState } from "react";
import * as m from "@/paraglide/messages.js";
import { useRenameProject } from "./hooks";

interface RenameProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	initName: string;
}

export default function RenameProjectDialog({
	isOpen,
	onClose,
	projectId,
	initName,
}: RenameProjectDialogProps) {
	const [name, setName] = useState(initName);
	const renameProject = useRenameProject();
	const inputRef = useRef<HTMLInputElement>(null);

	const handleRename = async () => {
		const trimmed = name.trim();
		if (!trimmed || trimmed === initName) {
			onClose();
			return;
		}
		await renameProject.mutateAsync({ id: projectId, name: trimmed });
		onClose();
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleRename();
		}
	};

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
			initialFocusEl={() => inputRef.current}
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
									ref={inputRef}
									value={name}
									onChange={(e) => setName(e.target.value)}
									onKeyDown={handleKeyDown}
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
