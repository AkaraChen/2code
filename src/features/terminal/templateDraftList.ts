interface TemplateDraft {
	id: string;
}

export function updateTemplateDraft<T extends TemplateDraft>(
	templates: readonly T[],
	index: number,
	patch: Partial<T>,
): T[] {
	const nextTemplates = templates.slice();
	const template = nextTemplates[index];
	if (!template) return nextTemplates;
	nextTemplates[index] = { ...template, ...patch };
	return nextTemplates;
}

export function removeTemplateDraft<T extends TemplateDraft>(
	templates: readonly T[],
	index: number,
): T[] {
	if (index < 0 || index >= templates.length) return templates.slice();
	const nextTemplates = templates.slice();
	nextTemplates.splice(index, 1);
	return nextTemplates;
}
