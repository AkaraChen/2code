import {
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Menu,
	Portal,
	Spinner,
	Text,
	VStack,
} from "@chakra-ui/react";
import { Suspense, use, useCallback, useMemo, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { LuShrink } from "react-icons/lu";
import { RiArrowDownSLine } from "react-icons/ri";
import { useShallow } from "zustand/react/shallow";
import { sessionRegistry } from "@/features/tabs/sessionRegistry";
import * as m from "@/paraglide/messages.js";
import { PageError } from "@/shared/components/Fallbacks";
import type { AgentTabSession } from "./AgentTabSession";
import { ChatInput } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";
import { useSendAgentPrompt, useSetAgentModel, useSetAgentMode } from "./hooks";
import { useAgentStore } from "./store";

interface AgentChatProps {
	sessionId: string;
	isActive: boolean;
}

/** Deduplicates concurrent reconnection attempts per session. */
const reconnectCache = new Map<string, Promise<void>>();

function getReconnectPromise(sessionId: string): Promise<void> {
	const cached = reconnectCache.get(sessionId);
	if (cached) return cached;

	const tabSession = sessionRegistry.get(sessionId) as AgentTabSession;
	const promise = tabSession.reconnect().then(
		() => {
			reconnectCache.delete(sessionId);
		},
		(err) => {
			reconnectCache.delete(sessionId);
			throw err;
		},
	);
	reconnectCache.set(sessionId, promise);
	return promise;
}

function needsReconnection(sessionId: string): boolean {
	if (useAgentStore.getState().sessions[sessionId]) return false;
	const tabSession = sessionRegistry.get(sessionId);
	return (
		!!tabSession &&
		tabSession.type === "agent" &&
		!(tabSession as AgentTabSession).connected
	);
}

function AwaitReconnection({ sessionId }: { sessionId: string }) {
	use(getReconnectPromise(sessionId));
	return null;
}

function ReconnectingFallback() {
	return (
		<Flex
			direction="column"
			h="full"
			w="full"
			align="center"
			justify="center"
			bg="bg"
		>
			<VStack gap="4">
				<Spinner size="lg" />
				<Text color="fg.muted">{m.agentReconnecting()}</Text>
			</VStack>
		</Flex>
	);
}

export function AgentChat({ sessionId, isActive }: AgentChatProps) {
	const sendPrompt = useSendAgentPrompt();
	const setAgentModel = useSetAgentModel();
	const setAgentMode = useSetAgentMode();
	const tabSession = sessionRegistry.get(sessionId) as
		| AgentTabSession
		| undefined;
	const agentIconUrl = tabSession?.iconUrl ?? null;
	const agentName = tabSession?.title ?? m.agentDefaultName();

	const {
		turns,
		isStreaming,
		streamingTurn,
		error,
		modelState,
		modelLoading,
		modeState,
		modeLoading,
	} = useAgentStore(
		useShallow((s) => {
			const session = s.sessions[sessionId];
			return {
				turns: session?.turns,
				isStreaming: session?.isStreaming,
				streamingTurn: session?.streamingTurn,
				error: session?.error,
				modelState: session?.modelState,
				modelLoading: session?.modelLoading,
				modeState: session?.modeState,
				modeLoading: session?.modeLoading,
			};
		}),
	);

	const [expanded, setExpanded] = useState(false);

	const handleSend = useCallback(
		(content: string) => sendPrompt.mutate({ sessionId, content }),
		[sendPrompt, sessionId],
	);

	const modelItems = useMemo(
		() =>
			(modelState?.available_models ?? []).map((model) => ({
				value: model.model_id,
				label: model.name,
			})),
		[modelState],
	);
	
	const selectedModel =
		modelState?.current_model_id ?? modelItems[0]?.value ?? null;
	const showModelSelector = !!modelState?.supported && modelItems.length > 0;
	const modelBusy = !!modelLoading || setAgentModel.isPending;

	const handleModelChange = useCallback(
		(details: { value: string[] }) => {
			const next = details.value[0];
			if (!next || next === selectedModel) return;
			setAgentModel.mutate({ sessionId, modelId: next });
		},
		[selectedModel, sessionId, setAgentModel],
	);

	// ── Mode selector ──────────────────────────────────────────────────────────
	const modeItems = useMemo(
		() =>
			(modeState?.available_modes ?? []).map((mode) => ({
				value: mode.id,
				label: mode.name,
			})),
		[modeState],
	);
	
	const selectedMode =
		modeState?.current_mode_id ?? modeItems[0]?.value ?? null;
	const showModeSelector = !!modeState?.supported && modeItems.length > 1;
	const modeBusy = !!modeLoading || setAgentMode.isPending;

	const handleModeChange = useCallback(
		(details: { value: string[] }) => {
			const next = details.value[0];
			if (!next || next === selectedMode) return;
			setAgentMode.mutate({ sessionId, modeId: next });
		},
		[selectedMode, sessionId, setAgentMode],
	);
	const modeSelector = showModeSelector ? (
		<Menu.Root>
			<Menu.Trigger asChild>
				<Button
					size="xs"
					variant="ghost"
					h="6"
					minH="6"
					px="2"
					color="fg.muted"
					_hover={{ bg: "bg.muted", color: "fg" }}
					disabled={modeBusy || (isStreaming ?? false)}
					aria-label={m.agentMode()}
				>
					<Text fontSize="xs" truncate maxW="32">
						{modeItems.find((m) => m.value === selectedMode)?.label ?? selectedMode}
					</Text>
					{modeBusy ? <Spinner size="xs" ml="1" /> : <RiArrowDownSLine />}
				</Button>
			</Menu.Trigger>
			<Portal>
				<Menu.Positioner>
					<Menu.Content>
						{modeItems.map((item) => (
							<Menu.Item
								key={item.value}
								value={item.value}
								onClick={() => handleModeChange({ value: [item.value] })}
							>
								{item.label}
							</Menu.Item>
						))}
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	) : null;
	const modelSelector = showModelSelector ? (
		<Menu.Root>
			<Menu.Trigger asChild>
				<Button
					size="xs"
					variant="ghost"
					h="6"
					minH="6"
					px="2"
					color="fg.muted"
					_hover={{ bg: "bg.muted", color: "fg" }}
					disabled={modelBusy || (isStreaming ?? false)}
					aria-label={m.agentModel()}
				>
					<Text fontSize="xs" truncate maxW="48">
						{modelItems.find((m) => m.value === selectedModel)?.label ?? selectedModel}
					</Text>
					{modelBusy ? <Spinner size="xs" ml="1" /> : <RiArrowDownSLine />}
				</Button>
			</Menu.Trigger>
			<Portal>
				<Menu.Positioner>
					<Menu.Content>
						{modelItems.map((item) => (
							<Menu.Item
								key={item.value}
								value={item.value}
								onClick={() => handleModelChange({ value: [item.value] })}
							>
								{item.label}
							</Menu.Item>
						))}
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	) : null;

	if (isActive && needsReconnection(sessionId)) {
		return (
			<ErrorBoundary
				fallbackRender={({ error, resetErrorBoundary }) => (
					<PageError
						error={
							error instanceof Error
								? error
								: new Error(String(error))
						}
						onRetry={resetErrorBoundary}
					/>
				)}
			>
				<Suspense fallback={<ReconnectingFallback />}>
					<AwaitReconnection sessionId={sessionId} />
				</Suspense>
			</ErrorBoundary>
		);
	}

	return (
		<Flex direction="column" h="full" w="full" bg="bg" position="relative">
			<MessageList
				turns={turns}
				isStreaming={isStreaming ?? false}
				streamingTurn={streamingTurn}
				error={error ?? undefined}
				agentIconUrl={agentIconUrl}
				agentName={agentName}
				onSuggestionSelect={handleSend}
			/>

			{/* Compact floating card */}
			{!expanded && (
				<>
					<Box h="20" flexShrink={0} aria-hidden="true" />
					<Box
						position="absolute"
						bottom="0"
						left="0"
						right="0"
						px="3"
						pb="3"
					>
						<Box maxW="2xl" mx="auto">
							<ChatInput
								onSend={handleSend}
								disabled={isStreaming ?? false}
								onToggleExpand={() => setExpanded(true)}
								modelSelector={
									<Flex gap="2">
										{modeSelector}
										{modelSelector}
									</Flex>
								}
							/>
						</Box>
					</Box>
				</>
			)}

			{/* Sheet panel */}
			{expanded && (
				<Flex
					position="absolute"
					bottom="0"
					left="0"
					right="0"
					h="50vh"
					direction="column"
					bg="bg"
					borderTopWidth="1px"
					overflow="hidden"
				>
					<HStack px="3" h="10" flexShrink={0} justify="flex-end">
						<IconButton
							size="sm"
							variant="ghost"
							onClick={() => setExpanded(false)}
							aria-label={m.agentCollapse()}
						>
							<LuShrink />
						</IconButton>
					</HStack>
					<Box flex="1" overflow="hidden">
						<ChatInput
							onSend={handleSend}
							disabled={isStreaming ?? false}
							expanded={true}
							modelSelector={
								<>
									{modeSelector}
									{modelSelector}
								</>
							}
						/>
					</Box>
				</Flex>
			)}
		</Flex>
	);
}
