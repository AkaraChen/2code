import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	commandPreview,
	createEmptyGlobalTerminalTemplateDraft,
	normalizeGlobalTerminalTemplates,
	toGlobalTerminalTemplateDraft,
	type GlobalTerminalTemplateDraft,
} from "@/features/terminal/templates";
import { TerminalTemplateDraftDialog } from "@/features/terminal/TerminalTemplateDraftDialog";
import * as m from "@/paraglide/messages.js";
import { useTerminalTemplatesStore } from "./stores/terminalTemplatesStore";

export function GlobalTerminalTemplatesSettings() {
	const templates = useTerminalTemplatesStore((s) => s.templates);
	const setTemplates = useTerminalTemplatesStore((s) => s.setTemplates);
	const replaceTemplates = useMutation({
		mutationFn: async (nextTemplates: typeof templates) => nextTemplates,
		onSuccess: (nextTemplates) => {
			setTemplates(nextTemplates);
		},
	});
	const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
	const [draft, setDraft] = useState<GlobalTerminalTemplateDraft>(
		createEmptyGlobalTerminalTemplateDraft,
	);
	const [isOpen, setIsOpen] = useState(false);

	const isEditing = editingTemplateId !== null;

	function openCreateDialog() {
		setEditingTemplateId(null);
		setDraft(createEmptyGlobalTerminalTemplateDraft());
		setIsOpen(true);
	}

	function openEditDialog(templateId: string) {
		const template = templates.find((item) => item.id === templateId);
		if (!template) return;
		setEditingTemplateId(template.id);
		setDraft(toGlobalTerminalTemplateDraft(template));
		setIsOpen(true);
	}

	function closeDialog() {
		setIsOpen(false);
		setEditingTemplateId(null);
	}

	async function handleSave() {
		const [normalizedTemplate] = normalizeGlobalTerminalTemplates([draft]);
		if (!normalizedTemplate) return;

		if (editingTemplateId) {
			await replaceTemplates.mutateAsync(
				templates.map((template) =>
					template.id === editingTemplateId ? normalizedTemplate : template,
				),
			);
		} else {
			await replaceTemplates.mutateAsync([...templates, normalizedTemplate]);
		}

		closeDialog();
	}

	async function handleDelete() {
		if (!editingTemplateId) return;
		await replaceTemplates.mutateAsync(
			templates.filter((template) => template.id !== editingTemplateId),
		);
		closeDialog();
	}

	async function removeTemplate(templateId: string) {
		await replaceTemplates.mutateAsync(
			templates.filter((template) => template.id !== templateId),
		);
	}

	return (
		<>
			<div className="flex flex-col gap-4">
				<div className="flex items-start justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h2 className="font-semibold">{m.globalTerminalTemplates()}</h2>
						<p className="text-sm text-muted-foreground">
							{m.globalTerminalTemplatesDescription()}
						</p>
					</div>
					<Button
						size="sm"
						variant="outline"
						onClick={openCreateDialog}
						disabled={replaceTemplates.isPending}
					>
						{m.addTerminalTemplate()}
					</Button>
				</div>

				{templates.length === 0 ? (
					<div className="rounded-lg border px-4 py-3">
						<p className="text-sm text-muted-foreground">
							{m.noTerminalTemplates()}
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{templates.map((template) => (
							<div
								key={template.id}
								className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
							>
								<div className="flex min-w-0 flex-col gap-1">
									<div className="truncate font-medium">
										{template.name}
									</div>
									<div className="truncate font-mono text-sm text-muted-foreground">
										{commandPreview(template.commands.join("\n"))}
									</div>
								</div>
								<div className="flex shrink-0 gap-1">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={m.editTerminalTemplate()}
										onClick={() => openEditDialog(template.id)}
										disabled={replaceTemplates.isPending}
									>
										<PencilSimpleIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={m.deleteTerminalTemplate()}
										onClick={() => void removeTemplate(template.id)}
										disabled={replaceTemplates.isPending}
										className="text-destructive hover:text-destructive"
									>
										<TrashIcon />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			<TerminalTemplateDraftDialog
				draft={draft}
				isOpen={isOpen}
				isEditing={isEditing}
				isPending={replaceTemplates.isPending}
				onChange={setDraft}
				onClose={closeDialog}
				onDelete={handleDelete}
				onSave={handleSave}
			/>
		</>
	);
}
