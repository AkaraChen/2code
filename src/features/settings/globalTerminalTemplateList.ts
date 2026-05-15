import type { GlobalTerminalTemplate } from "@/features/terminal/templates";

export function replaceGlobalTerminalTemplate(
	templates: readonly GlobalTerminalTemplate[],
	templateId: string,
	nextTemplate: GlobalTerminalTemplate,
): GlobalTerminalTemplate[] {
	const index = templates.findIndex((template) => template.id === templateId);
	if (index === -1) return templates.slice();

	const nextTemplates = templates.slice();
	nextTemplates[index] = nextTemplate;
	return nextTemplates;
}

export function removeGlobalTerminalTemplate(
	templates: readonly GlobalTerminalTemplate[],
	templateId: string,
): GlobalTerminalTemplate[] {
	const index = templates.findIndex((template) => template.id === templateId);
	if (index === -1) return templates.slice();

	const nextTemplates = templates.slice();
	nextTemplates.splice(index, 1);
	return nextTemplates;
}
