import { Command, useCommandState } from "cmdk";
import {
	type ReactNode,
	memo,
	useCallback,
	useDeferredValue,
	useEffect,
	useRef,
	useState,
} from "react";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import type { FileSearchResult } from "@/generated";
import * as m from "@/paraglide/messages.js";
import FileTreeFileIcon from "@/shared/components/FileTreeFileIcon";
import { getErrorMessage } from "@/shared/lib/errors";
import { useFileSearch } from "./hooks";

interface CommandPaletteProps {
	profileId: string;
	isActive: boolean;
}

function getParentPathLabel(result: FileSearchResult) {
	const lastSlash = result.relative_path.lastIndexOf("/");
	if (lastSlash === -1) {
		return m.commandPaletteRoot();
	}
	return result.relative_path.slice(0, lastSlash);
}

function CommandPaletteEmptyState() {
	const search = useCommandState((state) => state.search.trim());

	return (
		<CommandPaletteStatusMessage>
			{search.length > 0
				? m.commandPaletteNoResults()
				: m.commandPaletteEmpty()}
		</CommandPaletteStatusMessage>
	);
}

function CommandPaletteStatusMessage({ children }: { children: ReactNode }) {
	return (
		<Command.Empty className="flex items-center justify-center px-4 py-8">
			<p className="text-center text-muted-foreground">{children}</p>
		</Command.Empty>
	);
}

interface CommandPaletteResultItemProps {
	result: FileSearchResult;
	onSelect: (result: FileSearchResult) => void;
}

const CommandPaletteResultItem = memo(({
	result,
	onSelect,
}: CommandPaletteResultItemProps) => {
	const handleSelect = useCallback(() => {
		onSelect(result);
	}, [onSelect, result]);

	return (
		<Command.Item
			value={result.path}
			onSelect={handleSelect}
			className="flex min-w-0 select-none items-center gap-2 rounded px-3 py-2 data-[selected=true]:bg-muted"
		>
			<FileTreeFileIcon fileName={result.name} size={16} />
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm">{result.name}</div>
				<div className="truncate text-xs text-muted-foreground">
					{getParentPathLabel(result)}
				</div>
			</div>
		</Command.Item>
	);
});

const CommandPaletteResultList = memo(({
	results,
	onSelect,
}: {
	results: readonly FileSearchResult[];
	onSelect: (result: FileSearchResult) => void;
}) => {
	return (
		<>
			{results.map((result) => (
				<CommandPaletteResultItem
					key={result.path}
					result={result}
					onSelect={onSelect}
				/>
			))}
		</>
	);
});

export default function CommandPalette({
	profileId,
	isActive,
}: CommandPaletteProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const deferredSearch = useDeferredValue(search.trim());
	const isPaletteOpen = isActive && isOpen;
	const openFile = useFileViewerTabsStore((state) => state.openFile);
	const {
		data: results = [],
		error,
		isError,
		isFetching,
	} = useFileSearch(profileId, deferredSearch, isPaletteOpen);
	const shouldShowErrorState = isError && results.length === 0;
	const shouldShowEmptyState =
		results.length === 0 && (deferredSearch.length === 0 || !isFetching);

	useEffect(() => {
		if (!profileId || !isActive) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat || event.altKey || event.shiftKey) return;
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key.toLowerCase() !== "k") return;

			event.preventDefault();
			event.stopPropagation();
			setIsOpen(true);
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [isActive, profileId]);

	useEffect(() => {
		if (!isPaletteOpen) return;

		const frameId = window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});

		return () => window.cancelAnimationFrame(frameId);
	}, [isPaletteOpen]);

	const closePalette = useCallback(() => {
		setIsOpen(false);
		setSearch("");
	}, []);

	const commitSelection = useCallback(
		(result: FileSearchResult) => {
			openFile(profileId, result.relative_path);
			closePalette();
		},
		[closePalette, openFile, profileId],
	);
	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) closePalette();
		},
		[closePalette],
	);

	return (
		<Command.Dialog
			open={isPaletteOpen}
			onOpenChange={handleOpenChange}
			label={m.commandPaletteTitle()}
			shouldFilter={false}
			loop
			className="project-command-palette__root"
			overlayClassName="project-command-palette__overlay"
			contentClassName="project-command-palette__dialog"
		>
			<div className="border-b px-4 py-3">
				<Command.Input
					ref={inputRef}
					placeholder={m.commandPalettePlaceholder()}
					value={search}
					onValueChange={setSearch}
					aria-label={m.commandPaletteTitle()}
					className="block w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
				/>
			</div>

			<Command.List
				label={m.commandPaletteTitle()}
				className="max-h-[60vh] overflow-y-auto p-1"
			>
				{shouldShowErrorState ? (
					<CommandPaletteStatusMessage>
						{getErrorMessage(error)}
					</CommandPaletteStatusMessage>
				) : shouldShowEmptyState ? (
					<CommandPaletteEmptyState />
				) : null}
				<CommandPaletteResultList
					results={results}
					onSelect={commitSelection}
				/>
			</Command.List>
		</Command.Dialog>
	);
}
