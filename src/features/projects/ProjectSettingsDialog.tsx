import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Portal,
	Spinner,
	Stack,
	Tabs,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import {
	commandsToText,
	normalizeProjectTerminalTemplates,
	textToCommands,
	toProjectTerminalTemplateDraft,
	type ProjectTerminalTemplateDraft,
} from "@/features/terminal/templates";
import * as m from "@/paraglide/messages.js";
import { useProjectConfig, useSaveProjectConfig } from "./hooks";
import { ProjectTemplatesEditor } from "./components/ProjectTemplatesEditor";

interface ProjectSettingsDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
}

interface FormValues {
	initScript: string;
	setupScript: string;
	teardownScript: string;
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
			initScript: commandsToText(config.init_script),
			setupScript: commandsToText(config.setup_script),
			teardownScript: commandsToText(config.teardown_script),
		},
	});

	const handleSave = form.handleSubmit(async (data) => {
		await saveConfig.mutateAsync({
			projectId,
			config: {
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
			<Dialog.Body pb="2">
				<Tabs.Root defaultValue="scripts" variant="plain">
					<Tabs.List bg="bg.muted" rounded="l3" p="1" mb="3">
						<Tabs.Trigger value="scripts">{m.scripts()}</Tabs.Trigger>
						<Tabs.Trigger value="templates">{m.templates()}</Tabs.Trigger>
						<Tabs.Indicator rounded="l2" />
					</Tabs.List>

					<Tabs.Content value="scripts">
						<Stack gap="3">
							<Field.Root>
								<Field.Label>{m.initScript()}</Field.Label>
								<Text fontSize="xs" color="fg.muted" mb="1">
									{m.initScriptDesc()}
								</Text>
								<Textarea
									{...form.register("initScript")}
									placeholder={m.scriptPlaceholder()}
									rows={4}
									fontFamily="mono"
									fontSize="sm"
								/>
							</Field.Root>

							<Field.Root>
								<Field.Label>{m.setupScript()}</Field.Label>
								<Text fontSize="xs" color="fg.muted" mb="1">
									{m.setupScriptDesc()}
								</Text>
								<Textarea
									{...form.register("setupScript")}
									placeholder={m.scriptPlaceholder()}
									rows={4}
									fontFamily="mono"
									fontSize="sm"
								/>
							</Field.Root>

							<Field.Root>
								<Field.Label>{m.teardownScript()}</Field.Label>
								<Text fontSize="xs" color="fg.muted" mb="1">
									{m.teardownScriptDesc()}
								</Text>
								<Textarea
									{...form.register("teardownScript")}
									placeholder={m.scriptPlaceholder()}
									rows={4}
									fontFamily="mono"
									fontSize="sm"
								/>
							</Field.Root>
						</Stack>
					</Tabs.Content>

					<Tabs.Content value="templates">
						<ProjectTemplatesEditor
							templateDrafts={templateDrafts}
							onChange={setTemplateDrafts}
						/>
					</Tabs.Content>
				</Tabs.Root>
			</Dialog.Body>
			<Dialog.Footer>
				<Dialog.ActionTrigger asChild>
					<Button variant="outline">{m.cancel()}</Button>
				</Dialog.ActionTrigger>
				<Button onClick={handleSave} loading={saveConfig.isPending}>
					{m.save()}
				</Button>
			</Dialog.Footer>
		</>
	);
}

export default function ProjectSettingsDialog({
	isOpen,
	onClose,
	projectId,
}: ProjectSettingsDialogProps) {
	return (
		<Dialog.Root
			lazyMount
			unmountOnExit
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
							<Dialog.Title>{m.projectSettings()}</Dialog.Title>
						</Dialog.Header>
						<Suspense
							fallback={
								<Dialog.Body>
									<Stack alignItems="center" justifyContent="center" minH="200px">
										<Spinner size="md" color="colorPalette.500" />
									</Stack>
								</Dialog.Body>
							}
						>
							<ProjectSettingsForm projectId={projectId} onClose={onClose} />
						</Suspense>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
