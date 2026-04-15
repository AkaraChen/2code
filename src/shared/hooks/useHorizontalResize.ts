import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
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
}

export function useHorizontalResize({
	value,
	min,
	max,
	step = 16,
	disabled = false,
	onChange,
}: UseHorizontalResizeOptions) {
	const [isDragging, setIsDragging] = useState(false);
	const startXRef = useRef(0);
	const startValueRef = useRef(value);
	const valueRef = useRef(value);
	const onChangeRef = useRef(onChange);

	valueRef.current = value;
	onChangeRef.current = onChange;

	const applyValue = useCallback((nextValue: number) => {
		onChangeRef.current(clampWidth(nextValue, min, max));
	}, [max, min]);

	useEffect(() => {
		if (!isDragging) return;

		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";

		function handlePointerMove(event: PointerEvent) {
			const deltaX = event.clientX - startXRef.current;
			applyValue(startValueRef.current + deltaX);
		}

		function stopDragging() {
			setIsDragging(false);
		}

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", stopDragging);
		window.addEventListener("pointercancel", stopDragging);

		return () => {
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", stopDragging);
			window.removeEventListener("pointercancel", stopDragging);
		};
	}, [applyValue, isDragging]);

	function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
		if (disabled || event.button !== 0) return;

		startXRef.current = event.clientX;
		startValueRef.current = valueRef.current;
		setIsDragging(true);
		event.preventDefault();
	}

	function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
		if (disabled) return;

		switch (event.key) {
			case "ArrowLeft": {
				applyValue(valueRef.current - step);
				event.preventDefault();
				break;
			}
			case "ArrowRight": {
				applyValue(valueRef.current + step);
				event.preventDefault();
				break;
			}
			case "Home": {
				applyValue(min);
				event.preventDefault();
				break;
			}
			case "End": {
				applyValue(max);
				event.preventDefault();
				break;
			}
		}
	}

	return {
		isDragging,
		handlePointerDown,
		handleKeyDown,
	};
}
