import {
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useState } from "react";
import { FiEdit2, FiPlay, FiTrash2 } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import { QuickTaskDraftDialog } from "./QuickTaskDraftDialog";
import {
	type QuickTaskRunStatus,
	startQuickTaskRun,
	useQuickTaskRuntimeStore,
} from "./quickTaskRuntime";
import { useQuickTaskStore } from "./quickTaskStore";
import {
	createEmptyQuickTaskDraft,
	normalizeQuickTaskDraft,
	type QuickTaskDraft,
	quickTaskCommandPreview,
	toQuickTaskDraft,
} from "./types";

function isActiveStatus(status: QuickTaskRunStatus) {
	return (
		status === "starting" || status === "running" || status === "stopping"
	);
}

export function QuickTasksSettings() {
	const tasks = useQuickTaskStore((s) => s.tasks);
	const upsertTask = useQuickTaskStore((s) => s.upsertTask);
	const deleteTask = useQuickTaskStore((s) => s.deleteTask);
	const runs = useQuickTaskRuntimeStore((s) => s.runs);
	const clearFinishedRuns = useQuickTaskRuntimeStore(
		(s) => s.clearFinishedRuns,
	);
	const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
	const [draft, setDraft] = useState<QuickTaskDraft | null>(null);

	const isOpen = draft !== null;
	const isEditing = editingTaskId !== null;

	function openCreateDialog() {
		setEditingTaskId(null);
		setDraft(createEmptyQuickTaskDraft());
	}

	function openEditDialog(taskId: string) {
		const task = tasks.find((item) => item.id === taskId);
		if (!task) return;
		setEditingTaskId(task.id);
		setDraft(toQuickTaskDraft(task));
	}

	function closeDialog() {
		setEditingTaskId(null);
		setDraft(null);
	}

	function saveDraft() {
		if (!draft) return;
		const task = normalizeQuickTaskDraft(draft);
		if (!task) return;
		upsertTask(task);
		closeDialog();
	}

	function deleteEditingTask() {
		if (!editingTaskId) return;
		if (hasRunningTask(editingTaskId)) return;
		deleteTask(editingTaskId);
		closeDialog();
	}

	function hasRunningTask(taskId: string) {
		return Object.values(runs).some(
			(run) => run.taskId === taskId && isActiveStatus(run.status),
		);
	}

	const editingTaskIsRunning = editingTaskId
		? hasRunningTask(editingTaskId)
		: false;

	return (
		<>
			<Stack gap="4">
				<HStack justify="space-between" align="start">
					<Stack gap="1">
						<Text fontWeight="semibold">{m.quickTasks()}</Text>
						<Text fontSize="sm" color="fg.muted">
							{m.quickTasksDescription()}
						</Text>
					</Stack>
					<HStack gap="2">
						<Button
							size="sm"
							variant="ghost"
							onClick={clearFinishedRuns}
						>
							{m.clearFinishedQuickTasks()}
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={openCreateDialog}
						>
							{m.addQuickTask()}
						</Button>
					</HStack>
				</HStack>

				{tasks.length === 0 ? (
					<Box
						rounded="l3"
						borderWidth="1px"
						borderColor="border"
						px="4"
						py="3"
					>
						<Text fontSize="sm" color="fg.muted">
							{m.noQuickTasks()}
						</Text>
					</Box>
				) : (
					<Stack gap="2">
						{tasks.map((task) => {
							const isRunning = hasRunningTask(task.id);
							return (
								<Flex
									key={task.id}
									rounded="l3"
									borderWidth="1px"
									borderColor="border"
									px="4"
									py="3"
									align="center"
									justify="space-between"
									gap="4"
								>
									<Stack gap="1" minW="0">
										<HStack gap="2" minW="0">
											<Text fontWeight="medium" truncate>
												{task.name}
											</Text>
											{isRunning ? (
												<Text
													fontSize="xs"
													color="green.fg"
													flexShrink="0"
												>
													{m.quickTaskStatusRunning()}
												</Text>
											) : null}
										</HStack>
										<Text
											fontSize="sm"
											color="fg.muted"
											fontFamily="mono"
											truncate
										>
											{quickTaskCommandPreview(
												task.command,
											)}
										</Text>
										<Text
											fontSize="xs"
											color="fg.subtle"
											fontFamily="mono"
											truncate
										>
											{task.cwd}
										</Text>
									</Stack>
									<HStack gap="1" flexShrink="0">
										<IconButton
											variant="ghost"
											size="sm"
											aria-label={m.runQuickTask()}
											onClick={() => {
												void startQuickTaskRun(task);
											}}
										>
											<FiPlay />
										</IconButton>
										<IconButton
											variant="ghost"
											size="sm"
											aria-label={m.editQuickTask()}
											onClick={() =>
												openEditDialog(task.id)
											}
										>
											<FiEdit2 />
										</IconButton>
										<IconButton
											variant="ghost"
											size="sm"
											colorPalette="red"
											aria-label={m.deleteQuickTask()}
											disabled={isRunning}
											onClick={() => deleteTask(task.id)}
										>
											<FiTrash2 />
										</IconButton>
									</HStack>
								</Flex>
							);
						})}
					</Stack>
				)}
			</Stack>

			{draft ? (
				<QuickTaskDraftDialog
					draft={draft}
					isOpen={isOpen}
					isEditing={isEditing}
					canDelete={!editingTaskIsRunning}
					onChange={setDraft}
					onClose={closeDialog}
					onDelete={deleteEditingTask}
					onSave={saveDraft}
				/>
			) : null}
		</>
	);
}
