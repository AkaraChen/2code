export type HerdrScrollDirection = "up" | "down";
export type HerdrScrollSource = "wheel" | "pageKey";

export interface HerdrScrollCommand {
	direction: HerdrScrollDirection;
	lines: number;
	source: HerdrScrollSource;
}

export const HERDR_WHEEL_LINE_PX = 40;

function clampScrollLines(lines: number): number {
	return Math.min(65535, Math.max(1, Math.round(lines)));
}

/**
 * Wheel → attached CLI `terminal.scroll`. `lines` is always > 0.
 * Live history is not a pane snapshot read.
 */
export function herdrWheelScroll(event: {
	deltaY: number;
	deltaMode?: number;
}): HerdrScrollCommand | null {
	if (!Number.isFinite(event.deltaY) || event.deltaY === 0) {
		return null;
	}

	const magnitude = Math.abs(event.deltaY);
	const lines =
		event.deltaMode === 1
			? magnitude
			: event.deltaMode === 2
				? magnitude * 24
				: magnitude / HERDR_WHEEL_LINE_PX;

	return {
		direction: event.deltaY < 0 ? "up" : "down",
		lines: clampScrollLines(lines),
		source: "wheel",
	};
}

export function herdrPageScroll(
	key: string,
	rows: number,
): HerdrScrollCommand | null {
	if (key !== "PageUp" && key !== "PageDown") {
		return null;
	}
	return {
		direction: key === "PageUp" ? "up" : "down",
		lines: clampScrollLines(rows),
		source: "pageKey",
	};
}
