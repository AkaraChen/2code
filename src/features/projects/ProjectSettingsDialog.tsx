import { useState } from "react";
import { useForm } from "react-hook-form";
import type { UseFormRegisterReturn } from "react-hook-form";
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
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
	commandsToText,
	normalizeProjectTerminalTemplates,
	textToCommands,
	toProjectTerminalTemplateDraft,
	type ProjectTerminalTemplateDraft,
} from "@/features/terminal/templates";
import * as m from "@/paraglide/messages.js";
import { AsyncBoundary, DialogBodyError } from "@/shared/components/Fallbacks";
import { ProjectTemplatesEditor } from "./components/ProjectTemplatesEditor";
import { useProjectConfig, useSaveProjectConfig } from "./hooks";

interface ProjectSettingsDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
}

interface FormValues {
	worktreeDir: string;
	initScript: string;
	setupScript: string;
	teardownScript: string;
}

function ScriptField({
	description,
	label,
	placeholder,
	register,
}: {
	description: string;
	label: string;
	placeholder: string;
	register: UseFormRegisterReturn;
}) {
	return (
		<Field>
			<FieldLabel>{label}</FieldLabel>
			<FieldDescription>{description}</FieldDescription>
			<Textarea
				{...register}
				placeholder={placeholder}
				rows={4}
				className="font-mono"
			/>
		</Field>
	);
}

function ProjectSettingsForm({
	projectId,
	onClose,
}: {
	projectId: string;
	onClose: () => void;
}) {
	const { data: config } = useProjectConfig(projectId);
	const saveConfig = useSaveProjectConfig();
	const [templateDrafts, setTemplateDrafts] = useState<
		ProjectTerminalTemplateDraft[]
	>(() =>
		(config.terminal_templates ?? []).map(toProjectTerminalTemplateDraft),
	);
	const form = useForm<FormValues>({
		defaultValues: {
			worktreeDir: config.worktree_dir ?? "",
			initScript: commandsToText(config.init_script),
			setupScript: commandsToText(config.setup_script),
			teardownScript: commandsToText(config.teardown_script),
		},
	});

	const handleSave = form.handleSubmit(async (data) => {
		await saveConfig.mutateAsync({
			projectId,
			config: {
				worktree_dir: data.worktreeDir.trim() || null,
				init_script: textToCommands(data.initScript),
				setup_script: textToCommands(data.setupScript),
				teardown_script: textToCommands(data.teardownScript),
				terminal_templates: normalizeProjectTerminalTemplates(templateDrafts),
			},
		});
		onClose();
	});

	return (
		<>
			<Tabs defaultValue="scripts">
				<TabsList className="mb-3">
					<TabsTrigger value="scripts">{m.scripts()}</TabsTrigger>
					<TabsTrigger value="templates">{m.templates()}</TabsTrigger>
				</TabsList>

				<TabsContent value="scripts">
					<div className="flex flex-col gap-3">
						<Field>
							<FieldLabel>{m.projectWorktreeDir()}</FieldLabel>
							<FieldDescription>
								{m.projectWorktreeDirDesc()}
							</FieldDescription>
							<Input
								{...form.register("worktreeDir")}
								placeholder={m.projectWorktreeDirPlaceholder()}
							/>
						</Field>

						<ScriptField
							label={m.initScript()}
							description={m.initScriptDesc()}
							placeholder={m.scriptPlaceholder()}
							register={form.register("initScript")}
						/>
						<ScriptField
							label={m.setupScript()}
							description={m.setupScriptDesc()}
							placeholder={m.scriptPlaceholder()}
							register={form.register("setupScript")}
						/>
						<ScriptField
							label={m.teardownScript()}
							description={m.teardownScriptDesc()}
							placeholder={m.scriptPlaceholder()}
							register={form.register("teardownScript")}
						/>
					</div>
				</TabsContent>

				<TabsContent value="templates">
					<ProjectTemplatesEditor
						templateDrafts={templateDrafts}
						onChange={setTemplateDrafts}
					/>
				</TabsContent>
			</Tabs>
			<DialogFooter>
				<Button variant="outline" onClick={onClose}>
					{m.cancel()}
				</Button>
				<Button onClick={handleSave} disabled={saveConfig.isPending}>
					{saveConfig.isPending ? <Spinner /> : null}
					{m.save()}
				</Button>
			</DialogFooter>
		</>
	);
}

export default function ProjectSettingsDialog({
	isOpen,
	onClose,
	projectId,
}: ProjectSettingsDialogProps) {
	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{m.projectSettings()}</DialogTitle>
				</DialogHeader>
				<AsyncBoundary
					fallback={
						<div className="flex min-h-[200px] items-center justify-center">
							<Spinner />
						</div>
					}
					errorFallback={({ error, onRetry }) => (
						<DialogBodyError error={error} onRetry={onRetry} />
					)}
				>
					<ProjectSettingsForm projectId={projectId} onClose={onClose} />
				</AsyncBoundary>
			</DialogContent>
		</Dialog>
	);
}
