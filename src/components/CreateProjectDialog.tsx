import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Input,
	Portal,
} from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { LuFolderOpen } from "react-icons/lu";
import { useNavigate } from "react-router";
import { useProjects } from "@/contexts/ProjectContext";
import * as m from "@/paraglide/messages.js";

interface CreateProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function CreateProjectDialog({
	isOpen,
	onClose,
}: CreateProjectDialogProps) {
	const [name, setName] = useState("");
	const [folder, setFolder] = useState<string | null>(null);
	const { createProject } = useProjects();
	const navigate = useNavigate();

	const reset = () => {
		setName("");
		setFolder(null);
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	const handleChooseFolder = async () => {
		const selected = await open({ directory: true });
		if (selected) {
			setFolder(selected);
			if (!name) {
				setName(selected.split("/").pop() || "");
			}
		}
	};

	const handleCreate = async () => {
		const opts: { name?: string; folder?: string } = {};
		if (name) opts.name = name;
		if (folder) opts.folder = folder;
		const project = await createProject(
			Object.keys(opts).length > 0 ? opts : undefined,
		);
		handleClose();
		navigate(`/projects/${project.id}`);
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
							<Dialog.Title>{m.createProject()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Field.Root>
								<Field.Label>{m.projectName()}</Field.Label>
								<Input
									placeholder={m.projectNamePlaceholder()}
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
							</Field.Root>
							<div className="mt-4 flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={handleChooseFolder}
								>
									<LuFolderOpen />
									{m.chooseFolder()}
								</Button>
								{folder && (
									<span className="text-sm" style={{ color: "var(--chakra-colors-fg-muted)" }}>
										{folder}
									</span>
								)}
							</div>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">
									{m.cancel()}
								</Button>
							</Dialog.ActionTrigger>
							<Button onClick={handleCreate}>
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
