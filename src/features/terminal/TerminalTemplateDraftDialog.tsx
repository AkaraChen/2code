import {
	Button,
	CloseButton,
	Dialog,
	Field,
	HStack,
	Input,
	Portal,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import type { GlobalTerminalTemplateDraft } from "./templates";

export interface TerminalTemplateDraftDialogProps<
	T extends GlobalTerminalTemplateDraft,
> {
	draft: T;
	isOpen: boolean;
	isEditing: boolean;
	isPending?: boolean;
	showCwd?: boolean;
	onChange: (draft: T) => void;
	onClose: () => void;
	onDelete: () => void;
	onSave: () => void;
}

export function TerminalTemplateDraftDialog<T extends GlobalTerminalTemplateDraft>({
	draft,
	isOpen,
	isEditing,
	isPending,
	showCwd = false,
	onChange,
	onClose,
	onDelete,
	onSave,
}: TerminalTemplateDraftDialogProps<T>) {
	const canSave = draft.name.trim().length > 0;

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
									? m.editTerminalTemplate()
									: m.addTerminalTemplate()}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Stack gap="4">
								<Field.Root required>
									<Field.Label>{m.terminalTemplateName()}</Field.Label>
									<Input
										value={draft.name}
										onChange={(e) =>
											onChange({ ...draft, name: e.target.value })
										}
										placeholder={m.terminalTemplateNamePlaceholder()}
									/>
								</Field.Root>

								{showCwd ? (
									<Field.Root>
										<Field.Label>{m.terminalTemplateCwd()}</Field.Label>
										<Text fontSize="xs" color="fg.muted" mb="1">
											{m.terminalTemplateCwdDescription()}
										</Text>
										<Input
											value={(draft as { cwd?: string }).cwd ?? ""}
											onChange={(e) =>
												onChange({ ...draft, cwd: e.target.value } as T)
											}
											placeholder={m.terminalTemplateCwdPlaceholder()}
											fontFamily="mono"
											fontSize="sm"
										/>
									</Field.Root>
								) : null}

								<Field.Root required>
									<Field.Label>{m.terminalTemplateCommands()}</Field.Label>
									<Text fontSize="xs" color="fg.muted" mb="1">
										{m.terminalTemplateCommandsDescription()}
									</Text>
									<Textarea
										value={draft.commandsText}
										onChange={(e) =>
											onChange({ ...draft, commandsText: e.target.value })
										}
										placeholder={m.scriptPlaceholder()}
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
									<Button variant="outline">{m.cancel()}</Button>
								</Dialog.ActionTrigger>
								{isEditing ? (
									<Button
										colorPalette="red"
										variant="subtle"
										onClick={onDelete}
										loading={isPending}
									>
										{m.delete()}
									</Button>
								) : null}
							</HStack>
							<Button
								onClick={onSave}
								disabled={!canSave}
								loading={isPending}
							>
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
