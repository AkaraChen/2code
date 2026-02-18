import { Box, Link, Text } from "@chakra-ui/react";
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
	switch (content.type) {
		case "content":
			// 渲染内容块
			if (content.content.type === "text") {
				return (
					<MarkdownRenderer
						content={content.content.text}
						bg="transparent"
						align="flex-start"
					/>
				);
			}
			if (content.content.type === "image") {
				return (
					<Box my="2">
						<img
							src={`data:${content.content.mimeType};base64,${content.content.data}`}
							alt={m.agentToolOutputAlt()}
							style={{ maxWidth: "100%", borderRadius: "4px" }}
						/>
					</Box>
				);
			}
			if (content.content.type === "resource_link") {
				return (
					<Box my="2" fontSize="sm">
						<Link href={content.content.uri} color="blue.solid" target="_blank">
							{content.content.uri}
						</Link>
					</Box>
				);
			}
			return null;

		case "diff":
			return (
				<DiffRenderer
					path={content.path}
					oldText={content.oldText}
					newText={content.newText}
				/>
			);

		case "terminal":
			return (
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
						{m.agentTerminal({ id: content.terminalId })}
					</Text>
				</Box>
			);

		default:
			return null;
	}
}
