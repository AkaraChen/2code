import {
	Button,
	CloseButton,
	Code,
	Dialog,
	Field,
	HStack,
	Input,
	Portal,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { basename } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { FiEdit2 } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import type { QuickTaskDraft } from "./types";

interface QuickTaskDraftDialogProps {
	draft: QuickTaskDraft;
	isOpen: boolean;
	isEditing: boolean;
	canDelete?: boolean;
	onChange: (draft: QuickTaskDraft) => void;
	onClose: () => void;
	onDelete: () => void;
	onSave: () => void;
}

export function QuickTaskDraftDialog({
	draft,
	isOpen,
	isEditing,
	canDelete = true,
	onChange,
	onClose,
	onDelete,
	onSave,
}: QuickTaskDraftDialogProps) {
	const canSave =
		draft.name.trim().length > 0 &&
		draft.cwd.trim().length > 0 &&
		draft.command.trim().length > 0;

	async function chooseFolder() {
		const selected = await open({ directory: true });
		if (!selected) return;

		onChange({
			...draft,
			cwd: selected,
			name: draft.name.trim() ? draft.name : await basename(selected),
		});
	}

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			size="lg"
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>
								{isEditing
									? m.editQuickTask()
									: m.addQuickTask()}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Stack gap="4">
								<Field.Root required>
									<Field.Label>
										{m.quickTaskName()}
									</Field.Label>
									<Input
										value={draft.name}
										onChange={(event) =>
											onChange({
												...draft,
												name: event.target.value,
											})
										}
										placeholder={m.quickTaskNamePlaceholder()}
									/>
								</Field.Root>

								<Field.Root required>
									<Field.Label>
										{m.quickTaskCwd()}
									</Field.Label>
									{draft.cwd ? (
										<Stack gap="2">
											<HStack justify="space-between">
												<Code
													variant="surface"
													size="sm"
													display="block"
													px="3"
													py="2"
													rounded="md"
													truncate
													flex="1"
													minW="0"
												>
													{draft.cwd}
												</Code>
												<Button
													size="xs"
													variant="outline"
													onClick={chooseFolder}
												>
													<FiEdit2 />
													{m.chooseFolder()}
												</Button>
											</HStack>
										</Stack>
									) : (
										<Button
											variant="outline"
											onClick={chooseFolder}
										>
											{m.chooseFolder()}
										</Button>
									)}
								</Field.Root>

								<Field.Root>
									<Field.Label>
										{m.quickTaskShell()}
									</Field.Label>
									<Input
										value={draft.shell}
										onChange={(event) =>
											onChange({
												...draft,
												shell: event.target.value,
											})
										}
										placeholder={m.quickTaskShellPlaceholder()}
										fontFamily="mono"
										fontSize="sm"
									/>
								</Field.Root>

								<Field.Root required>
									<Field.Label>
										{m.quickTaskCommand()}
									</Field.Label>
									<Text fontSize="xs" color="fg.muted" mb="1">
										{m.quickTaskCommandDescription()}
									</Text>
									<Textarea
										value={draft.command}
										onChange={(event) =>
											onChange({
												...draft,
												command: event.target.value,
											})
										}
										placeholder={m.quickTaskCommandPlaceholder()}
										rows={8}
										fontFamily="mono"
										fontSize="sm"
									/>
								</Field.Root>
							</Stack>
						</Dialog.Body>
						<Dialog.Footer justifyContent="space-between">
							<HStack>
								<Dialog.ActionTrigger asChild>
									<Button variant="outline">
										{m.cancel()}
									</Button>
								</Dialog.ActionTrigger>
								{isEditing ? (
									<Button
										colorPalette="red"
										variant="subtle"
										disabled={!canDelete}
										onClick={onDelete}
									>
										{m.delete()}
									</Button>
								) : null}
							</HStack>
							<Button onClick={onSave} disabled={!canSave}>
								{m.save()}
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
