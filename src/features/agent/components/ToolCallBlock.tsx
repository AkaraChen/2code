import { Box, Collapsible, Flex, Icon, Text } from "@chakra-ui/react";
import { useState } from "react";
import {
	LuBrain,
	LuChevronDown,
	LuChevronRight,
	LuCircle,
	LuDownload,
	LuFileText,
	LuMove,
	LuPencil,
	LuSearch,
	LuTerminal,
	LuTrash2,
} from "react-icons/lu";
import { match } from "ts-pattern";
import * as m from "@/paraglide/messages.js";
import type { ToolCall } from "../types";
import { FileLocationsList } from "./FileLocationsList";
import { StatusBadge } from "./StatusBadge";
import { ToolCallContentRenderer } from "./ToolCallContentRenderer";

const KIND_ICONS = {
	read: <LuFileText />,
	edit: <LuPencil />,
	delete: <LuTrash2 />,
	move: <LuMove />,
	search: <LuSearch />,
	execute: <LuTerminal />,
	think: <LuBrain />,
	fetch: <LuDownload />,
	switch_mode: <LuCircle />,
	other: <LuCircle />,
};

const STATUS_BORDER_COLOR = {
	pending: "gray.solid",
	in_progress: "blue.solid",
	completed: "green.solid",
	failed: "red.solid",
};

function RawDataSection({ label, data }: { label: string; data: unknown }) {
	return (
		<Box mt="3">
			<Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="1">
				{label}:
			</Text>
			<Box
				px="3"
				py="2"
				bg="bg.subtle"
				borderRadius="sm"
				fontSize="xs"
				fontFamily="mono"
				overflowX="auto"
			>
				<pre>{JSON.stringify(data, null, 2)}</pre>
			</Box>
		</Box>
	);
}

interface ToolCallBlockProps {
	toolCall: ToolCall;
}

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
	const status = toolCall.status ?? "pending";
	const [expanded, setExpanded] = useState(status === "failed");

	return (
		<Flex justify="flex-start" w="full">
			<Box maxW="80%" w="full">
				<Collapsible.Root
					open={expanded}
					onOpenChange={(e) => setExpanded(e.open)}
				>
					<Collapsible.Trigger asChild>
						<Flex
							px="3"
							py="2"
							bg="bg.muted"
							borderLeft="3px solid"
							borderColor={STATUS_BORDER_COLOR[status]}
							borderRadius="md"
							cursor="pointer"
							align="center"
							gap="3"
							_hover={{ bg: "bg.subtle" }}
							transition="background 0.2s"
						>
							<Icon fontSize="md" color="fg.default">
								{KIND_ICONS[toolCall.kind ?? "other"]}
							</Icon>
							<Text flex="1" fontSize="sm" fontWeight="medium">
								{toolCall.title ?? toolCall.kind ?? m.agentToolCall()}
							</Text>
							<StatusBadge status={status} />
							<Icon fontSize="xs" color="fg.muted">
								{expanded ? <LuChevronDown /> : <LuChevronRight />}
							</Icon>
						</Flex>
					</Collapsible.Trigger>

					<Collapsible.Content>
						<Box px="4" py="3" bg="bg.muted" borderRadius="md">
							{toolCall.locations && toolCall.locations.length > 0 && (
								<FileLocationsList locations={toolCall.locations} />
							)}

							{toolCall.content?.map((content) => (
								<ToolCallContentRenderer
									key={match(content)
									.with({ type: "diff" }, (c) => `diff-${c.path}`)
									.with({ type: "terminal" }, (c) => `terminal-${c.terminalId}`)
									.with({ type: "content" }, (c) => `content-${c.content.type}`)
									.otherwise(() => "unknown")}
									content={content}
								/>
							))}

							{expanded && (
								<>
									{toolCall.rawInput && (
										<RawDataSection
											label={m.agentToolInput()}
											data={toolCall.rawInput}
										/>
									)}
									{toolCall.rawOutput && (
										<RawDataSection
											label={m.agentToolOutput()}
											data={toolCall.rawOutput}
										/>
									)}
								</>
							)}
						</Box>
					</Collapsible.Content>
				</Collapsible.Root>
			</Box>
		</Flex>
	);
}
