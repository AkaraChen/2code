import {
	Box,
	createListCollection,
	Flex,
	HStack,
	IconButton,
	Portal,
	Select,
	Spinner,
	Text,
	VStack,
} from "@chakra-ui/react";
import { Suspense, use, useCallback, useMemo, useState } from "react";
import { LuShrink } from "react-icons/lu";
import { ErrorBoundary } from "react-error-boundary";
import { useShallow } from "zustand/react/shallow";
import type { AgentTabSession } from "./AgentTabSession";
import { sessionRegistry } from "@/features/tabs/sessionRegistry";
import { useSettingsStore } from "@/features/settings/stores";
import * as m from "@/paraglide/messages.js";
import { ChatInput } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";
import { useSendAgentPrompt, useSetAgentModel } from "./hooks";
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
		() => { reconnectCache.delete(sessionId); },
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
		<Flex direction="column" h="full" w="full" align="center" justify="center" bg="bg">
			<VStack gap="4">
				<Spinner size="lg" />
				<Text color="fg.muted">{m.agentReconnecting()}</Text>
			</VStack>
		</Flex>
	);
}

function ReconnectErrorFallback({ error }: { error: unknown }) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<Flex direction="column" h="full" w="full" align="center" justify="center" bg="bg">
			<VStack gap="4">
				<Text color="fg.error">
					{m.agentReconnectFailed({ error: message })}
				</Text>
			</VStack>
		</Flex>
	);
}

export function AgentChat({ sessionId, isActive }: AgentChatProps) {
	const sendPrompt = useSendAgentPrompt();
	const setAgentModel = useSetAgentModel();
	const defaultAgent = useSettingsStore((s) => s.defaultAgent);
	const tabSession = sessionRegistry.get(sessionId) as
		| AgentTabSession
		| undefined;
	const agentIconUrl = tabSession?.iconUrl ?? null;
	const agentName = tabSession?.title ?? m.agentDefaultName();

	const { turns, isStreaming, streamingTurn, error, modelState, modelLoading } =
		useAgentStore(
		useShallow((s) => {
			const session = s.sessions[sessionId];
			return {
				turns: session?.turns,
				isStreaming: session?.isStreaming,
				streamingTurn: session?.streamingTurn,
				error: session?.error,
				modelState: session?.modelState,
				modelLoading: session?.modelLoading,
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
	const modelCollection = useMemo(
		() =>
			createListCollection({
				items: modelItems,
			}),
		[modelItems],
	);
	const selectedModel =
		modelState?.current_model_id ?? modelItems[0]?.value ?? null;
	const showModelSelector =
		!!modelState?.supported && modelItems.length > 0;
	const modelBusy = !!modelLoading || setAgentModel.isPending;

	const handleModelChange = useCallback(
		(details: { value: string[] }) => {
			const next = details.value[0];
			if (!next || next === selectedModel) return;
			setAgentModel.mutate({ sessionId, modelId: next });
		},
		[selectedModel, sessionId, setAgentModel],
	);
	const modelSelector = showModelSelector
		? (
			<Select.Root
				collection={modelCollection}
				value={selectedModel ? [selectedModel] : []}
				onValueChange={handleModelChange}
				size="xs"
				width={{ base: "120px", md: "150px" }}
				disabled={modelBusy || (isStreaming ?? false)}
				aria-label={m.agentModel()}
				variant={"ghost"}
			>
				<Select.HiddenSelect />
				<Select.Control>
					<Select.Trigger
						h="6"
						minH="6"
						px="1"
						bg="transparent"
						borderWidth="0"
						color="fg.muted"
						_hover={{ bg: "transparent", color: "fg" }}
					>
						<Select.ValueText fontSize="xs" truncate />
					</Select.Trigger>
					<Select.IndicatorGroup>
						{modelBusy ? <Spinner size="xs" /> : <Select.Indicator />}
					</Select.IndicatorGroup>
				</Select.Control>
				<Portal>
					<Select.Positioner>
						<Select.Content>
							{modelCollection.items.map((item) => (
								<Select.Item item={item} key={item.value}>
									{item.label}
									<Select.ItemIndicator />
								</Select.Item>
							))}
						</Select.Content>
					</Select.Positioner>
				</Portal>
			</Select.Root>
		)
		: null;

	if (isActive && needsReconnection(sessionId)) {
		return (
			<ErrorBoundary FallbackComponent={ReconnectErrorFallback}>
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
					<Box position="absolute" bottom="0" left="0" right="0" px="3" pb="3">
						<Box maxW="2xl" mx="auto">
							<ChatInput
								onSend={handleSend}
								disabled={isStreaming ?? false}
								onToggleExpand={() => setExpanded(true)}
								modelSelector={modelSelector}
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
							modelSelector={modelSelector}
						/>
					</Box>
				</Flex>
			)}
		</Flex>
	);
}
