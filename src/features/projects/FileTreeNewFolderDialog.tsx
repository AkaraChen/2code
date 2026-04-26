import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Input,
	Portal,
} from "@chakra-ui/react";
import { type FormEvent, useEffect, useState } from "react";
import * as m from "@/paraglide/messages.js";

interface FileTreeNewFolderDialogProps {
	isOpen: boolean;
	parentRelativePath: string;
	mode?: "folder" | "file";
	onClose: () => void;
	onSubmit: (relativePath: string) => Promise<void> | void;
}

const TRAILING_PATH_SEPARATOR_RE = /[\\/]+$/;

function joinRelativePath(parent: string, name: string) {
	const trimmedParent = parent.replace(TRAILING_PATH_SEPARATOR_RE, "");
	if (!trimmedParent) return name;
	return `${trimmedParent}/${name}`;
}

export default function FileTreeNewFolderDialog({
	isOpen,
	parentRelativePath,
	mode = "folder",
	onClose,
	onSubmit,
}: FileTreeNewFolderDialogProps) {
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isFile = mode === "file";
	const title = isFile
		? m.fileTreeNewFileTitle()
		: m.fileTreeNewFolderTitle();
	const label = isFile
		? m.fileTreeNewFileLabel()
		: m.fileTreeNewFolderLabel();
	const placeholder = isFile
		? m.fileTreeNewFilePlaceholder()
		: m.fileTreeNewFolderPlaceholder();

	useEffect(() => {
		if (isOpen) {
			setName("");
			setError(null);
			setIsSubmitting(false);
		}
	}, [isOpen]);

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		if (trimmed.includes("/") || trimmed.includes("\\")) {
			setError(
				isFile
					? "File name cannot contain path separators"
					: "Folder name cannot contain path separators",
			);
			return;
		}
		setIsSubmitting(true);
		try {
			await onSubmit(joinRelativePath(parentRelativePath, trimmed));
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content asChild>
						<form onSubmit={handleSubmit}>
							<Dialog.Header>
								<Dialog.Title>{title}</Dialog.Title>
							</Dialog.Header>
							<Dialog.Body>
								<Field.Root invalid={!!error}>
									<Field.Label>{label}</Field.Label>
									<Input
										value={name}
										placeholder={placeholder}
										onChange={(e) => {
											setName(e.target.value);
											if (error) setError(null);
										}}
									/>
									{error && <Field.ErrorText>{error}</Field.ErrorText>}
								</Field.Root>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.ActionTrigger asChild>
									<Button variant="outline" type="button">
										{m.cancel()}
									</Button>
								</Dialog.ActionTrigger>
								<Button
									type="submit"
									disabled={!name.trim() || isSubmitting}
								>
									{m.create()}
								</Button>
							</Dialog.Footer>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</form>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
