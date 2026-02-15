import { Box, Flex, Skeleton, Stack } from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { TerminalPreview } from "@/features/terminal/TerminalPreview";
import type { TerminalThemeId } from "@/features/terminal/themes";
import { FontPicker } from "../FontPicker";
import { FontSizePicker } from "../FontSizePicker";
import { TerminalThemePicker } from "../TerminalThemePicker";

/**
 * 终端设置选项卡
 * 终端主题、字体、字号 + 实时预览
 */
export function TerminalSettings() {
	const [previewThemeId, setPreviewThemeId] =
		useState<TerminalThemeId | null>(null);

	return (
		<Flex gap="8" align="flex-start">
			<Stack gap="6" flex="1" minW="0" maxW="md">
				<TerminalThemePicker onPreview={setPreviewThemeId} />
				<Suspense fallback={<Skeleton height="70px" />}>
					<FontPicker />
				</Suspense>
				<FontSizePicker />
			</Stack>
			<Box flex="1" minW="0">
				<TerminalPreview themeId={previewThemeId} />
			</Box>
		</Flex>
	);
}
