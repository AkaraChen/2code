import {
	Button,
	Card,
	CloseButton,
	Dialog,
	EmptyState,
	HStack,
	IconButton,
	Portal,
	SimpleGrid,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import { useDeleteSkill, useSkills } from "./hooks/useSkills";

export function SkillsTab() {
	const { data: skills } = useSkills();
	const deleteMutation = useDeleteSkill();
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

	return (
		<Stack gap="4">
			{skills.length === 0 ? (
				<EmptyState.Root>
					<EmptyState.Content>
						<EmptyState.Description>
							{m.noSkillsYet()}
						</EmptyState.Description>
					</EmptyState.Content>
				</EmptyState.Root>
			) : (
				<SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="4">
					{skills.map((skill) => (
						<Card.Root key={skill.name} size="sm">
							<Card.Body gap="2">
								<HStack
									justify="space-between"
									align="flex-start"
								>
									<Card.Title>{skill.name}</Card.Title>
									<IconButton
										size="xs"
										variant="ghost"
										colorPalette="red"
										flexShrink={0}
										onClick={() =>
											setDeleteTarget(skill.name)
										}
										aria-label={m.delete()}
									>
										<LuTrash2 />
									</IconButton>
								</HStack>
								<Card.Description lineClamp={2}>
									{skill.description || m.noDescription()}
								</Card.Description>
							</Card.Body>
						</Card.Root>
					))}
				</SimpleGrid>
			)}

			{/* Delete confirmation dialog */}
			<Dialog.Root
				lazyMount
				open={deleteTarget !== null}
				onOpenChange={(e) => {
					if (!e.open) setDeleteTarget(null);
				}}
			>
				<Portal>
					<Dialog.Backdrop />
					<Dialog.Positioner>
						<Dialog.Content>
							<Dialog.Header>
								<Dialog.Title>{m.deleteSkill()}</Dialog.Title>
							</Dialog.Header>
							<Dialog.Body>
								<Text>{m.confirmDeleteSkill()}</Text>
							</Dialog.Body>
							<Dialog.Footer>
								<Dialog.ActionTrigger asChild>
									<Button variant="outline">
										{m.cancel()}
									</Button>
								</Dialog.ActionTrigger>
								<Button
									colorPalette="red"
									onClick={() => {
										if (deleteTarget) {
											deleteMutation.mutate(deleteTarget);
										}
										setDeleteTarget(null);
									}}
								>
									{m.delete()}
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
