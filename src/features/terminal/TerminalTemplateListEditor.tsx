import {
	Box,
	Button,
	CloseButton,
	Field,
	HStack,
	Input,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

interface BaseTemplateDraft {
	id: string;
	name: string;
	commandsText: string;
	cwd?: string;
}

interface TerminalTemplateListEditorProps<T extends BaseTemplateDraft> {
	title: string;
	description: string;
	templates: T[];
	onChange: (templates: T[]) => void;
	createTemplate: () => T;
	showCwd?: boolean;
}

export function TerminalTemplateListEditor<T extends BaseTemplateDraft>({
	title,
	description,
	templates,
	onChange,
	createTemplate,
	showCwd = false,
}: TerminalTemplateListEditorProps<T>) {
	function updateTemplate(index: number, patch: Partial<T>) {
		onChange(
			templates.map((template, templateIndex) =>
				templateIndex === index
					? { ...template, ...patch }
					: template,
			),
		);
	}

	function removeTemplate(index: number) {
		onChange(templates.filter((_, templateIndex) => templateIndex !== index));
	}

	return (
		<Stack gap="4">
			<HStack justify="space-between" align="start">
				<Stack gap="1">
					<Text fontWeight="semibold">{title}</Text>
					<Text fontSize="sm" color="fg.muted">
						{description}
					</Text>
				</Stack>
				<Button
					size="sm"
					variant="outline"
					onClick={() => onChange([...templates, createTemplate()])}
				>
					{m.addTerminalTemplate()}
				</Button>
			</HStack>

			{templates.length === 0 ? (
				<Box
					rounded="l3"
					borderWidth="1px"
					borderColor="border.subtle"
					bg="bg.panel"
					px="4"
					py="3"
				>
					<Text fontSize="sm" color="fg.muted">
						{m.noTerminalTemplates()}
					</Text>
				</Box>
			) : (
				<Stack gap="3">
					{templates.map((template, index) => (
						<Box
							key={template.id}
							rounded="l3"
							borderWidth="1px"
							borderColor="border.subtle"
							bg="bg.panel"
							p="4"
						>
							<Stack gap="4">
								<HStack justify="space-between" align="start">
									<Text fontWeight="medium">
										{template.name || m.terminalTemplate()}
									</Text>
									<CloseButton
										size="sm"
										onClick={() => removeTemplate(index)}
									/>
								</HStack>

								<Field.Root required>
									<Field.Label>
										{m.terminalTemplateName()}
									</Field.Label>
									<Input
										value={template.name}
										onChange={(event) =>
											updateTemplate(index, {
												name: event.target.value,
											} as Partial<T>)
										}
										placeholder={m.terminalTemplateNamePlaceholder()}
									/>
								</Field.Root>

								{showCwd ? (
									<Field.Root>
										<Field.Label>
											{m.terminalTemplateCwd()}
										</Field.Label>
										<Text fontSize="xs" color="fg.muted" mb="1">
											{m.terminalTemplateCwdDescription()}
										</Text>
										<Input
											value={template.cwd ?? ""}
											onChange={(event) =>
												updateTemplate(index, {
													cwd: event.target.value,
												} as Partial<T>)
											}
											placeholder={m.terminalTemplateCwdPlaceholder()}
											fontFamily="mono"
											fontSize="sm"
										/>
									</Field.Root>
								) : null}

								<Field.Root required>
									<Field.Label>
										{m.terminalTemplateCommands()}
									</Field.Label>
									<Text fontSize="xs" color="fg.muted" mb="1">
										{m.terminalTemplateCommandsDescription()}
									</Text>
									<Textarea
										value={template.commandsText}
										onChange={(event) =>
											updateTemplate(index, {
												commandsText: event.target.value,
											} as Partial<T>)
										}
										placeholder={m.scriptPlaceholder()}
										rows={4}
										fontFamily="mono"
										fontSize="sm"
									/>
								</Field.Root>
							</Stack>
						</Box>
					))}
				</Stack>
			)}
		</Stack>
	);
}
