import { CloseButton, Dialog, Portal, Spinner, Stack } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";
import { useThemePreference } from "./ThemeProvider";

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

	const { data: diff, isLoading } = useQuery({
		queryKey: queryKeys.projects.diff(contextId),
		queryFn: () => projectsApi.getDiff(contextId),
		enabled: isOpen,
	});

	const files = useMemo(() => {
		if (!diff) return [];
		return parsePatchFiles(diff).flatMap((p) => p.files);
	}, [diff]);

	const options = useMemo(
		() => ({ theme: isDark ? "github-dark" : "github-light" }),
		[isDark],
	);

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
										<FileDiff
											key={file.name + i}
											fileDiff={file}
											options={options}
										/>
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
