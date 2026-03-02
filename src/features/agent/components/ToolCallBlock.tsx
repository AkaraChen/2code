import { Badge, Box, Collapsible, Flex, Icon, Text } from "@chakra-ui/react";
import { useState } from "react";
import {
	LuBrain,
	LuChevronDown,
	LuChevronRight,
	LuCircle,
	LuCircleCheck,
	LuCircleX,
	LuClock3,
	LuDownload,
	LuFileText,
	LuLoaderCircle,
	LuMove,
	LuPencil,
	LuSearch,
	LuTerminal,
	LuTrash2,
} from "react-icons/lu";
import { match } from "ts-pattern";
import * as m from "@/paraglide/messages.js";
import type { ToolCall, ToolCallStatus } from "../types";
import { FileLocationsList } from "./FileLocationsList";
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

function ToolStatusBadge({ status }: { status: ToolCallStatus }) {
	const statusMeta = match(status)
		.with("pending", () => ({
			label: m.agentStatusPending(),
			icon: LuClock3,
		}))
		.with("in_progress", () => ({
			label: m.agentStatusInProgress(),
			icon: LuLoaderCircle,
		}))
		.with("completed", () => ({
			label: m.agentStatusCompleted(),
			icon: LuCircleCheck,
		}))
		.with("failed", () => ({
			label: m.agentStatusFailed(),
			icon: LuCircleX,
		}))
		.exhaustive();

	return (
		<Badge size="xs" variant="subtle">
			<Icon mr="1" fontSize="xs">
				<statusMeta.icon />
			</Icon>
			{statusMeta.label}
		</Badge>
	);
}

function ToolJsonSection({ label, data }: { label: string; data: unknown }) {
	return (
		<Box>
			<Text fontSize="xs" fontWeight="medium">
				{label}
			</Text>
			<Box
				as="pre"
				mt="2"
				px="2"
				py="2"
				bg="bg.subtle"
				borderRadius="sm"
				fontSize="xs"
				fontFamily="mono"
				overflowX="auto"
				whiteSpace="pre"
			>
				{JSON.stringify(data, null, 2)}
			</Box>
		</Box>
	);
}

interface ToolCallBlockProps {
	toolCall: ToolCall;
}

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
	const status = toolCall.status ?? "pending";
	const [open, setOpen] = useState(status === "failed");

	return (
		<Box maxW="80%" w="full">
			<Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
				<Box borderWidth="1px" borderRadius="md" overflow="hidden">
					<Collapsible.Trigger asChild>
						<Flex
							px="3"
							py="2"
							bg="bg.muted"
							cursor="pointer"
							align="center"
							gap="2"
							_hover={{ bg: "bg.subtle" }}
							transition="background 0.2s"
						>
							<Icon fontSize="md">
								{KIND_ICONS[toolCall.kind ?? "other"]}
							</Icon>
							<Text flex="1" fontSize="sm" fontWeight="medium">
								{toolCall.title ??
									toolCall.kind ??
									m.agentToolCall()}
							</Text>
							<ToolStatusBadge status={status} />
							<Icon fontSize="xs">
								{open ? <LuChevronDown /> : <LuChevronRight />}
							</Icon>
						</Flex>
					</Collapsible.Trigger>

					<Collapsible.Content>
						<Flex direction="column" gap="3" px="3" py="3">
							{toolCall.locations &&
								toolCall.locations.length > 0 && (
									<FileLocationsList
										locations={toolCall.locations}
									/>
								)}

							{toolCall.content?.map((content) => (
								<ToolCallContentRenderer
									key={match(content)
										.with(
											{ type: "diff" },
											(c) => `diff-${c.path}`,
										)
										.with(
											{ type: "terminal" },
											(c) => `terminal-${c.terminalId}`,
										)
										.with(
											{ type: "content" },
											(c) => `content-${c.content.type}`,
										)
										.otherwise(() => "unknown")}
									content={content}
								/>
							))}

							{toolCall.rawInput !== undefined &&
								toolCall.rawInput !== null && (
									<ToolJsonSection
										label={m.agentToolInput()}
										data={toolCall.rawInput}
									/>
								)}

							{toolCall.rawOutput !== undefined &&
								toolCall.rawOutput !== null && (
									<ToolJsonSection
										label={m.agentToolOutput()}
										data={toolCall.rawOutput}
									/>
								)}
						</Flex>
					</Collapsible.Content>
				</Box>
			</Collapsible.Root>
		</Box>
	);
}
