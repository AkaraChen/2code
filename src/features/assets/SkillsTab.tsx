import {
	Badge,
	Button,
	Card,
	CloseButton,
	Dialog,
	EmptyState,
	Field,
	Flex,
	HStack,
	IconButton,
	Input,
	Portal,
	SimpleGrid,
	Stack,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import {
	useCreateSkill,
	useDeleteSkill,
	useSkills,
	useUpdateSkill,
} from "./hooks/useSkills";

interface SkillFormData {
	name: string;
	description: string;
	content: string;
}

export function SkillsTab() {
	const { data: skills } = useSkills();
	const createMutation = useCreateSkill();
	const updateMutation = useUpdateSkill();
	const deleteMutation = useDeleteSkill();
	const [editingName, setEditingName] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);

	const form = useForm<SkillFormData>({
		defaultValues: { name: "", description: "", content: "" },
	});

	const openCreate = () => {
		setEditingName(null);
		form.reset({ name: "", description: "", content: "" });
		setDialogOpen(true);
	};

	const openEdit = (skill: {
		name: string;
		description: string;
		content: string;
	}) => {
		setEditingName(skill.name);
		form.reset({
			name: skill.name,
			description: skill.description,
			content: skill.content,
		});
		setDialogOpen(true);
	};

	const onSubmit = form.handleSubmit(async (data) => {
		if (editingName) {
			await updateMutation.mutateAsync({
				name: editingName,
				description: data.description,
				content: data.content,
			});
		} else {
			await createMutation.mutateAsync(data);
		}
		setDialogOpen(false);
	});

	return (
		<Stack gap="4">
			<Flex justify="flex-end">
				<Button size="sm" onClick={openCreate}>
					<LuPlus /> {m.create()}
				</Button>
			</Flex>

			{skills.length === 0 ? (
				<EmptyState.Root>
					<EmptyState.Content>
						<EmptyState.Description>
							{m.noSkillsYet()}
						</EmptyState.Description>
					</EmptyState.Content>
				</EmptyState.Root>
			) : (
				<SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
					{skills.map((skill) => (
						<Card.Root key={skill.name} size="sm">
							<Card.Body>
								<Flex justify="space-between" align="start">
									<Stack gap="1" flex="1" minW="0">
										<HStack>
											<Badge
												variant="outline"
												size="sm"
											>
												{skill.name}
											</Badge>
										</HStack>
										<Text
											fontSize="sm"
											color="fg.muted"
											lineClamp={2}
										>
											{skill.description ||
												m.noDescription()}
										</Text>
									</Stack>
									<HStack gap="0" flexShrink={0}>
										<IconButton
											size="xs"
											variant="ghost"
											onClick={() => openEdit(skill)}
											aria-label="Edit"
										>
											<LuPencil />
										</IconButton>
										<IconButton
											size="xs"
											variant="ghost"
											colorPalette="red"
											onClick={() =>
												deleteMutation.mutate(
													skill.name,
												)
											}
											aria-label="Delete"
										>
											<LuTrash2 />
										</IconButton>
									</HStack>
								</Flex>
							</Card.Body>
						</Card.Root>
					))}
				</SimpleGrid>
			)}

			<Dialog.Root
				lazyMount
				open={dialogOpen}
				onOpenChange={(e) => setDialogOpen(e.open)}
			>
				<Portal>
					<Dialog.Backdrop />
					<Dialog.Positioner>
						<Dialog.Content maxW="2xl">
							<Dialog.Header>
								<Dialog.Title>
									{editingName
										? m.editSkill()
										: m.createSkill()}
								</Dialog.Title>
							</Dialog.Header>
							<Dialog.Body>
								<Stack gap="4">
									<Field.Root>
										<Field.Label>
											{m.skillName()}
										</Field.Label>
										<Input
											{...form.register("name", {
												required: true,
											})}
											placeholder={m.skillNamePlaceholder()}
											disabled={!!editingName}
										/>
										{!editingName && (
											<Field.HelperText>
												{m.skillNameHelper()}
											</Field.HelperText>
										)}
									</Field.Root>
									<Field.Root>
										<Field.Label>
											{m.skillDescription()}
										</Field.Label>
										<Textarea
											{...form.register("description")}
											placeholder={m.skillDescriptionPlaceholder()}
											rows={2}
										/>
									</Field.Root>
									<Field.Root>
										<Field.Label>
											{m.skillContent()}
										</Field.Label>
										<Textarea
											{...form.register("content", {
												required: true,
											})}
											placeholder={m.skillContentPlaceholder()}
											rows={10}
											fontFamily="mono"
											fontSize="sm"
										/>
									</Field.Root>
								</Stack>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.ActionTrigger asChild>
									<Button variant="outline">
										{m.cancel()}
									</Button>
								</Dialog.ActionTrigger>
								<Button
									onClick={onSubmit}
									loading={
										createMutation.isPending ||
										updateMutation.isPending
									}
								>
									{editingName ? m.save() : m.create()}
								</Button>
							</Dialog.Footer>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Content>
					</Dialog.Positioner>
				</Portal>
			</Dialog.Root>
		</Stack>
	);
}
