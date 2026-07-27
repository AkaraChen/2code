import type { Terminal as XTerm } from "@xterm/xterm";
import { getPrimaryFontFamily } from "./appearance";
import { forceCharSizeRemeasure, isCellWidthStale } from "./charSize";

const DEFAULT_FONT_LOAD_TIMEOUT_MS = 2000;
/** Frames to keep re-measuring while the metrics still look wrong. */
const MAX_SETTLE_ATTEMPTS = 12;

interface FontReadyTarget {
	fontFamily: string;
	fontSize: number;
	timeoutMs?: number;
}

function quoteFamily(family: string): string {
	return /^[\w-]+$/.test(family) ? family : `"${family.replace(/"/g, '\\"')}"`;
}

async function waitForFontReady({
	fontFamily,
	fontSize,
	timeoutMs = DEFAULT_FONT_LOAD_TIMEOUT_MS,
}: FontReadyTarget): Promise<void> {
	if (typeof document === "undefined") return;
	const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
	if (!fonts || typeof fonts.load !== "function") return;

	// Load only the primary family: a stack containing generic fallbacks always
	// resolves immediately, which is why waiting on the whole stack never
	// actually waited for the font we care about.
	const spec = `${fontSize}px ${quoteFamily(fontFamily)}`;

	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<void>((resolve) => {
		timeoutId = setTimeout(resolve, timeoutMs);
	});

	try {
		await Promise.race([
			Promise.all([
				Promise.resolve(fonts.load(spec)),
				fonts.ready ?? Promise.resolve(),
			]).then(() => {}),
			timeoutPromise,
		]);
	} catch {
		// Swallow — caller still refits even if the load promise rejected
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => resolve());
		} else {
			setTimeout(resolve, 16);
		}
	});
}

/**
 * Keep re-measuring until xterm's cell width agrees with the real font.
 *
 * `document.fonts` only tracks `@font-face` fonts, so for a locally installed
 * font it resolves instantly and tells us nothing. The metrics comparison is
 * the reliable signal: poll a few frames until the measured cell width matches
 * the font's actual advance.
 */
async function settleCharSize(
	terminal: XTerm,
	isAlive: () => boolean,
): Promise<void> {
	for (let attempt = 0; attempt < MAX_SETTLE_ATTEMPTS; attempt++) {
		if (!isAlive()) return;
		if (!isCellWidthStale(terminal)) return;
		forceCharSizeRemeasure(terminal);
		if (!isCellWidthStale(terminal)) return;
		await nextFrame();
	}
}

export function scheduleFontSettleRefit(
	terminal: XTerm,
	isAlive: () => boolean,
	refit: () => boolean,
	onDimensionsChanged?: () => void,
): void {
	const fontStack = String(terminal.options.fontFamily ?? "").trim();
	if (!fontStack) return;
	const primary = getPrimaryFontFamily(fontStack);
	if (!primary) return;
	const fontSize = Number(terminal.options.fontSize ?? 13);

	void waitForFontReady({ fontFamily: primary, fontSize })
		.then(() => settleCharSize(terminal, isAlive))
		.then(() => {
			if (!isAlive()) return;
			const changed = refit();
			if (changed) onDimensionsChanged?.();
		});
}
