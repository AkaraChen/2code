import type { Terminal as XTerm } from "@xterm/xterm";

const DEFAULT_FONT_LOAD_TIMEOUT_MS = 2000;

interface FontReadyTarget {
	fontFamily: string;
	fontSize: number;
	timeoutMs?: number;
}

async function waitForFontReady({
	fontFamily,
	fontSize,
	timeoutMs = DEFAULT_FONT_LOAD_TIMEOUT_MS,
}: FontReadyTarget): Promise<void> {
	if (typeof document === "undefined") return;
	const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
	if (!fonts || typeof fonts.load !== "function") return;

	const spec = `${fontSize}px ${fontFamily}`;

	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	const timeoutPromise = new Promise<void>((resolve) => {
		timeoutId = setTimeout(resolve, timeoutMs);
	});

	try {
		await Promise.race([
			Promise.resolve(fonts.load(spec)).then(() => {}),
			timeoutPromise,
		]);
	} catch {
		// Swallow — caller still refits even if the load promise rejected
	} finally {
		if (timeoutId !== null) clearTimeout(timeoutId);
	}
}

export function scheduleFontSettleRefit(
	terminal: XTerm,
	isAlive: () => boolean,
	refit: () => boolean,
	onDimensionsChanged?: () => void,
): void {
	const fontFamily = String(terminal.options.fontFamily ?? "").trim();
	if (!fontFamily) return;
	const fontSize = Number(terminal.options.fontSize ?? 13);

	void waitForFontReady({ fontFamily, fontSize }).then(() => {
		if (!isAlive()) return;
		const changed = refit();
		if (changed) onDimensionsChanged?.();
	});
}
