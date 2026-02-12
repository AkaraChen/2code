import { useEffect, useRef } from "react";

/**
 * Scrolls the child element matching `[data-index="${index}"]` into view
 * whenever `index` changes.
 *
 * Returns `{ ref }` — attach it to the scrollable container.
 */
export function useScrollIntoView<T extends HTMLElement = HTMLElement>(
	index: number,
) {
	const ref = useRef<T>(null);

	useEffect(() => {
		const el = ref.current?.querySelector(`[data-index="${index}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [index]);

	return { ref };
}
