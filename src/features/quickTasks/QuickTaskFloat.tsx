import {
	Badge,
	Box,
	Button,
	Circle,
	HStack,
	IconButton,
	Portal,
	Stack,
	Text,
} from "@chakra-ui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import {
	FiMaximize2,
	FiMinus,
	FiPlus,
	FiSettings,
	FiZap,
} from "react-icons/fi";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import { QuickTaskRunPanel } from "./QuickTaskRunPanel";
import {
	type QuickTaskRunStatus,
	startQuickTaskRun,
	useQuickTaskRuntimeStore,
} from "./quickTaskRuntime";
import { useQuickTaskStore } from "./quickTaskStore";

const MENU_MOTION_PROPS = {
	initial: { opacity: 0, y: 8, scale: 0.96 },
	animate: { opacity: 1, y: 0, scale: 1 },
	exit: { opacity: 0, y: 8, scale: 0.96 },
	transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
} as const;

function isActiveStatus(status: QuickTaskRunStatus) {
	return (
		status === "starting" || status === "running" || status === "stopping"
	);
}

export default function QuickTaskFloat() {
	const navigate = useNavigate();
	const tasks = useQuickTaskStore((s) => s.tasks);
	const runs = useQuickTaskRuntimeStore((s) => s.runs);
	const focusedRunId = useQuickTaskRuntimeStore((s) => s.focusedRunId);
	const isPanelOpen = useQuickTaskRuntimeStore((s) => s.isPanelOpen);
	const isMenuOpen = useQuickTaskRuntimeStore((s) => s.isMenuOpen);
	const setPanelOpen = useQuickTaskRuntimeStore((s) => s.setPanelOpen);
	const setMenuOpen = useQuickTaskRuntimeStore((s) => s.setMenuOpen);
	const prefersReducedMotion = useReducedMotion();
	const menuMotionProps = prefersReducedMotion ? {} : MENU_MOTION_PROPS;
	const focusedRun = focusedRunId ? runs[focusedRunId] : null;

	const activeRunsByTaskId = useMemo(() => {
		const map = new Map<string, string>();
		for (const run of Object.values(runs)) {
			if (isActiveStatus(run.status)) {
				map.set(run.taskId, run.runId);
			}
		}
		return map;
	}, [runs]);

	function openSettings() {
		setMenuOpen(false);
		navigate("/settings?tab=quick-tasks");
	}

	function togglePanel() {
		if (!focusedRun) return;
		setPanelOpen(!isPanelOpen);
		setMenuOpen(false);
	}

	return (
		<>
			<Portal>
				<AnimatePresence>
					{isMenuOpen ? (
						<motion.div
							style={{
								position: "fixed",
								right: 16,
								bottom: 72,
								zIndex: 1400,
								transformOrigin: "bottom right",
							}}
							{...menuMotionProps}
						>
							<Box
								w={{ base: "calc(100vw - 32px)", sm: "320px" }}
								maxH="50vh"
								overflowY="auto"
								rounded="l3"
								borderWidth="1px"
								borderColor="border.subtle"
								bg="bg.panel"
								boxShadow="xl"
								p="2"
							>
								<HStack justify="space-between" px="2" py="1.5">
									<Text fontWeight="semibold">
										{m.quickTasks()}
									</Text>
									<Badge size="sm" variant="subtle">
										{tasks.length}
									</Badge>
								</HStack>

								{tasks.length === 0 ? (
									<Stack gap="2" px="2" py="3">
										<Text fontSize="sm" color="fg.muted">
											{m.noQuickTasks()}
										</Text>
										<Button
											size="sm"
											variant="outline"
											onClick={openSettings}
										>
											<FiPlus />
											{m.addQuickTask()}
										</Button>
									</Stack>
								) : (
									<Stack gap="1">
										{tasks.map((task) => {
											const runId =
												activeRunsByTaskId.get(task.id);
											return (
												<Button
													key={task.id}
													size="sm"
													variant="ghost"
													h="auto"
													justifyContent="flex-start"
													alignItems="flex-start"
													px="2"
													py="2"
													onClick={() => {
														void startQuickTaskRun(
															task,
														);
													}}
												>
													<HStack
														gap="2"
														w="full"
														minW="0"
														align="start"
													>
														<Circle
															size="2"
															bg={
																runId
																	? "green.500"
																	: "fg.subtle"
															}
															mt="1.5"
															flexShrink="0"
														/>
														<Box
															flex="1"
															minW="0"
															textAlign="left"
														>
															<Text
																fontSize="sm"
																truncate
															>
																{task.name}
															</Text>
															<Text
																fontSize="xs"
																color="fg.muted"
																fontFamily="mono"
																truncate
															>
																{task.cwd}
															</Text>
														</Box>
													</HStack>
												</Button>
											);
										})}
									</Stack>
								)}

								<HStack
									mt="2"
									pt="2"
									borderTopWidth="1px"
									borderColor="border.subtle"
								>
									{focusedRun ? (
										<Button
											size="xs"
											variant="ghost"
											flex="1"
											onClick={togglePanel}
										>
											{isPanelOpen ? (
												<FiMinus />
											) : (
												<FiMaximize2 />
											)}
											{isPanelOpen
												? m.hideQuickTaskPanel()
												: m.showQuickTaskPanel()}
										</Button>
									) : null}
									<Button
										size="xs"
										variant="ghost"
										flex="1"
										onClick={openSettings}
									>
										<FiSettings />
										{m.manageQuickTasks()}
									</Button>
								</HStack>
							</Box>
						</motion.div>
					) : null}
				</AnimatePresence>

				<IconButton
					aria-label={m.quickTasks()}
					position="fixed"
					bottom="4"
					right="4"
					zIndex="overlay"
					rounded="full"
					size="md"
					variant="subtle"
					boxShadow="lg"
					onClick={() => setMenuOpen(!isMenuOpen)}
				>
					<FiZap />
				</IconButton>
			</Portal>
			<QuickTaskRunPanel />
		</>
	);
}
