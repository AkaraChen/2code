import { useDeferredValue, useMemo, useState } from "react";
import type {
	ChangeEvent,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";

const LINE_BREAK_PATTERN = /\r\n|\r|\n/;

export interface SearchMatch {
	columnIndex: number;
	lineNumber: number;
}

export interface SearchShortcutEvent {
	altKey: boolean;
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
	shiftKey: boolean;
}

export function isSearchShortcut(event: SearchShortcutEvent) {
	return (
		(event.metaKey || event.ctrlKey) &&
		!event.altKey &&
		!event.shiftKey &&
		event.key.toLowerCase() === "f"
	);
}

export function findSearchMatches(content: string, query: string): SearchMatch[] {
	if (!query) return [];

	const normalizedQuery = query.toLocaleLowerCase();
	const lines = content.split(LINE_BREAK_PATTERN);
	const matches: SearchMatch[] = [];

	for (const [index, line] of lines.entries()) {
		const normalizedLine = line.toLocaleLowerCase();
		let searchFrom = 0;

		while (searchFrom <= normalizedLine.length) {
			const matchIndex = normalizedLine.indexOf(
				normalizedQuery,
				searchFrom,
			);
			if (matchIndex === -1) break;

			matches.push({
				columnIndex: matchIndex,
				lineNumber: index + 1,
			});
			searchFrom = matchIndex + normalizedQuery.length;
		}
	}

	return matches;
}

export function useSearch(content: string) {
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchFocusRequest, setSearchFocusRequest] = useState(0);
	const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
	const deferredSearchQuery = useDeferredValue(searchQuery);

	const matches = useMemo(
		() => findSearchMatches(content, deferredSearchQuery),
		[content, deferredSearchQuery],
	);
	const matchedLineNumbers = useMemo(
		() => new Set(matches.map((match) => match.lineNumber)),
		[matches],
	);
	const effectiveCurrentMatchIndex =
		matches.length === 0
			? 0
			: Math.min(currentMatchIndex, matches.length - 1);
	const currentMatch = matches[effectiveCurrentMatchIndex] ?? null;
	const currentMatchLine = currentMatch?.lineNumber ?? null;
	const matchLabel = deferredSearchQuery
		? `${matches.length === 0 ? 0 : effectiveCurrentMatchIndex + 1}/${matches.length}`
		: "0/0";

	function handleOpenSearch() {
		setIsSearchOpen(true);
		setSearchFocusRequest((request) => request + 1);
	}

	function handleCloseSearch() {
		setIsSearchOpen(false);
		setSearchQuery("");
		setCurrentMatchIndex(0);
	}

	function handleNextMatch() {
		if (matches.length === 0) return;
		setCurrentMatchIndex((index) => {
			const safeIndex = Math.min(index, matches.length - 1);
			return (safeIndex + 1) % matches.length;
		});
	}

	function handlePreviousMatch() {
		if (matches.length === 0) return;
		setCurrentMatchIndex((index) => {
			const safeIndex = Math.min(index, matches.length - 1);
			return (safeIndex - 1 + matches.length) % matches.length;
		});
	}

	function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
		setSearchQuery(event.target.value);
		setCurrentMatchIndex(0);
	}

	function handleSearchInputKeyDown(
		event: ReactKeyboardEvent<HTMLInputElement>,
	) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			handleCloseSearch();
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			if (event.shiftKey) {
				handlePreviousMatch();
			} else {
				handleNextMatch();
			}
			return;
		}

		if (isSearchShortcut(event)) {
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.select();
		}
	}

	return {
		currentMatch,
		currentMatchIndex: effectiveCurrentMatchIndex,
		currentMatchLine,
		handleCloseSearch,
		handleNextMatch,
		handleOpenSearch,
		handlePreviousMatch,
		handleSearchChange,
		handleSearchInputKeyDown,
		isSearchOpen,
		matchLabel,
		matchedLineNumbers,
		matches,
		searchFocusRequest,
		searchQuery,
	};
}
