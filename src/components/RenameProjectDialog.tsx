import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Input,
	Portal,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useProjects } from "@/contexts/ProjectContext";
import * as m from "@/paraglide/messages.js";

interface RenameProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
	project: { id: string; name: string };
}

export default function RenameProjectDialog({
	isOpen,
	onClose,
	project,
}: RenameProjectDialogProps) {
	const [name, setName] = useState(project.name);
	const { renameProject } = useProjects();
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (isOpen) {
			setName(project.name);
		}
	}, [isOpen, project.name]);

	const handleRename = async () => {
		const trimmed = name.trim();
		if (!trimmed || trimmed === project.name) {
			onClose();
			return;
		}
		await renameProject(project.id, trimmed);
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
								<Button variant="outline">
									{m.cancel()}
								</Button>
							</Dialog.ActionTrigger>
							<Button
								onClick={handleRename}
								disabled={!name.trim() || name.trim() === project.name}
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
