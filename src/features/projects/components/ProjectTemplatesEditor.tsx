import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldTitle,
} from "@/components/ui/field";
import {
	commandPreview,
	createEmptyProjectTerminalTemplateDraft,
	type ProjectTerminalTemplateDraft,
} from "@/features/terminal/templates";
import { TerminalTemplateDraftDialog } from "@/features/terminal/TerminalTemplateDraftDialog";
import * as m from "@/paraglide/messages.js";

interface ProjectTemplatesEditorProps {
	templateDrafts: ProjectTerminalTemplateDraft[];
	onChange: (drafts: ProjectTerminalTemplateDraft[]) => void;
}

export function ProjectTemplatesEditor({
	templateDrafts,
	onChange,
}: ProjectTemplatesEditorProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState<ProjectTerminalTemplateDraft>(
		createEmptyProjectTerminalTemplateDraft,
	);
	const [isOpen, setIsOpen] = useState(false);

	const isEditing = editingId !== null;

	function openCreate() {
		setEditingId(null);
		setDraft(createEmptyProjectTerminalTemplateDraft());
		setIsOpen(true);
	}

	function openEdit(id: string) {
		const t = templateDrafts.find((t) => t.id === id);
		if (!t) return;
		setEditingId(id);
		setDraft({ ...t });
		setIsOpen(true);
	}

	function closeDialog() {
		setIsOpen(false);
		setEditingId(null);
	}

	function handleCommit() {
		if (editingId) {
			onChange(templateDrafts.map((t) => (t.id === editingId ? draft : t)));
		} else {
			onChange([...templateDrafts, draft]);
		}
		closeDialog();
	}

	function handleDelete() {
		if (!editingId) return;
		onChange(templateDrafts.filter((t) => t.id !== editingId));
		closeDialog();
	}

	return (
		<>
			<FieldGroup>
				<Field orientation="horizontal" className="items-start justify-between">
					<FieldContent>
						<FieldTitle>{m.projectTerminalTemplates()}</FieldTitle>
						<FieldDescription>
							{m.projectTerminalTemplatesDescription()}
						</FieldDescription>
					</FieldContent>
					<Button size="sm" variant="outline" onClick={openCreate}>
						{m.addTerminalTemplate()}
					</Button>
				</Field>

				{templateDrafts.length === 0 ? (
					<Empty className="min-h-24">
						<EmptyHeader>
							<EmptyTitle>{m.noTerminalTemplates()}</EmptyTitle>
							<EmptyDescription>
								{m.projectTerminalTemplatesDescription()}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<FieldGroup className="gap-2">
						{templateDrafts.map((t) => (
							<div
								key={t.id}
								className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
							>
								<div className="flex min-w-0 flex-col gap-1">
									<div className="truncate font-medium">
										{t.name || m.terminalTemplate()}
									</div>
									{t.commandsText.trim() ? (
										<div className="truncate font-mono text-sm text-muted-foreground">
											{commandPreview(t.commandsText)}
										</div>
									) : null}
									{t.cwd.trim() ? (
										<div className="truncate font-mono text-xs text-muted-foreground">
											{t.cwd}
										</div>
									) : null}
								</div>
								<div className="flex shrink-0 gap-1">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={m.editTerminalTemplate()}
										onClick={() => openEdit(t.id)}
									>
										<PencilSimpleIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={m.deleteTerminalTemplate()}
										onClick={() =>
											onChange(templateDrafts.filter((x) => x.id !== t.id))
										}
										className="text-destructive hover:text-destructive"
									>
										<TrashIcon />
									</Button>
								</div>
							</div>
						))}
					</FieldGroup>
				)}
			</FieldGroup>

			<TerminalTemplateDraftDialog
				draft={draft}
				isOpen={isOpen}
				isEditing={isEditing}
				showCwd
				onChange={setDraft}
				onClose={closeDialog}
				onDelete={handleDelete}
				onSave={handleCommit}
			/>
		</>
	);
}
