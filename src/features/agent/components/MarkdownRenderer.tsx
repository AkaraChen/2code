import { Box, CodeBlock, createShikiAdapter, Flex } from "@chakra-ui/react";
import type { HighlighterGeneric } from "shiki";
import { Streamdown } from "streamdown";
import { streamdownComponents } from "../utils/streamdownComponents";

const SHIKI_LANGS = [
	"typescript",
	"javascript",
	"python",
	"rust",
	"go",
	"bash",
	"json",
	"html",
	"css",
	"markdown",
	"tsx",
	"jsx",
] as const;

const shikiAdapter = createShikiAdapter<HighlighterGeneric<any, any>>({
	async load() {
		const { createHighlighter } = await import("shiki");
		return createHighlighter({
			langs: [...SHIKI_LANGS],
			themes: ["github-dark", "github-light"],
		});
	},
	theme: { light: "github-light", dark: "github-dark" },
});

interface MarkdownRendererProps {
	content: string;
	align?: "flex-start" | "flex-end";
	bg?: string;
	isAnimating?: boolean;
	children?: React.ReactNode;
}

/**
 * Markdown 内容渲染器
 * 使用 Streamdown + Shiki 渲染带语法高亮的 Markdown
 */
export function MarkdownRenderer({
	content,
	align = "flex-start",
	bg = "bg.muted",
	isAnimating = false,
	children,
}: MarkdownRendererProps) {
	return (
		<Flex justify={align} w="full">
			<Box
				maxW="80%"
				px="4"
				py="2"
				borderRadius="lg"
				bg={bg}
				fontSize="sm"
				overflow="auto"
			>
				<CodeBlock.AdapterProvider value={shikiAdapter}>
					<Streamdown
						animated
						isAnimating={isAnimating}
						components={streamdownComponents}
					>
						{content}
					</Streamdown>
				</CodeBlock.AdapterProvider>
				{children}
			</Box>
		</Flex>
	);
}
