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
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { RiFolderOpenLine, RiPencilLine } from "react-icons/ri";
import { useNavigate } from "react-router";
import { useCreateProject } from "@/hooks/useProjects";
import * as m from "@/paraglide/messages.js";

interface CreateProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function CreateProjectDialog({
	isOpen,
	onClose,
}: CreateProjectDialogProps) {
	const [name, setName] = useState("");
	const [folder, setFolder] = useState<string | null>(null);
	const createProject = useCreateProject();
	const navigate = useNavigate();

	const reset = () => {
		setName("");
		setFolder(null);
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	const handleChooseFolder = async () => {
		const selected = await open({ directory: true });
		if (selected) {
			setFolder(selected);
			if (!name) {
				setName(selected.split("/").pop() || "");
			}
		}
	};

	const handleCreate = async () => {
		const project = await createProject.mutateAsync(
			name || folder
				? { name: name || undefined, folder: folder ?? undefined }
				: undefined,
		);
		handleClose();
		navigate(`/projects/${project.id}`);
	};

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
										value={name}
										onChange={(e) =>
											setName(e.target.value)
										}
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
