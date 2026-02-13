import {
	Box,
	Button,
	CloseButton,
	Code,
	Dialog,
	Field,
	Flex,
	HStack,
	Icon,
	Input,
	Portal,
	Stack,
	Text,
} from "@chakra-ui/react";
import { basename } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { useForm, useWatch } from "react-hook-form";
import { RiFolderOpenLine, RiPencilLine } from "react-icons/ri";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import { useCreateProject } from "./hooks";

interface CreateProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

interface FormValues {
	name: string;
	folder: string | null;
}

export default function CreateProjectDialog({
	isOpen,
	onClose,
}: CreateProjectDialogProps) {
	const form = useForm<FormValues>({
		defaultValues: { name: "", folder: null },
	});
	const createProject = useCreateProject();
	const navigate = useNavigate();

	const folder = useWatch({ control: form.control, name: "folder" });

	const handleClose = () => {
		form.reset();
		onClose();
	};

	const handleChooseFolder = async () => {
		const selected = await open({ directory: true });
		if (selected) {
			form.setValue("folder", selected);
			if (!form.getValues("name")) {
				form.setValue("name", await basename(selected));
			}
		}
	};

	const handleCreate = form.handleSubmit(async (data) => {
		const project = await createProject.mutateAsync(
			data.name || data.folder
				? {
						name: data.name || undefined,
						folder: data.folder ?? undefined,
					}
				: undefined,
		);
		handleClose();
		navigate(`/projects/${project.id}`);
	});

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) handleClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>{m.createProject()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Stack gap="5">
								{!folder ? (
									<Box
										as="button"
										onClick={handleChooseFolder}
										borderWidth="thin"
										borderStyle="dashed"
										borderColor="border.emphasized"
										rounded="lg"
										px="4"
										py="6"
										cursor="pointer"
										transition="colors"
										_hover={{
											bg: "bg.subtle",
										}}
									>
										<Flex
											direction="column"
											align="center"
											gap="2"
										>
											<Icon
												fontSize="2xl"
												color="fg.muted"
											>
												<RiFolderOpenLine />
											</Icon>
											<Text
												fontSize="sm"
												color="fg.muted"
											>
												{m.chooseFolder()}
											</Text>
										</Flex>
									</Box>
								) : (
									<Box>
										<HStack
											justify="space-between"
											mb="1.5"
										>
											<Text
												fontSize="xs"
												fontWeight="medium"
												color="fg.muted"
											>
												{m.folder()}
											</Text>
											<Button
												variant="outline"
												size="xs"
												onClick={handleChooseFolder}
											>
												<RiPencilLine />
												{m.chooseFolder()}
											</Button>
										</HStack>
										<Code
											variant="surface"
											size="sm"
											display="block"
											px="3"
											py="2"
											rounded="md"
											truncate
										>
											{folder}
										</Code>
									</Box>
								)}

								<Field.Root>
									<Field.Label>{m.projectName()}</Field.Label>
									<Input
										placeholder={m.projectNamePlaceholder()}
										{...form.register("name")}
										onKeyDown={(e) => {
											if (e.key === "Enter")
												handleCreate();
										}}
									/>
								</Field.Root>
							</Stack>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button onClick={handleCreate}>{m.create()}</Button>
						</Dialog.Footer>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
