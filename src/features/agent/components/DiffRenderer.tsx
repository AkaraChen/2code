import { Box } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";

interface DiffRendererProps {
	path: string;
	oldText?: string | null;
	newText: string;
}

export function DiffRenderer({
	path,
	oldText,
	newText,
}: DiffRendererProps) {
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);

	// 转换为 FileDiffMetadata 格式
	const fileDiff = useMemo(() => {
		const oldContent = oldText ?? "";

		return {
			name: path,
			prevName: path,
			type: oldContent ? ("change" as const) : ("add" as const),
			oldContent,
			newContent: newText,
			hunks: [], // @pierre/diffs 会自动计算
			splitLineCount: 0,
			unifiedLineCount: 0,
		} as FileDiffMetadata;
	}, [path, oldText, newText]);

	const options = useMemo(() => ({}), []);

	return (
		<Box
			my="2"
			borderRadius="md"
			overflow="hidden"
			css={{
				"--diffs-font-family": `"${fontFamily}", monospace`,
				"--diffs-font-size": `${fontSize}px`,
			}}
		>
			<FileDiff fileDiff={fileDiff} options={options} />
		</Box>
	);
}
