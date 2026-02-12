import { useCallback, useRef, useState } from "react";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Manages an index for keyboard-driven list navigation (ArrowUp / ArrowDown).
 *
 * Returns `[index, setIndex, countRef, onKeyDown]`.
 * - Attach `countRef.current = items.length` in the render of the list component.
 * - Attach `onKeyDown` to the container that should capture arrow keys.
 * - The handler calls `e.preventDefault()` only when it consumes the event.
 */
export function useListKeyNav(initialIndex = 0) {
	const [index, setIndex] = useState(initialIndex);
	const countRef = useRef(0);

	const onKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
			e.preventDefault();
			const delta = e.key === "ArrowDown" ? 1 : -1;
			setIndex((prev) => clamp(prev + delta, 0, countRef.current - 1));
		},
		[],
	);

	return [index, setIndex, countRef, onKeyDown] as const;
}
