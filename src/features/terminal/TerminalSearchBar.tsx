import { CaretDownIcon, CaretUpIcon, XIcon } from "@phosphor-icons/react";
import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as m from "@/paraglide/messages.js";

const SEARCH_OPTIONS = {
	decorations: {
		matchBackground: "#5f4b16",
		matchOverviewRuler: "#c28f2c",
		activeMatchBackground: "#1f6feb",
		activeMatchColorOverviewRuler: "#58a6ff",
	},
	incremental: true,
};

interface SearchResult {
	resultIndex: number;
	resultCount: number;
}

interface TerminalSearchBarProps {
	searchAddon: SearchAddon;
	onClose: () => void;
}

export function TerminalSearchBar({
	searchAddon,
	onClose,
}: TerminalSearchBarProps) {
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<SearchResult>({
		resultIndex: -1,
		resultCount: 0,
	});

	useEffect(() => {
		const disposable = searchAddon.onDidChangeResults(setResult);
		return () => disposable.dispose();
	}, [searchAddon]);

	function searchNext(value = query) {
		if (!value) {
			searchAddon.clearDecorations();
			setResult({ resultIndex: -1, resultCount: 0 });
			return;
		}
		searchAddon.findNext(value, SEARCH_OPTIONS);
	}

	function searchPrevious() {
		if (!query) return;
		searchAddon.findPrevious(query, SEARCH_OPTIONS);
	}

	function close() {
		searchAddon.clearDecorations();
		onClose();
	}

	const resultText =
		query && result.resultCount === 0
			? m.terminalSearchNoResults()
			: result.resultCount > 0
				? `${result.resultIndex + 1}/${result.resultCount}`
				: "";

	return (
		<div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
			<Input
				autoFocus
				aria-label={m.terminalSearchPlaceholder()}
				className="h-7 w-56"
				placeholder={m.terminalSearchPlaceholder()}
				value={query}
				onChange={(event) => {
					const value = event.target.value;
					setQuery(value);
					searchNext(value);
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						close();
						return;
					}
					if (event.key !== "Enter") return;
					event.preventDefault();
					if (event.shiftKey) {
						searchPrevious();
					} else {
						searchNext();
					}
				}}
			/>
			<span className="min-w-12 text-center text-xs text-muted-foreground">
				{resultText}
			</span>
			<Button
				type="button"
				aria-label={m.terminalSearchPrevious()}
				size="icon-xs"
				variant="ghost"
				onClick={searchPrevious}
			>
				<CaretUpIcon weight="regular" />
			</Button>
			<Button
				type="button"
				aria-label={m.terminalSearchNext()}
				size="icon-xs"
				variant="ghost"
				onClick={() => searchNext()}
			>
				<CaretDownIcon weight="regular" />
			</Button>
			<Button
				type="button"
				aria-label={m.terminalSearchClose()}
				size="icon-xs"
				variant="ghost"
				onClick={close}
			>
				<XIcon />
			</Button>
		</div>
	);
}
