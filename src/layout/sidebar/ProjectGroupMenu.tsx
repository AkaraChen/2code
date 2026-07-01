import { useEffect, useRef, useState } from "react";
import { FiCheck, FiPlus, FiX } from "react-icons/fi";
import { toast } from "sonner";
import {
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
	useAssignProjectToGroup,
	useCreateProjectGroup,
} from "@/features/projects/hooks";
import type { ProjectGroup, ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { getErrorMessage } from "@/shared/lib/errors";

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
		toast.error(m.somethingWentWrong(), {
			description: getErrorMessage(error),
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
		<ContextMenuSub>
			<ContextMenuSubTrigger>
				<span className="min-w-0 flex-1 truncate">
					{m.addToProjectGroup()}
				</span>
			</ContextMenuSubTrigger>
			<ContextMenuSubContent className="min-w-56">
				<ContextMenuGroup>
					{projectGroups.length === 0 ? (
						<div className="px-3 py-2 text-sm text-muted-foreground">
							{m.noProjectGroups()}
						</div>
					) : (
						projectGroups.map((group) => {
							const isCurrent = currentGroupId === group.id;
							return (
								<ContextMenuItem
									key={group.id}
									closeOnClick={false}
									disabled={isPending || isCurrent}
									onClick={() => {
										void handleAssign(group.id);
									}}
								>
									<FiCheck className={isCurrent ? "" : "opacity-0"} />
									<span className="min-w-0 flex-1 truncate">
										{group.name}
									</span>
								</ContextMenuItem>
							);
						})
					)}
				</ContextMenuGroup>

				{currentGroupId && (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							closeOnClick={false}
							disabled={isPending}
							onClick={() => {
								void handleAssign(null);
							}}
						>
							<FiX />
							{m.removeFromProjectGroup()}
						</ContextMenuItem>
					</>
				)}

				<ContextMenuSeparator />
				{showCreateInput ? (
					<div
						className="px-2 py-1.5"
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
							value={name}
							disabled={isPending}
							placeholder={m.projectGroupNamePlaceholder()}
							onChange={(e) => setName(e.currentTarget.value)}
						/>
					</div>
				) : (
					<ContextMenuItem
						closeOnClick={false}
						disabled={isPending}
						onClick={() => setIsCreating(true)}
					>
						<FiPlus />
						{m.createProjectGroup()}
					</ContextMenuItem>
				)}
			</ContextMenuSubContent>
		</ContextMenuSub>
	);
}
