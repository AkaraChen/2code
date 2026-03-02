import { Box } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";
import { useSettingsStore } from "@/features/settings/stores";

const EMPTY_OPTIONS = {};

interface DiffRendererProps {
	path: string;
	oldText?: string | null;
	newText: string;
}

export function DiffRenderer({ path, oldText, newText }: DiffRendererProps) {
	const fontFamily = useSettingsStore((s) => s.fontFamily);
	const fontSize = useSettingsStore((s) => s.fontSize);

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
			<FileDiff fileDiff={fileDiff} options={EMPTY_OPTIONS} />
		</Box>
	);
}
