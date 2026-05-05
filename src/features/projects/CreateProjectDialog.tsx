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
import { FiEdit2, FiFolder } from "react-icons/fi";
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

function getProjectNameHint(folder: string | null, name: string) {
	const hasName = !!name.trim();

	if (!folder) {
		return m.createProjectChooseFolderHint();
	}
	if (!hasName) {
		return m.createProjectHintFolderEmpty();
	}
	return m.createProjectHintFolderNamed();
}

export default function CreateProjectDialog({
	isOpen,
	onClose,
}: CreateProjectDialogProps) {
	const form = useForm<FormValues>({
		defaultValues: { name: "", folder: null },
	});
	const navigate = useNavigate();
	const folder = useWatch({ control: form.control, name: "folder" });
	const name = useWatch({ control: form.control, name: "name" });

	const handleClose = () => {
		form.reset();
		onClose();
	};

	const handleChooseFolder = async () => {
		const selected = await open({ directory: true });
		if (selected) {
			form.setValue("folder", selected);
			if (!form.getValues("name").trim()) {
				form.setValue("name", await basename(selected));
			}
		}
	};

	const createProject = useCreateProject({
		onSuccess: (project) => {
			handleClose();
			if (project.profiles.length > 0) {
				const defaultProfile = project.profiles[0];
				navigate(`/projects/${project.id}/profiles/${defaultProfile.id}`);
			}
		},
	});

	const handleCreate = form.handleSubmit(async (data) => {
		if (!data.folder) return;

		const name = data.name.trim();
		await createProject.mutateAsync({
			name: name || undefined,
			folder: data.folder,
		});
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
												<FiFolder />
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
												<FiEdit2 />
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
										placeholder={m.projectNamePlaceholderFolder()}
										{...form.register("name")}
										onKeyDown={(e) => {
											if (e.key === "Enter")
												handleCreate();
										}}
									/>
									<Text fontSize="xs" color="fg.muted">
										{getProjectNameHint(folder, name)}
									</Text>
								</Field.Root>
							</Stack>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button
								onClick={handleCreate}
								disabled={!folder || createProject.isPending}
								loading={createProject.isPending}
							>
								{m.create()}
							</Button>
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
