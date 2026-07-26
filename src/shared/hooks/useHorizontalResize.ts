import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

function clampWidth(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

interface UseHorizontalResizeOptions {
	value: number;
	min: number;
	max: number;
	step?: number;
	disabled?: boolean;
	onChange: (value: number) => void;
	onCommit?: (value: number) => void;
}

export function useHorizontalResize({
	value,
	min,
	max,
	step = 16,
	disabled = false,
	onChange,
	onCommit,
}: UseHorizontalResizeOptions) {
	const [isDragging, setIsDragging] = useState(false);
	const startXRef = useRef(0);
	const startValueRef = useRef(value);
	const valueRef = useRef(value);
	const lastAppliedRef = useRef(value);
	const onChangeRef = useRef(onChange);
	const onCommitRef = useRef(onCommit);
	const frameRef = useRef<number | null>(null);
	const pendingValueRef = useRef<number | null>(null);

	valueRef.current = value;
	onChangeRef.current = onChange;
	onCommitRef.current = onCommit;

	const applyValue = useCallback((nextValue: number) => {
		const clamped = clampWidth(nextValue, min, max);
		lastAppliedRef.current = clamped;
		onChangeRef.current(clamped);
	}, [max, min]);

	useEffect(() => {
		if (!isDragging) return;

		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		function flushPendingValue() {
			if (frameRef.current !== null) {
				cancelAnimationFrame(frameRef.current);
				frameRef.current = null;
			}
			if (pendingValueRef.current !== null) {
				applyValue(pendingValueRef.current);
				pendingValueRef.current = null;
			}
		}

		function handlePointerMove(event: PointerEvent) {
			const deltaX = event.clientX - startXRef.current;
			pendingValueRef.current = startValueRef.current + deltaX;
			if (frameRef.current !== null) return;
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = null;
				if (pendingValueRef.current === null) return;
				applyValue(pendingValueRef.current);
				pendingValueRef.current = null;
			});
		}

		function stopDragging() {
			flushPendingValue();
			setIsDragging(false);
			onCommitRef.current?.(lastAppliedRef.current);
		}

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", stopDragging);
		window.addEventListener("pointercancel", stopDragging);

		return () => {
			if (frameRef.current !== null) {
				cancelAnimationFrame(frameRef.current);
				frameRef.current = null;
			}
			pendingValueRef.current = null;
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", stopDragging);
			window.removeEventListener("pointercancel", stopDragging);
		};
	}, [applyValue, isDragging]);

	const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
		if (disabled || event.button !== 0) return;

		startXRef.current = event.clientX;
		startValueRef.current = valueRef.current;
		lastAppliedRef.current = valueRef.current;
		setIsDragging(true);
		event.preventDefault();
	}, [disabled]);

	const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
		if (disabled) return;

		switch (event.key) {
			case "ArrowLeft": {
				applyValue(valueRef.current - step);
				onCommitRef.current?.(lastAppliedRef.current);
				event.preventDefault();
				break;
			}
			case "ArrowRight": {
				applyValue(valueRef.current + step);
				onCommitRef.current?.(lastAppliedRef.current);
				event.preventDefault();
				break;
			}
			case "Home": {
				applyValue(min);
				onCommitRef.current?.(lastAppliedRef.current);
				event.preventDefault();
				break;
			}
			case "End": {
				applyValue(max);
				onCommitRef.current?.(lastAppliedRef.current);
				event.preventDefault();
				break;
			}
		}
	}, [applyValue, disabled, max, min, step]);

	return useMemo(
		() => ({
			isDragging,
			handlePointerDown,
			handleKeyDown,
		}),
		[handleKeyDown, handlePointerDown, isDragging],
	);
}
