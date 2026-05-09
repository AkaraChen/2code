import { Box, Text } from "@chakra-ui/react";
import { Command, useCommandState } from "cmdk";
import {
	type ReactNode,
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
		<Box
			asChild
			display="flex"
			alignItems="center"
			justifyContent="center"
			px="4"
			py="8"
		>
			<Command.Empty>
				<Text textAlign="center" color="fg.muted">
					{children}
				</Text>
			</Command.Empty>
		</Box>
	);
}

export default function CommandPalette({ profileId }: CommandPaletteProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const deferredSearch = useDeferredValue(search.trim());
	const openFile = useFileViewerTabsStore((state) => state.openFile);
	const {
		data: results = [],
		error,
		isError,
		isFetching,
	} = useFileSearch(profileId, deferredSearch, isOpen);
	const shouldShowErrorState = isError && results.length === 0;
	const shouldShowEmptyState =
		results.length === 0 && (deferredSearch.length === 0 || !isFetching);

	useEffect(() => {
		if (!profileId) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat || event.altKey || event.shiftKey) return;
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key.toLowerCase() !== "k") return;

			event.preventDefault();
			setIsOpen(true);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [profileId]);

	useEffect(() => {
		if (!isOpen) return;

		const frameId = window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});

		return () => window.cancelAnimationFrame(frameId);
	}, [isOpen]);

	function closePalette() {
		setIsOpen(false);
		setSearch("");
	}

	function commitSelection(result: FileSearchResult) {
		openFile(profileId, result.path);
		closePalette();
	}

	return (
		<Command.Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) closePalette();
			}}
			label={m.commandPaletteTitle()}
			shouldFilter={false}
			loop
			className="project-command-palette__root"
			overlayClassName="project-command-palette__overlay"
			contentClassName="project-command-palette__dialog"
		>
			<Box
				px="4"
				py="3"
				borderBottomWidth="1px"
				borderColor="border.subtle"
			>
				<Box
					asChild
					flex="1"
					minW="0"
					fontSize="md"
					color="fg"
					css={{
						display: "block",
						width: "100%",
						background: "transparent",
						border: "0",
						boxShadow: "none",
						color: "inherit",
						appearance: "none",
						padding: "0",
						margin: "0",
						"&::placeholder": {
							color: "var(--chakra-colors-fg-muted)",
						},
						"&:focus": {
							outline: "none",
						},
					}}
				>
					<Command.Input
						ref={inputRef}
						placeholder={m.commandPalettePlaceholder()}
						value={search}
						onValueChange={setSearch}
						aria-label={m.commandPaletteTitle()}
					/>
				</Box>
			</Box>

			<Box asChild maxH="60vh" overflowY="auto" p="1">
				<Command.List label={m.commandPaletteTitle()}>
					{shouldShowErrorState ? (
						<CommandPaletteStatusMessage>
							{getErrorMessage(error)}
						</CommandPaletteStatusMessage>
					) : shouldShowEmptyState ? (
						<CommandPaletteEmptyState />
					) : null}
					{results.map((result) => (
						<Box
							key={result.path}
							asChild
							userSelect="none"
							display="flex"
							alignItems="center"
							gap="2"
							minW="0"
							px="3"
							py="2"
							rounded="l1"
							cursor="pointer"
							css={{
								"&[data-selected='true']": {
									background:
										"var(--chakra-colors-bg-subtle)",
								},
							}}
						>
							<Command.Item
								value={result.path}
								onSelect={() => commitSelection(result)}
							>
								<FileTreeFileIcon
									fileName={result.name}
									size={16}
								/>
								<Box flex="1" minW="0">
									<Text fontSize="sm" truncate>
										{result.name}
									</Text>
									<Text
										fontSize="xs"
										color="fg.muted"
										truncate
									>
										{getParentPathLabel(result)}
									</Text>
								</Box>
							</Command.Item>
						</Box>
					))}
				</Command.List>
			</Box>
		</Command.Dialog>
	);
}
