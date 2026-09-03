import { useCallback, useMemo } from "react";
import { useProjectConfigQuery } from "@/features/projects/hooks";
import { useTerminalTemplatesStore } from "@/features/settings/stores/terminalTemplatesStore";
import { useCreateTerminalTab } from "./hooks";
import {
	resolveGlobalTerminalTemplate,
	resolveProjectTerminalTemplate,
	type GlobalTerminalTemplate,
	type ProjectTerminalTemplate,
} from "./templates";

const EMPTY_PROJECT_TEMPLATES: ProjectTerminalTemplate[] = [];

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

	const projectTemplates =
		projectConfig.data?.terminal_templates ?? EMPTY_PROJECT_TEMPLATES;
	const hasTemplates = projectTemplates.length > 0 || globalTemplates.length > 0;

	const createDefaultTerminal = useCallback(() => {
		createTab.mutate({ profileId, cwd });
		onCreated?.();
	}, [createTab, cwd, onCreated, profileId]);

	const createTemplateTerminal = useCallback(
		async (
			template: GlobalTerminalTemplate | ProjectTerminalTemplate,
			scope: "global" | "project",
		) => {
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
		},
		[createTab, cwd, onCreated, profileId],
	);

	return useMemo(
		() => ({
			createDefaultTerminal,
			createTemplateTerminal,
			createTab,
			globalTemplates,
			hasTemplates,
			projectTemplates,
		}),
		[
			createDefaultTerminal,
			createTab,
			createTemplateTerminal,
			globalTemplates,
			hasTemplates,
			projectTemplates,
		],
	);
}
