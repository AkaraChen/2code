// Phase 3 task #33: composable log filters.
//
// Five inputs in a single horizontal bar:
//   - Branch (text input — empty = HEAD)
//   - Author substring
//   - Path filter
//   - Subject text search (--grep)
//   - Content search (-G regex)
//
// All text inputs debounced 250ms so typing doesn't fire a query per
// keystroke. Date pickers (since/until) are intentionally text inputs
// here — they accept ISO dates OR git relative ("2 weeks ago") so users
// can type whichever feels natural.

import {
	Box,
	Flex,
	HStack,
	IconButton,
	Input,
	Spinner,
	Text,
	Tooltip,
	Portal,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiFilter, FiX } from "react-icons/fi";

import type { LogFilter } from "./changesTabBindings";

interface LogFiltersBarProps {
	value: LogFilter;
	onChange: (next: LogFilter) => void;
	loading: boolean;
}

const DEBOUNCE_MS = 250;

export default function LogFiltersBar({
	value,
	onChange,
	loading,
}: LogFiltersBarProps) {
	const [expanded, setExpanded] = useState(false);
	// Local mirror of the filter so debounced inputs feel snappy.
	const [draft, setDraft] = useState<LogFilter>(value);

	useEffect(() => {
		setDraft(value);
	}, [value]);

	// Push the draft up after a debounce. Skip when the draft already equals
	// the parent value (no-op) to avoid re-render loops.
	useEffect(() => {
		const equal =
			(draft.branch ?? "") === (value.branch ?? "") &&
			(draft.author ?? "") === (value.author ?? "") &&
			(draft.path ?? "") === (value.path ?? "") &&
			(draft.text_query ?? "") === (value.text_query ?? "") &&
			(draft.content_query ?? "") === (value.content_query ?? "") &&
			(draft.since ?? "") === (value.since ?? "") &&
			(draft.until ?? "") === (value.until ?? "");
		if (equal) return;
		const id = window.setTimeout(() => {
			onChange(draft);
		}, DEBOUNCE_MS);
		return () => window.clearTimeout(id);
	}, [draft, value, onChange]);

	const updateField = useCallback(
		<K extends keyof LogFilter>(key: K, v: string) => {
			setDraft((prev) => ({
				...prev,
				[key]: v.trim() === "" ? null : v,
			}));
		},
		[],
	);

	const activeCount = useMemo(() => {
		let n = 0;
		if (draft.branch) n++;
		if (draft.author) n++;
		if (draft.path) n++;
		if (draft.text_query) n++;
		if (draft.content_query) n++;
		if (draft.since) n++;
		if (draft.until) n++;
		return n;
	}, [draft]);

	const clearAll = useCallback(() => {
		setDraft({});
	}, []);

	return (
		<Box
			borderBottomWidth="1px"
			borderColor="border.subtle"
			flexShrink={0}
		>
			<HStack gap="2" px="2" py="1.5">
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<IconButton
							aria-label="Toggle filters"
							size="2xs"
							variant={expanded ? "solid" : "ghost"}
							onClick={() => setExpanded((v) => !v)}
						>
							<FiFilter />
						</IconButton>
					</Tooltip.Trigger>
					<Portal>
						<Tooltip.Positioner>
							<Tooltip.Content>
								{activeCount > 0
									? `${activeCount} filter${activeCount === 1 ? "" : "s"} active`
									: "Filters"}
							</Tooltip.Content>
						</Tooltip.Positioner>
					</Portal>
				</Tooltip.Root>

				<Input
					size="xs"
					placeholder="Search messages…"
					value={draft.text_query ?? ""}
					onChange={(e) => updateField("text_query", e.target.value)}
					flex="1"
				/>

				{loading && <Spinner size="xs" />}

				{activeCount > 0 && (
					<Tooltip.Root>
						<Tooltip.Trigger asChild>
							<IconButton
								aria-label="Clear all filters"
								size="2xs"
								variant="ghost"
								onClick={clearAll}
							>
								<FiX />
							</IconButton>
						</Tooltip.Trigger>
						<Portal>
							<Tooltip.Positioner>
								<Tooltip.Content>Clear filters</Tooltip.Content>
							</Tooltip.Positioner>
						</Portal>
					</Tooltip.Root>
				)}
			</HStack>

			{expanded && (
				<Flex
					direction="column"
					gap="2"
					px="2"
					pb="2"
					borderTopWidth="1px"
					borderColor="border.subtle"
				>
					<FilterField label="Branch / ref">
						<Input
							size="xs"
							placeholder="HEAD"
							value={draft.branch ?? ""}
							onChange={(e) =>
								updateField("branch", e.target.value)
							}
						/>
					</FilterField>
					<FilterField label="Author">
						<Input
							size="xs"
							placeholder="name or email substring"
							value={draft.author ?? ""}
							onChange={(e) =>
								updateField("author", e.target.value)
							}
						/>
					</FilterField>
					<FilterField label="Path">
						<Input
							size="xs"
							placeholder="src/foo or *.rs"
							value={draft.path ?? ""}
							onChange={(e) =>
								updateField("path", e.target.value)
							}
						/>
					</FilterField>
					<HStack gap="2">
						<FilterField label="Since">
							<Input
								size="xs"
								placeholder="2026-01-01 or '2 weeks ago'"
								value={draft.since ?? ""}
								onChange={(e) =>
									updateField("since", e.target.value)
								}
							/>
						</FilterField>
						<FilterField label="Until">
							<Input
								size="xs"
								placeholder="optional"
								value={draft.until ?? ""}
								onChange={(e) =>
									updateField("until", e.target.value)
								}
							/>
						</FilterField>
					</HStack>
					<FilterField label="Diff content (-G regex)">
						<Input
							size="xs"
							placeholder="match added/removed lines"
							value={draft.content_query ?? ""}
							onChange={(e) =>
								updateField("content_query", e.target.value)
							}
						/>
					</FilterField>
				</Flex>
			)}
		</Box>
	);
}

function FilterField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<Box flex="1">
			<Text fontSize="2xs" color="fg.muted" mb="0.5">
				{label}
			</Text>
			{children}
		</Box>
	);
}
