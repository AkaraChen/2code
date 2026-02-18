import { Box, Link, Text } from "@chakra-ui/react";
import { match } from "ts-pattern";
import * as m from "@/paraglide/messages.js";
import type { ToolCallContent } from "../types";
import { DiffRenderer } from "./DiffRenderer";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ToolCallContentRendererProps {
	content: ToolCallContent;
}

export function ToolCallContentRenderer({
	content,
}: ToolCallContentRendererProps) {
	return match(content)
		.with({ type: "content", content: { type: "text" } }, (c) => (
			<MarkdownRenderer
				content={c.content.text}
				bg="transparent"
				align="flex-start"
			/>
		))
		.with({ type: "content", content: { type: "image" } }, (c) => (
			<Box my="2">
				<img
					src={`data:${c.content.mimeType};base64,${c.content.data}`}
					alt={m.agentToolOutputAlt()}
					style={{ maxWidth: "100%", borderRadius: "4px" }}
				/>
			</Box>
		))
		.with({ type: "content", content: { type: "resource_link" } }, (c) => (
			<Box my="2" fontSize="sm">
				<Link href={c.content.uri} color="blue.solid" target="_blank">
					{c.content.uri}
				</Link>
			</Box>
		))
		.with({ type: "diff" }, (c) => (
			<DiffRenderer
				path={c.path}
				oldText={c.oldText}
				newText={c.newText}
			/>
		))
		.with({ type: "terminal" }, (c) => (
			<Box
				px="3"
				py="2"
				my="2"
				bg="bg.subtle"
				borderRadius="md"
				fontSize="sm"
				fontFamily="mono"
			>
				<Text color="fg.muted">
					{m.agentTerminal({ id: c.terminalId })}
				</Text>
			</Box>
		))
		.otherwise(() => null);
}
