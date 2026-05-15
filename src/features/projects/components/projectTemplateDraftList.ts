import type { ProjectTerminalTemplateDraft } from "@/features/terminal/templates";

export function replaceProjectTemplateDraft(
	templateDrafts: readonly ProjectTerminalTemplateDraft[],
	templateId: string,
	draft: ProjectTerminalTemplateDraft,
): ProjectTerminalTemplateDraft[] {
	const index = templateDrafts.findIndex((template) => template.id === templateId);
	if (index === -1) return templateDrafts.slice();

	const nextDrafts = templateDrafts.slice();
	nextDrafts[index] = draft;
	return nextDrafts;
}

export function removeProjectTemplateDraft(
	templateDrafts: readonly ProjectTerminalTemplateDraft[],
	templateId: string,
): ProjectTerminalTemplateDraft[] {
	const index = templateDrafts.findIndex((template) => template.id === templateId);
	if (index === -1) return templateDrafts.slice();

	const nextDrafts = templateDrafts.slice();
	nextDrafts.splice(index, 1);
	return nextDrafts;
}
