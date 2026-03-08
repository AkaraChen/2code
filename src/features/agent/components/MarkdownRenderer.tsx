import { Box, CodeBlock, createShikiAdapter } from "@chakra-ui/react";
import type { HighlighterGeneric } from "shiki";
import { ErrorBoundary } from "react-error-boundary";
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
		const hl = await createHighlighter({
			langs: [...SHIKI_LANGS],
			themes: ["github-dark", "github-light"],
		});
		// Wrap codeToHtml to silently fall back to plain text for unknown languages.
		return new Proxy(hl, {
			get(target, prop, receiver) {
				if (prop !== "codeToHtml")
					return Reflect.get(target, prop, receiver);
				return (code: string, opts: any) => {
					const lang = opts?.lang ?? "";
					const safe =
						lang === "text" ||
						lang === "" ||
						(target.getLoadedLanguages() as string[]).includes(
							lang,
						);
					return target.codeToHtml(
						code,
						safe ? opts : { ...opts, lang: "text" },
					);
				};
			},
		});
	},
	theme: { light: "github-light", dark: "github-dark" },
});

interface MarkdownRendererProps {
	content: string;
	bg?: string;
	px?: string | number;
	py?: string | number;
	isAnimating?: boolean;
	children?: React.ReactNode;
}

/**
 * Markdown 内容渲染器
 * 使用 Streamdown + Shiki 渲染带语法高亮的 Markdown
 */
export function MarkdownRenderer({
	content,
	bg = "transparent",
	px = "0",
	py = "0",
	isAnimating = false,
	children,
}: MarkdownRendererProps) {
	return (
		<Box
			w="full"
			px={px}
			py={py}
			borderRadius="lg"
			bg={bg}
			fontSize="sm"
			overflow="auto"
		>
			<ErrorBoundary
				fallbackRender={({ error }) => (
					<Box fontSize="xs" color="fg.error" px="1">
						⚠{" "}
						{error instanceof Error ? error.message : String(error)}
					</Box>
				)}
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
			</ErrorBoundary>
			{children}
		</Box>
	);
}
