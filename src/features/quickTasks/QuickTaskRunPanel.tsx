import { Badge, Box, Flex, HStack, IconButton, Text } from "@chakra-ui/react";
import { FiMinus, FiRefreshCw, FiSquare, FiTrash2 } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import { QuickTaskTerminal } from "./QuickTaskTerminal";
import {
	clearQuickTaskOutput,
	type QuickTaskRun,
	type QuickTaskRunStatus,
	startQuickTaskRun,
	stopQuickTaskRun,
	useQuickTaskRuntimeStore,
} from "./quickTaskRuntime";

function statusLabel(status: QuickTaskRunStatus) {
	switch (status) {
		case "starting":
			return m.quickTaskStatusStarting();
		case "running":
			return m.quickTaskStatusRunning();
		case "stopping":
			return m.quickTaskStatusStopping();
		case "exited":
			return m.quickTaskStatusExited();
		case "failed":
			return m.quickTaskStatusFailed();
	}
}

function statusPalette(status: QuickTaskRunStatus) {
	switch (status) {
		case "running":
			return "green";
		case "starting":
		case "stopping":
			return "yellow";
		case "failed":
			return "red";
		case "exited":
			return "gray";
	}
}

function canStop(run: QuickTaskRun) {
	return (
		run.status === "starting" ||
		run.status === "running" ||
		run.status === "stopping"
	);
}

function isPtyReady(run: QuickTaskRun) {
	return run.status === "running" || run.status === "stopping";
}

export function QuickTaskRunPanel() {
	const runs = useQuickTaskRuntimeStore((s) => s.runs);
	const focusedRunId = useQuickTaskRuntimeStore((s) => s.focusedRunId);
	const isPanelOpen = useQuickTaskRuntimeStore((s) => s.isPanelOpen);
	const setPanelOpen = useQuickTaskRuntimeStore((s) => s.setPanelOpen);
	const run = focusedRunId ? runs[focusedRunId] : null;

	if (!isPanelOpen || !run) return null;

	return (
		<Box
			position="fixed"
			right={{ base: "3", md: "4" }}
			bottom="16"
			w={{
				base: "calc(100vw - 24px)",
				md: "min(640px, calc(100vw - 32px))",
			}}
			h={{ base: "56vh", md: "420px" }}
			rounded="l3"
			borderWidth="1px"
			borderColor="border.subtle"
			bg="bg.panel"
			boxShadow="xl"
			overflow="hidden"
			zIndex="overlay"
			display="flex"
			flexDirection="column"
		>
			<Flex
				px="3"
				py="2"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				align="center"
				gap="3"
			>
				<Box minW="0" flex="1">
					<HStack gap="2" minW="0">
						<Text fontWeight="medium" truncate>
							{run.name}
						</Text>
						<Badge
							size="sm"
							colorPalette={statusPalette(run.status)}
							flexShrink="0"
						>
							{statusLabel(run.status)}
						</Badge>
					</HStack>
					<Text
						fontSize="xs"
						color="fg.muted"
						fontFamily="mono"
						truncate
					>
						{run.cwd}
					</Text>
				</Box>
				<HStack gap="1" flexShrink="0">
					<IconButton
						size="xs"
						variant="ghost"
						aria-label={m.clearQuickTaskOutput()}
						onClick={() => clearQuickTaskOutput(run.runId)}
					>
						<FiTrash2 />
					</IconButton>
					{canStop(run) ? (
						<IconButton
							size="xs"
							variant="ghost"
							aria-label={m.stopQuickTask()}
							disabled={run.status === "stopping"}
							onClick={() => {
								void stopQuickTaskRun(run.runId);
							}}
						>
							<FiSquare />
						</IconButton>
					) : (
						<IconButton
							size="xs"
							variant="ghost"
							aria-label={m.restartQuickTask()}
							onClick={() => {
								void startQuickTaskRun({
									id: run.taskId,
									name: run.name,
									cwd: run.cwd,
									command: run.command,
									shell: run.shell,
								});
							}}
						>
							<FiRefreshCw />
						</IconButton>
					)}
					<IconButton
						size="xs"
						variant="ghost"
						aria-label={m.hideQuickTaskPanel()}
						title={m.hideQuickTaskPanel()}
						onClick={() => setPanelOpen(false)}
					>
						<FiMinus />
					</IconButton>
				</HStack>
			</Flex>
			<Box flex="1" minH="0">
				<QuickTaskTerminal
					runId={run.runId}
					isActive={isPanelOpen}
					isPtyReady={isPtyReady(run)}
				/>
			</Box>
		</Box>
	);
}
