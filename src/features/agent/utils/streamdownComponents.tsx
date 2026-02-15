import {
	Blockquote,
	Box,
	Code,
	CodeBlock,
	Heading,
	Link,
	List,
	Table,
	Text,
} from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-shell";
import type { ComponentPropsWithoutRef } from "react";

function openExternalLink(href: string | undefined): void {
	if (!href) return;
	open(href).catch((err) => console.error("Failed to open link:", err));
}

/**
 * Streamdown 组件映射配置
 * 将 Markdown 元素映射到 Chakra UI 组件
 */
export const streamdownComponents = {
	h1: (props: ComponentPropsWithoutRef<"h1">) => (
		<Heading as="h1" size="2xl" mt="6" mb="4" {...props} />
	),
	h2: (props: ComponentPropsWithoutRef<"h2">) => (
		<Heading as="h2" size="xl" mt="5" mb="3" {...props} />
	),
	h3: (props: ComponentPropsWithoutRef<"h3">) => (
		<Heading as="h3" size="lg" mt="4" mb="2" {...props} />
	),
	h4: (props: ComponentPropsWithoutRef<"h4">) => (
		<Heading as="h4" size="md" mt="4" mb="2" {...props} />
	),
	h5: (props: ComponentPropsWithoutRef<"h5">) => (
		<Heading as="h5" size="sm" mt="3" mb="2" {...props} />
	),
	h6: (props: ComponentPropsWithoutRef<"h6">) => (
		<Heading as="h6" size="xs" mt="3" mb="2" {...props} />
	),
	p: (props: ComponentPropsWithoutRef<"p">) => <Text my="3" {...props} />,
	code: (props: ComponentPropsWithoutRef<"code">) => {
		if (props.className?.includes("language-")) {
			return <code {...props} />;
		}
		return <Code fontSize="0.9em" px="1" {...props} />;
	},
	pre: ({ children }: ComponentPropsWithoutRef<"pre">) => {
		const codeElement = (children as any)?.props;
		const className = codeElement?.className || "";
		const language = className.replace("language-", "") || "text";
		const code =
			typeof codeElement?.children === "string"
				? codeElement.children.trim()
				: "";

		if (!code) {
			return (
				<Box
					as="pre"
					bg="bg.muted"
					borderRadius="md"
					p="4"
					my="4"
					overflow="auto"
					textStyle="sm"
				>
					{children}
				</Box>
			);
		}

		return (
			<CodeBlock.Root code={code} language={language} my="4">
				<CodeBlock.Content>
					<CodeBlock.Code>
						<CodeBlock.CodeText />
					</CodeBlock.Code>
				</CodeBlock.Content>
			</CodeBlock.Root>
		);
	},
	blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
		<Blockquote.Root my="4" {...props}>
			<Blockquote.Content>{props.children}</Blockquote.Content>
		</Blockquote.Root>
	),
	a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
		<Link
			{...props}
			onClick={(e) => {
				e.preventDefault();
				openExternalLink(href);
			}}
			color="blue.500"
			textDecoration="underline"
			cursor="pointer"
		>
			{children}
		</Link>
	),
	ul: (props: ComponentPropsWithoutRef<"ul">) => (
		<List.Root as="ul" my="3" ps="6" {...props} />
	),
	ol: (props: ComponentPropsWithoutRef<"ol">) => (
		<List.Root as="ol" my="3" ps="6" {...props} />
	),
	li: (props: ComponentPropsWithoutRef<"li">) => (
		<List.Item my="1" {...props} />
	),
	hr: (props: ComponentPropsWithoutRef<"hr">) => (
		<Box as="hr" my="6" borderColor="border" {...props} />
	),
	strong: (props: ComponentPropsWithoutRef<"strong">) => (
		<Box as="strong" fontWeight="semibold" {...props} />
	),
	em: (props: ComponentPropsWithoutRef<"em">) => (
		<Box as="em" fontStyle="italic" {...props} />
	),
	table: (props: ComponentPropsWithoutRef<"table">) => (
		<Table.Root size="sm" variant="outline" my="4" {...props} />
	),
	thead: (props: ComponentPropsWithoutRef<"thead">) => (
		<Table.Header {...props} />
	),
	tbody: (props: ComponentPropsWithoutRef<"tbody">) => (
		<Table.Body {...props} />
	),
	tr: (props: ComponentPropsWithoutRef<"tr">) => <Table.Row {...props} />,
	th: (props: ComponentPropsWithoutRef<"th">) => (
		<Table.ColumnHeader {...props} />
	),
	td: (props: ComponentPropsWithoutRef<"td">) => <Table.Cell {...props} />,
};
