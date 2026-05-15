import {
	Box,
	CloseButton,
	Dialog,
	Flex,
	Portal,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import { detectLanguage } from "@/shared/lib/languageDetection";
import { getPrismTheme } from "./prismThemes";
import { useFileContent } from "./hooks";

interface FileViewerDialogProps {
	filePath: string | null;
	onClose: () => void;
}

export default function FileViewerDialog({
	filePath,
	onClose,
}: FileViewerDialogProps) {
	const themeId = useTerminalThemeId();
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const prismStyle = getPrismTheme(themeId);

	const {
		data: content,
		error,
		isError,
		isLoading,
	} = useFileContent(
		filePath ?? "",
		!!filePath,
	);

	const filename = filePath?.split("/").pop() ?? "";
	const language = detectLanguage(filename);

	return (
		<Dialog.Root
			open={!!filePath}
			onOpenChange={(e) => { if (!e.open) onClose(); }}
			size="xl"
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content h="80vh" display="flex" flexDirection="column">
						<Dialog.Header px="4" py="2.5" borderBottomWidth="1px" borderColor="border.subtle">
							<Dialog.Title fontFamily="mono" fontSize="sm">
								{filename}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body p="0" overflow="auto" flex="1">
							{isLoading && (
								<Flex align="center" justify="center" h="32">
									<Spinner size="sm" />
								</Flex>
							)}
							{isError && (
								<Flex align="center" justify="center" h="32" px="6">
									<Text color="fg.muted" fontSize="sm" textAlign="center">
										{error instanceof Error ? error.message : String(error)}
									</Text>
								</Flex>
							)}
							{content != null && (
								<Box
									css={{
										"& pre": {
											margin: "0 !important",
											borderRadius: "0 !important",
											fontSize: `${fontSize}px !important`,
											fontFamily: `"${fontFamily}", monospace !important`,
										},
									}}
								>
									<SyntaxHighlighter
										language={language}
										style={prismStyle}
										showLineNumbers
										wrapLongLines={false}
										customStyle={{
											margin: 0,
											borderRadius: 0,
											fontSize: `${fontSize}px`,
											fontFamily: `"${fontFamily}", monospace`,
										}}
									>
										{content}
									</SyntaxHighlighter>
								</Box>
							)}
						</Dialog.Body>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
