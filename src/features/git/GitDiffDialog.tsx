import {
	CloseButton,
	Dialog,
	Flex,
	HStack,
	Icon,
	Portal,
	Spinner,
	Text,
} from "@chakra-ui/react";
import type { FileDiffOptions } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { RiGitBranchLine } from "react-icons/ri";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import type { TerminalThemeId } from "@/features/terminal/themes";
import type { GitCommit } from "@/generated";
import { getCommitDiff, getGitDiff, getGitLog } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import GitDiffPane from "./components/GitDiffPane";
import GitDiffSidebar from "./components/GitDiffSidebar";

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

interface GitDiffDialogProps {
	isOpen: boolean;
	onClose: () => void;
	profileId: string;
	branchName?: string;
}

export default function GitDiffDialog({
	isOpen,
	onClose,
	profileId,
	branchName,
}: GitDiffDialogProps) {
	const termThemeId = useTerminalThemeId();

	const [activeTab, setActiveTab] = useState<string>("changes");
	const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
	const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(
		null,
	);
	const [selectedCommitFileIndex, setSelectedCommitFileIndex] =
		useState<number>(0);

	const { data: diff, isLoading: isDiffLoading } = useQuery({
		queryKey: queryKeys.git.diff(profileId),
		queryFn: () => getGitDiff({ profileId }),
		enabled: isOpen && activeTab === "changes",
	});

	const { data: logData, isLoading: isLogLoading } = useQuery({
		queryKey: queryKeys.git.log(profileId),
		queryFn: () => getGitLog({ profileId }),
		enabled: isOpen && activeTab === "history",
	});

	const { data: commitDiff, isLoading: isCommitDiffLoading } = useQuery({
		queryKey: queryKeys.git.commitDiff(
			profileId,
			selectedCommit?.full_hash ?? "",
		),
		queryFn: () =>
			getCommitDiff({ profileId, commitHash: selectedCommit!.full_hash }),
		enabled: isOpen && !!selectedCommit,
	});

	const files = useMemo(() => {
		if (!diff) return [];
		return parsePatchFiles(diff).flatMap((p) => p.files);
	}, [diff]);

	const commitFiles = useMemo(() => {
		if (!commitDiff) return [];
		return parsePatchFiles(commitDiff).flatMap((p) => p.files);
	}, [commitDiff]);

	const selectedFile =
		files.length > 0 && selectedFileIndex < files.length
			? files[selectedFileIndex]
			: null;

	const selectedCommitFile =
		commitFiles.length > 0 && selectedCommitFileIndex < commitFiles.length
			? commitFiles[selectedCommitFileIndex]
			: null;

	const activeFile =
		activeTab === "history" ? selectedCommitFile : selectedFile;

	const options: FileDiffOptions<unknown> = useMemo(() => {
		return {
			theme: shikiThemeMap[termThemeId] ?? "github-dark",
			diffStyle: "unified",
			diffIndicators: "classic",
			disableFileHeader: true,
			overflow: "wrap",
			expandUnchanged: true,
		};
	}, [termThemeId]);

	const handleClose = useCallback(() => {
		setActiveTab("changes");
		setSelectedFileIndex(0);
		setSelectedCommit(null);
		setSelectedCommitFileIndex(0);
		onClose();
	}, [onClose]);

	const handleTabChange = useCallback((value: string) => {
		setActiveTab(value);
		setSelectedCommit(null);
		setSelectedCommitFileIndex(0);
	}, []);

	const handleCommitSelect = useCallback((commit: GitCommit) => {
		setSelectedCommit(commit);
		setSelectedCommitFileIndex(0);
	}, []);

	const handleCommitBack = useCallback(() => {
		setSelectedCommit(null);
		setSelectedCommitFileIndex(0);
	}, []);

	const isLoading =
		(activeTab === "changes" && isDiffLoading) ||
		(activeTab === "history" && isLogLoading);

	return (
		<Dialog.Root
			lazyMount
			size="cover"
			placement="center"
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) handleClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content
						overflow="hidden"
						display="flex"
						flexDirection="column"
					>
						<Dialog.Header py="2" px="4">
							<Dialog.Title fontSize="sm">
								<HStack gap="1.5" alignItems={"center"}>
									<Icon fontSize="md">
										<RiGitBranchLine />
									</Icon>
									<Text>{branchName ?? "main"}</Text>
								</HStack>
							</Dialog.Title>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Header>

						<Dialog.Body
							p="0"
							flex="1"
							overflow="hidden"
							display="flex"
						>
							{isLoading ? (
								<Flex align="center" justify="center" flex="1">
									<Spinner />
								</Flex>
							) : (
								<>
									<GitDiffSidebar
										activeTab={activeTab}
										onTabChange={handleTabChange}
										changesFiles={files}
										selectedFileIndex={selectedFileIndex}
										onFileSelect={setSelectedFileIndex}
										logData={logData}
										selectedCommit={selectedCommit}
										commitFiles={commitFiles}
										selectedCommitFileIndex={
											selectedCommitFileIndex
										}
										isCommitDiffLoading={
											isCommitDiffLoading
										}
										onCommitSelect={handleCommitSelect}
										onCommitFileSelect={
											setSelectedCommitFileIndex
										}
										onCommitBack={handleCommitBack}
									/>
									<GitDiffPane
										activeFile={activeFile}
										options={options}
										isLoading={isCommitDiffLoading}
										activeTab={activeTab}
										tabFiles={
											activeTab === "history"
												? commitFiles
												: files
										}
									/>
								</>
							)}
						</Dialog.Body>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
