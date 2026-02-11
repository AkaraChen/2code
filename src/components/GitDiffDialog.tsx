import {
	Badge,
	Box,
	CloseButton,
	Dialog,
	HStack,
	Icon,
	Portal,
	Spinner,
	Stack,
	Text,
} from "@chakra-ui/react";
import type {
	ChangeContent,
	FileDiffMetadata,
	FileDiffOptions,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";
import type { TerminalThemeId } from "@/lib/terminalThemes";
import { useFontStore } from "@/stores/fontStore";
import { useThemePreference } from "./ThemeProvider";

const shikiThemeMap: Record<TerminalThemeId, string> = {
	"github-dark": "github-dark",
	"github-light": "github-light",
	dracula: "dracula",
	"ayu-dark": "ayu-dark",
	"ayu-light": "ayu-light",
	"solarized-dark": "solarized-dark",
	"solarized-light": "solarized-light",
	"one-dark": "one-dark-pro",
	"one-light": "one-light",
};

function getLineStats(file: FileDiffMetadata) {
	let additions = 0;
	let deletions = 0;
	for (const hunk of file.hunks) {
		for (const content of hunk.hunkContent) {
			if (content.type === "change") {
				const c = content as ChangeContent;
				additions += c.additions.length;
				deletions += c.deletions.length;
			}
		}
	}
	return { additions, deletions };
}

const changeTypeBadge: Record<string, { label: string; colorPalette: string }> =
	{
		new: { label: "New", colorPalette: "green" },
		deleted: { label: "Deleted", colorPalette: "red" },
		change: { label: "Changed", colorPalette: "blue" },
		"rename-pure": { label: "Renamed", colorPalette: "yellow" },
		"rename-changed": { label: "Renamed", colorPalette: "yellow" },
	};

function FileDiffHeader({
	file,
	collapsed,
	onToggle,
}: {
	file: FileDiffMetadata;
	collapsed: boolean;
	onToggle: () => void;
}) {
	const { additions, deletions } = useMemo(() => getLineStats(file), [file]);
	const badge = changeTypeBadge[file.type] ?? changeTypeBadge.change;
	const displayName =
		file.prevName && file.prevName !== file.name
			? `${file.prevName} → ${file.name}`
			: file.name;

	return (
		<HStack
			px="3"
			py="2"
			bg="bg.muted"
			borderRadius="md"
			cursor="pointer"
			onClick={onToggle}
			_hover={{ bg: "bg.emphasized" }}
			userSelect="none"
		>
			<Icon fontSize="lg" color="fg.subtle">
				{collapsed ? <RiArrowRightSLine /> : <RiArrowDownSLine />}
			</Icon>
			<Badge size="sm" colorPalette={badge.colorPalette}>
				{badge.label}
			</Badge>
			<Text fontSize="sm" fontFamily="mono" flex="1" truncate>
				{displayName}
			</Text>
			<HStack gap="2" fontSize="xs" fontFamily="mono">
				{additions > 0 && <Text color="green.solid">+{additions}</Text>}
				{deletions > 0 && <Text color="red.solid">-{deletions}</Text>}
			</HStack>
		</HStack>
	);
}

interface GitDiffDialogProps {
	isOpen: boolean;
	onClose: () => void;
	contextId: string;
}

export default function GitDiffDialog({
	isOpen,
	onClose,
	contextId,
}: GitDiffDialogProps) {
	const { isDark } = useThemePreference();
	const darkTerminalTheme = useFontStore((s) => s.darkTerminalTheme);
	const lightTerminalTheme = useFontStore((s) => s.lightTerminalTheme);
	const syncTerminalTheme = useFontStore((s) => s.syncTerminalTheme);

	const { data: diff, isLoading } = useQuery({
		queryKey: queryKeys.projects.diff(contextId),
		queryFn: () => projectsApi.getDiff(contextId),
		enabled: isOpen,
	});

	const files = useMemo(() => {
		if (!diff) return [];
		return parsePatchFiles(diff).flatMap((p) => p.files);
	}, [diff]);

	const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

	const toggleCollapse = useCallback((index: number) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(index)) next.delete(index);
			else next.add(index);
			return next;
		});
	}, []);

	const options: FileDiffOptions<unknown> = useMemo(() => {
		const termTheme = syncTerminalTheme
			? darkTerminalTheme
			: isDark
				? darkTerminalTheme
				: lightTerminalTheme;
		return {
			theme: shikiThemeMap[termTheme] ?? "github-dark",
			diffStyle: "unified",
			diffIndicators: "classic",
			disableFileHeader: true,
			overflow: "wrap",
			expandUnchanged: true,
		};
	}, [isDark, darkTerminalTheme, lightTerminalTheme, syncTerminalTheme]);

	return (
		<Dialog.Root
			lazyMount
			size="cover"
			placement="center"
			scrollBehavior="inside"
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>Git Diff</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							{isLoading ? (
								<Spinner />
							) : (
								<Stack gap="4">
									{files.map((file, i) => (
										<Box key={file.name + i}>
											<FileDiffHeader
												file={file}
												collapsed={collapsed.has(i)}
												onToggle={() =>
													toggleCollapse(i)
												}
											/>
											{!collapsed.has(i) && (
												<FileDiff
													fileDiff={file}
													options={options}
												/>
											)}
										</Box>
									))}
								</Stack>
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
