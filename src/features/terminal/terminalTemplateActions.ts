import { useProjectConfigQuery } from "@/features/projects/hooks";
import { useTerminalTemplatesStore } from "@/features/settings/stores/terminalTemplatesStore";
import { useCreateTerminalTab } from "./hooks";
import {
	resolveGlobalTerminalTemplate,
	resolveProjectTerminalTemplate,
	type GlobalTerminalTemplate,
	type ProjectTerminalTemplate,
} from "./templates";

interface UseTerminalTemplateActionsProps {
	profileId: string;
	cwd: string;
	projectId: string;
	onCreated?: () => void;
}

export function useTerminalTemplateActions({
	profileId,
	cwd,
	projectId,
	onCreated,
}: UseTerminalTemplateActionsProps) {
	const createTab = useCreateTerminalTab();
	const projectConfig = useProjectConfigQuery(projectId);
	const globalTemplates = useTerminalTemplatesStore((s) => s.templates);

	const projectTemplates = projectConfig.data?.terminal_templates ?? [];
	const hasTemplates = projectTemplates.length > 0 || globalTemplates.length > 0;

	function createDefaultTerminal() {
		createTab.mutate({ profileId, cwd });
		onCreated?.();
	}

	async function createTemplateTerminal(
		template: GlobalTerminalTemplate | ProjectTerminalTemplate,
		scope: "global" | "project",
	) {
		const resolved =
			scope === "project"
				? await resolveProjectTerminalTemplate(
						template as ProjectTerminalTemplate,
						cwd,
					)
				: resolveGlobalTerminalTemplate(
						template as GlobalTerminalTemplate,
						cwd,
					);
		await createTab.mutateAsync({
			profileId,
			cwd: resolved.cwd,
			title: resolved.name,
			startupCommands: resolved.commands,
		});
		onCreated?.();
	}

	return {
		createDefaultTerminal,
		createTemplateTerminal,
		createTab,
		globalTemplates,
		hasTemplates,
		projectTemplates,
	};
}
