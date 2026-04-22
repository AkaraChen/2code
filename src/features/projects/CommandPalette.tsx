import { Box, Flex, HStack, Kbd, Spinner, Text, VStack } from "@chakra-ui/react";
import { Command, useCommandState } from "cmdk";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { FiArrowRight, FiFileText, FiSearch } from "react-icons/fi";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import type { FileSearchResult } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { getFileIconUrl } from "@/shared/lib/fileIcons";
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
	const isSearching = search.length > 0;
	const Icon = isSearching ? FiSearch : FiFileText;

	return (
		<Box asChild px="6" py="14">
			<Command.Empty>
				<VStack gap="3" textAlign="center">
					<Flex
						align="center"
						justify="center"
						w="10"
						h="10"
						rounded="2xl"
						bg="bg.muted"
						color="fg.muted"
					>
						<Icon size={18} />
					</Flex>
					<VStack gap="1">
						<Text fontWeight="semibold">
							{isSearching
								? m.commandPaletteNoResults()
								: m.commandPaletteEmpty()}
						</Text>
						<Text fontSize="sm" color="fg.muted">
							{isSearching
								? m.commandPaletteNoResultsHint()
								: m.commandPaletteOpenHint()}
						</Text>
					</VStack>
				</VStack>
			</Command.Empty>
		</Box>
	);
}

function CommandPaletteLoadingState() {
	return (
		<Box asChild px="6" py="10">
			<Command.Loading>
				<Flex justify="center">
					<Spinner size="sm" />
				</Flex>
			</Command.Loading>
		</Box>
	);
}

export default function CommandPalette({
	profileId,
}: CommandPaletteProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const deferredSearch = useDeferredValue(search.trim());
	const openFile = useFileViewerTabsStore((state) => state.openFile);
	const { data: results = [], isFetching } = useFileSearch(
		profileId,
		deferredSearch,
		isOpen,
	);

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
			<Flex
				direction="column"
				gap="3"
				px={{ base: "4", md: "5" }}
				py="4"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				bg="transparent"
			>
				<Flex justify="space-between" gap="3" align="center" flexWrap="wrap">
					<Text
						fontSize="xs"
						fontWeight="semibold"
						letterSpacing="0.08em"
						textTransform="uppercase"
						color="fg.muted"
					>
						{m.commandPaletteTitle()}
					</Text>
					<HStack gap="2" color="fg.muted">
						<Kbd>Cmd</Kbd>
						<Text fontSize="xs">/</Text>
						<Kbd>Ctrl</Kbd>
						<Kbd>K</Kbd>
					</HStack>
				</Flex>

				<HStack align="center" gap="3">
					<FiSearch size={18} />
					<Box
						asChild
						flex="1"
						minW="0"
						fontSize={{ base: "md", md: "lg" }}
						fontWeight="medium"
						color="fg"
						py="1"
						css={{
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
					{isFetching && deferredSearch.length > 0 ? (
						<Spinner size="sm" />
					) : (
						<Kbd>Esc</Kbd>
					)}
				</HStack>

				<Text fontSize="xs" color="fg.muted">
					{m.commandPaletteHint()}
				</Text>
			</Flex>

			<Box
				asChild
				maxH={{ base: "50vh", md: "56vh" }}
				overflowY="auto"
				p="2"
				css={{
					scrollPaddingBlockStart: "0.75rem",
					scrollPaddingBlockEnd: "0.75rem",
				}}
			>
				<Command.List label={m.commandPaletteTitle()}>
					{!isFetching ? <CommandPaletteEmptyState /> : null}
					{isFetching && deferredSearch.length > 0 ? (
						<CommandPaletteLoadingState />
					) : null}
					{results.length > 0 ? (
						<Command.Group
							heading={
								<Text
									fontSize="xs"
									fontWeight="semibold"
									letterSpacing="0.08em"
									textTransform="uppercase"
									color="fg.muted"
									px="3"
									pb="1.5"
									pt="2"
								>
									{m.commandPaletteResultCount({ count: results.length })}
								</Text>
							}
						>
							{results.map((result) => (
								<Box
									key={result.path}
									asChild
									px="3"
									py="2.5"
									rounded="xl"
									borderWidth="1px"
									borderColor="transparent"
									display="flex"
									alignItems="center"
									gap="3"
									cursor="pointer"
									transition="background-color 0.14s ease, border-color 0.14s ease, transform 0.14s ease"
									_hover={{ bg: "bg.subtle" }}
									css={{
										"&[data-selected='true']": {
											background: "var(--chakra-colors-bg-subtle)",
											borderColor:
												"var(--chakra-colors-border-emphasized)",
											transform: "translateX(2px)",
										},
									}}
								>
									<Command.Item
										value={result.path}
										onSelect={() => commitSelection(result)}
									>
										<img
											src={getFileIconUrl(result.name)}
											width={18}
											height={18}
											alt=""
											draggable={false}
										/>
										<Box flex="1" minW="0">
											<Text fontSize="sm" fontWeight="medium" truncate>
												{result.name}
											</Text>
											<Text
												fontSize="xs"
												color="fg.muted"
												fontFamily="mono"
												truncate
											>
												{getParentPathLabel(result)}
											</Text>
										</Box>
										<HStack gap="2" color="fg.muted" flexShrink={0}>
											<Kbd>Enter</Kbd>
											<FiArrowRight size={14} />
										</HStack>
									</Command.Item>
								</Box>
							))}
						</Command.Group>
					) : null}
				</Command.List>
			</Box>

			{results.length > 0 ? (
				<Flex
					px="4"
					py="2.5"
					borderTopWidth="1px"
					borderColor="border.subtle"
					justify="space-between"
					align="center"
					gap="3"
					flexWrap="wrap"
				>
					<HStack gap="2" color="fg.muted">
						<Kbd>Enter</Kbd>
						<Text fontSize="xs">{m.commandPaletteFooterHint()}</Text>
					</HStack>
					<Text fontSize="xs" color="fg.muted">
						{deferredSearch.length > 0 ? deferredSearch : m.commandPaletteRoot()}
					</Text>
				</Flex>
			) : null}
		</Command.Dialog>
	);
}
