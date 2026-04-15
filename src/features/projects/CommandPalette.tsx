import {
	Box,
	Dialog,
	Flex,
	HStack,
	Input,
	Kbd,
	Portal,
	Spinner,
	Text,
} from "@chakra-ui/react";
import {
	useDeferredValue,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { FiArrowRight, FiSearch } from "react-icons/fi";
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

export default function CommandPalette({
	profileId,
}: CommandPaletteProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const resultsRef = useRef<HTMLDivElement | null>(null);
	const deferredSearch = useDeferredValue(search.trim());
	const openFile = useFileViewerTabsStore((state) => state.openFile);
	const { data: results = [], isFetching } = useFileSearch(
		profileId,
		deferredSearch,
		isOpen,
	);

	const selectedResult = results[selectedIndex] ?? null;

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
		if (!isOpen) {
			setSearch("");
			setSelectedIndex(0);
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});

		return () => window.cancelAnimationFrame(frameId);
	}, [isOpen]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [deferredSearch, results.length]);

	useEffect(() => {
		if (!selectedResult || !resultsRef.current) return;

		const selectedNode = resultsRef.current.querySelector<HTMLElement>(
			`[data-result-path="${CSS.escape(selectedResult.path)}"]`,
		);
		selectedNode?.scrollIntoView({ block: "nearest" });
	}, [selectedResult]);

	function closePalette() {
		setIsOpen(false);
	}

	function commitSelection(result: FileSearchResult | null) {
		if (!result) return;
		openFile(profileId, result.path);
		closePalette();
	}

	function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setSelectedIndex((current) =>
				Math.min(current + 1, Math.max(results.length - 1, 0)),
			);
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			setSelectedIndex((current) => Math.max(current - 1, 0));
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			commitSelection(selectedResult);
		}
	}

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(event) => {
				if (!event.open) closePalette();
			}}
		>
			<Portal>
				<Dialog.Backdrop
					bg="blackAlpha.500"
					backdropFilter="blur(16px)"
					zIndex="modal"
				/>
				<Dialog.Positioner
					zIndex="modal"
					alignItems="flex-start"
					pt={{ base: "16", md: "24" }}
					px={{ base: "4", md: "6" }}
				>
					<Dialog.Content
						maxW="2xl"
						w="full"
						overflow="hidden"
						rounded="2xl"
						borderWidth="1px"
						borderColor="border.subtle"
						bg="bg.panel"
						boxShadow="0 24px 80px rgba(15, 23, 42, 0.22)"
					>
						<Box
							px={{ base: "4", md: "5" }}
							py="4"
							borderBottomWidth="1px"
							borderColor="border.subtle"
						>
							<Dialog.Title
								as="div"
								fontSize="xs"
								fontWeight="semibold"
								letterSpacing="0.08em"
								textTransform="uppercase"
								color="fg.muted"
								mb="2.5"
							>
								{m.commandPaletteTitle()}
							</Dialog.Title>
							<HStack align="center" gap="3">
								<FiSearch size={18} />
								<Input
									ref={inputRef}
									placeholder={m.commandPalettePlaceholder()}
									value={search}
									onChange={(event) =>
										setSearch(event.target.value)
									}
									onKeyDown={handleInputKeyDown}
									fontSize={{ base: "md", md: "lg" }}
									fontWeight="medium"
									borderWidth="0"
									boxShadow="none"
									_focusVisible={{ boxShadow: "none" }}
									px="0"
									aria-label={m.commandPaletteTitle()}
								/>
								{isFetching ? <Spinner size="sm" /> : null}
								<Kbd>Esc</Kbd>
							</HStack>
							<Flex
								mt="2.5"
								justify="space-between"
								gap="3"
								flexWrap="wrap"
							>
								<Text fontSize="xs" color="fg.muted">
									{m.commandPaletteHint()}
								</Text>
								<Text fontSize="xs" color="fg.muted">
									Cmd/Ctrl + K
								</Text>
							</Flex>
						</Box>

						<Box
							ref={resultsRef}
							maxH={{ base: "50vh", md: "56vh" }}
							overflowY="auto"
							p="2"
							role="listbox"
						>
							{deferredSearch.length === 0 ? (
								<Flex
									direction="column"
									align="center"
									justify="center"
									gap="2"
									px="6"
									py="14"
									textAlign="center"
								>
									<Text fontWeight="semibold">
										{m.commandPaletteEmpty()}
									</Text>
									<Text fontSize="sm" color="fg.muted">
										{m.commandPaletteOpenHint()}
									</Text>
								</Flex>
							) : results.length === 0 && !isFetching ? (
								<Flex
									direction="column"
									align="center"
									justify="center"
									gap="2"
									px="6"
									py="14"
									textAlign="center"
								>
									<Text fontWeight="semibold">
										{m.commandPaletteNoResults()}
									</Text>
									<Text fontSize="sm" color="fg.muted">
										{m.commandPaletteNoResultsHint()}
									</Text>
								</Flex>
							) : (
								<Box>
									{results.map((result, index) => {
										const isSelected = index === selectedIndex;
										return (
											<Box
												key={result.path}
												data-result-path={result.path}
												as="button"
												w="full"
												textAlign="left"
												px="3"
												py="2.5"
												rounded="xl"
												borderWidth="1px"
												borderColor={
													isSelected
														? "border.emphasized"
														: "transparent"
												}
												bg={isSelected ? "bg.subtle" : "transparent"}
												transition="background-color 0.14s ease, border-color 0.14s ease"
												_hover={{ bg: "bg.subtle" }}
												display="flex"
												alignItems="center"
												gap="3"
												role="option"
												aria-selected={isSelected}
												onMouseEnter={() => setSelectedIndex(index)}
												onClick={() => commitSelection(result)}
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
													{isSelected ? <Kbd>Enter</Kbd> : null}
													<FiArrowRight size={14} />
												</HStack>
											</Box>
										);
									})}
								</Box>
							)}
						</Box>

						{results.length > 0 ? (
							<Flex
								px="4"
								py="2.5"
								borderTopWidth="1px"
								borderColor="border.subtle"
								justify="space-between"
							>
								<Text fontSize="xs" color="fg.muted">
									{m.commandPaletteResultCount({
										count: results.length,
									})}
								</Text>
								<Text fontSize="xs" color="fg.muted">
									{m.commandPaletteFooterHint()}
								</Text>
							</Flex>
						) : null}
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
