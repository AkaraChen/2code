import { TerminalWindowIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import * as m from "@/paraglide/messages.js";
import type { GlobalTerminalTemplateDraft } from "./templates";

interface TerminalTemplateDraftDialogProps<
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
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<TerminalWindowIcon className="size-4 shrink-0" />
						{isEditing
							? m.editTerminalTemplate()
							: m.addTerminalTemplate()}
					</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<Field>
						<FieldLabel>{m.terminalTemplateName()}</FieldLabel>
						<Input
							value={draft.name}
							onChange={(event) =>
								onChange({ ...draft, name: event.target.value })
							}
							placeholder={m.terminalTemplateNamePlaceholder()}
						/>
					</Field>

					{showCwd ? (
						<Field>
							<FieldLabel>{m.terminalTemplateCwd()}</FieldLabel>
							<FieldDescription>
								{m.terminalTemplateCwdDescription()}
							</FieldDescription>
							<Input
								value={(draft as { cwd?: string }).cwd ?? ""}
								onChange={(event) =>
									onChange({ ...draft, cwd: event.target.value } as T)
								}
								placeholder={m.terminalTemplateCwdPlaceholder()}
								className="font-mono"
							/>
						</Field>
					) : null}

					<Field>
						<FieldLabel>{m.terminalTemplateCommands()}</FieldLabel>
						<FieldDescription>
							{m.terminalTemplateCommandsDescription()}
						</FieldDescription>
						<Textarea
							value={draft.commandsText}
							onChange={(event) =>
								onChange({
									...draft,
									commandsText: event.target.value,
								})
							}
							placeholder={m.scriptPlaceholder()}
							rows={8}
							className="font-mono"
						/>
					</Field>
				</div>
				<DialogFooter className="justify-between">
					<div className="flex gap-2">
						<Button variant="outline" onClick={onClose}>
							{m.cancel()}
						</Button>
						{isEditing ? (
							<Button
								variant="destructive"
								onClick={onDelete}
								disabled={isPending}
							>
								{isPending ? <Spinner /> : null}
								{m.delete()}
							</Button>
						) : null}
					</div>
					<Button onClick={onSave} disabled={!canSave || isPending}>
						{isPending ? <Spinner /> : null}
						{m.save()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
