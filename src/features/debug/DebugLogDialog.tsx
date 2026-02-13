import {
	Badge,
	Box,
	CloseButton,
	Dialog,
	Flex,
	HStack,
	IconButton,
	Input,
	Portal,
	Text,
	VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RiDeleteBinLine } from "react-icons/ri";
import type { LogEntry } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import { useDebugLogStore } from "./debugLogStore";

function formatTime(timestamp: number): string {
	const d = new Date(timestamp);
	const h = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	const ms = String(d.getMilliseconds()).padStart(3, "0");
	return `${h}:${min}:${s}.${ms}`;
}

const levelColor: Record<string, string> = {
	ERROR: "red",
	WARN: "orange",
	INFO: "blue",
};

function LogRow({ entry }: { entry: LogEntry }) {
	return (
		<HStack
			gap="2"
			px="3"
			py="0.5"
			fontSize="xs"
			fontFamily="mono"
			_hover={{ bg: "bg.subtle" }}
			alignItems="baseline"
		>
			<Text color="fg.muted" flexShrink={0}>
				{formatTime(entry.timestamp)}
			</Text>
			<Badge
				size="xs"
				colorPalette={levelColor[entry.level] ?? "gray"}
				variant="subtle"
				flexShrink={0}
			>
				{entry.level}
			</Badge>
			<Text color="fg.muted" flexShrink={0}>
				{entry.source}
			</Text>
			<Text flex="1" wordBreak="break-all">
				{entry.message}
			</Text>
		</HStack>
	);
}

interface DebugLogDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function DebugLogDialog({
	isOpen,
	onClose,
}: DebugLogDialogProps) {
	const logs = useDebugLogStore((s) => s.logs);
	const clear = useDebugLogStore((s) => s.clear);
	const [search, setSearch] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const autoScrollRef = useRef(true);

	const filtered = useMemo(() => {
		if (!search) return logs;
		const lower = search.toLowerCase();
		return logs.filter(
			(e) =>
				e.message.toLowerCase().includes(lower) ||
				e.source.toLowerCase().includes(lower) ||
				e.level.toLowerCase().includes(lower),
		);
	}, [logs, search]);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		autoScrollRef.current = atBottom;
	}, []);

	useEffect(() => {
		if (autoScrollRef.current && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [filtered]);

	return (
		<Dialog.Root
			lazyMount
			size="lg"
			placement="center"
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop zIndex="max" />
				<Dialog.Positioner zIndex="max">
					<Dialog.Content
						overflow="hidden"
						display="flex"
						flexDirection="column"
						maxH="70vh"
					>
						<Dialog.Header py="2" px="4">
							<Dialog.Title fontSize="sm">
								{m.debugLog()}
							</Dialog.Title>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Header>

						<HStack px="4" pb="2" gap="2">
							<Input
								size="sm"
								placeholder={m.debugSearchPlaceholder()}
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								flex="1"
							/>
							<IconButton
								aria-label={m.debugClear()}
								size="sm"
								variant="ghost"
								onClick={clear}
							>
								<RiDeleteBinLine />
							</IconButton>
						</HStack>

						<Dialog.Body p="0" flex="1" overflow="hidden">
							<Box
								ref={scrollRef}
								overflowY="auto"
								h="full"
								onScroll={handleScroll}
							>
								<VStack gap="0" align="stretch">
									{filtered.length === 0 ? (
										<Flex
											align="center"
											justify="center"
											py="8"
										>
											<Text
												color="fg.muted"
												fontSize="sm"
											>
												{m.debugNoLogs()}
											</Text>
										</Flex>
									) : (
										filtered.map((entry) => (
											<LogRow
												key={entry.timestamp}
												entry={entry}
											/>
										))
									)}
								</VStack>
							</Box>
						</Dialog.Body>

						<Flex px="4" py="2" justify="end">
							<Text fontSize="xs" color="fg.muted">
								{filtered.length} /{logs.length}
							</Text>
						</Flex>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
