import {
	Button,
	ComposedModal,
	ModalBody,
	ModalFooter,
	ModalHeader,
	TextInput,
} from "@carbon/react";
import { FolderOpen } from "@carbon/react/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
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

	if (!isOpen) return null;

	return (
		<ComposedModal open onClose={handleClose}>
			<ModalHeader
				title={m.createProject()}
				buttonOnClick={handleClose}
			/>
			<ModalBody>
				<TextInput
					id="project-name"
					labelText={m.projectName()}
					placeholder={m.projectNamePlaceholder()}
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				<div
					style={{
						marginTop: "1rem",
						display: "flex",
						alignItems: "center",
						gap: "0.5rem",
					}}
				>
					<Button
						kind="tertiary"
						size="sm"
						renderIcon={FolderOpen}
						onClick={handleChooseFolder}
					>
						{m.chooseFolder()}
					</Button>
					{folder && (
						<span
							style={{
								fontSize: "0.875rem",
								color: "var(--cds-text-secondary)",
							}}
						>
							{folder}
						</span>
					)}
				</div>
			</ModalBody>
			{/* @ts-expect-error Carbon ModalFooter types require children but renders buttons via props */}
			<ModalFooter
				primaryButtonText={m.create()}
				secondaryButtonText={m.cancel()}
				onRequestSubmit={handleCreate}
				onRequestClose={handleClose}
			/>
		</ComposedModal>
	);
}
