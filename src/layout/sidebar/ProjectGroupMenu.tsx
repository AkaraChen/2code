import { Box, HStack, Icon, Input, Menu, Portal, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { FiCheck, FiChevronRight, FiPlus, FiX } from "react-icons/fi";
import {
	useAssignProjectToGroup,
	useCreateProjectGroup,
} from "@/features/projects/hooks";
import type { ProjectGroup, ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { getErrorMessage } from "@/shared/lib/errors";
import { toaster } from "@/shared/providers/appToaster";

interface ProjectGroupMenuProps {
	project: ProjectWithProfiles;
	projectGroups: ProjectGroup[];
	onCloseMenu: () => void;
}

export function ProjectGroupMenu({
	project,
	projectGroups,
	onCloseMenu,
}: ProjectGroupMenuProps) {
	const [isCreating, setIsCreating] = useState(false);
	const [name, setName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const createGroup = useCreateProjectGroup();
	const assignProjectToGroup = useAssignProjectToGroup();
	const currentGroupId = project.group_id ?? null;
	const isPending = createGroup.isPending || assignProjectToGroup.isPending;
	const showCreateInput = isCreating || projectGroups.length === 0;

	useEffect(() => {
		if (showCreateInput) {
			window.requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [showCreateInput]);

	function showError(error: unknown) {
		toaster.create({
			title: m.somethingWentWrong(),
			description: getErrorMessage(error),
			type: "error",
			closable: true,
		});
	}

	async function handleAssign(groupId: string | null) {
		if (groupId === currentGroupId) {
			onCloseMenu();
			return;
		}

		try {
			await assignProjectToGroup.mutateAsync({
				projectId: project.id,
				groupId,
			});
			onCloseMenu();
		} catch (error) {
			showError(error);
		}
	}

	async function handleCreate() {
		const trimmed = name.trim();
		if (!trimmed || isPending) return;

		try {
			const group = await createGroup.mutateAsync(trimmed);
			await assignProjectToGroup.mutateAsync({
				projectId: project.id,
				groupId: group.id,
			});
			setName("");
			setIsCreating(false);
			onCloseMenu();
		} catch (error) {
			showError(error);
		}
	}

	return (
		<Menu.Root positioning={{ placement: "right-start", gutter: 4 }}>
			<Menu.TriggerItem>
				<HStack gap="2" w="full" minW="0">
					<Text flex="1 1 auto" minW="0" truncate>
						{m.addToProjectGroup()}
					</Text>
					<Icon fontSize="xs" color="fg.muted" flexShrink={0}>
						<FiChevronRight />
					</Icon>
				</HStack>
			</Menu.TriggerItem>
			<Portal>
				<Menu.Positioner>
					<Menu.Content minW="56">
						{projectGroups.length === 0 ? (
							<Box px="3" py="2">
								<Text fontSize="sm" color="fg.muted">
									{m.noProjectGroups()}
								</Text>
							</Box>
						) : (
							projectGroups.map((group) => {
								const isCurrent = currentGroupId === group.id;
								return (
									<Menu.Item
										key={group.id}
										value={`project-group-${group.id}`}
										closeOnSelect={false}
										disabled={isPending || isCurrent}
										onSelect={() => {
											void handleAssign(group.id);
										}}
									>
										<Icon
											fontSize="sm"
											color={
												isCurrent ? "fg" : "transparent"
											}
											flexShrink={0}
										>
											<FiCheck />
										</Icon>
										<Text flex="1 1 auto" minW="0" truncate>
											{group.name}
										</Text>
									</Menu.Item>
								);
							})
						)}

						{currentGroupId && (
							<>
								<Menu.Separator />
								<Menu.Item
									value="remove-project-group"
									closeOnSelect={false}
									disabled={isPending}
									onSelect={() => {
										void handleAssign(null);
									}}
								>
									<Icon
										fontSize="sm"
										color="fg.muted"
										flexShrink={0}
									>
										<FiX />
									</Icon>
									{m.removeFromProjectGroup()}
								</Menu.Item>
							</>
						)}

						<Menu.Separator />
						{showCreateInput ? (
							<Box
								px="2"
								py="1.5"
								onClick={(e) => e.stopPropagation()}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === "Enter") {
										e.preventDefault();
										void handleCreate();
									}
									if (e.key === "Escape") {
										e.preventDefault();
										setIsCreating(false);
										setName("");
									}
								}}
							>
								<Input
									ref={inputRef}
									size="xs"
									value={name}
									disabled={isPending}
									placeholder={m.projectGroupNamePlaceholder()}
									onChange={(e) =>
										setName(e.currentTarget.value)
									}
								/>
							</Box>
						) : (
							<Menu.Item
								value="new-project-group"
								closeOnSelect={false}
								disabled={isPending}
								onSelect={() => setIsCreating(true)}
							>
								<Icon
									fontSize="sm"
									color="fg.muted"
									flexShrink={0}
								>
									<FiPlus />
								</Icon>
								{m.createProjectGroup()}
							</Menu.Item>
						)}
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	);
}
