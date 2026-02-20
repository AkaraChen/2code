import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Portal,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { useProjectConfig, useSaveProjectConfig } from "./hooks";
import * as m from "@/paraglide/messages.js";

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

function scriptsToText(scripts: string[]): string {
	return scripts.join("\n");
}

function textToScripts(text: string): string[] {
	return text
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
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

	const form = useForm<FormValues>({
		defaultValues: {
			initScript: scriptsToText(config.init_script),
			setupScript: scriptsToText(config.setup_script),
			teardownScript: scriptsToText(config.teardown_script),
		},
	});

	const handleSave = form.handleSubmit(async (data) => {
		await saveConfig.mutateAsync({
			projectId,
			config: {
				init_script: textToScripts(data.initScript),
				setup_script: textToScripts(data.setupScript),
				teardown_script: textToScripts(data.teardownScript),
			},
		});
		onClose();
	});

	return (
		<>
			<Dialog.Body>
				<Stack gap="5">
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
						<Suspense>
							<ProjectSettingsForm
								projectId={projectId}
								onClose={onClose}
							/>
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
