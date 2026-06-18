import type { ITheme } from "@xterm/xterm";

export interface TerminalAppearance {
	theme: ITheme;
	background: string;
	fontFamily: string;
	fontSize: number;
}

export const TERMINAL_FONT_FAMILY_CSS_VARIABLE =
	"--terminal-font-family";

export function applyTerminalFontFamilyCssVariable(
	element: HTMLElement,
	fontFamily: string,
): void {
	element.style.setProperty(TERMINAL_FONT_FAMILY_CSS_VARIABLE, fontFamily);
}

const GENERIC_FONT_FAMILIES = new Set([
	"serif",
	"sans-serif",
	"monospace",
	"cursive",
	"fantasy",
	"system-ui",
	"ui-serif",
	"ui-sans-serif",
	"ui-monospace",
	"ui-rounded",
	"emoji",
	"math",
	"fangsong",
]);

function serializeFontFamilyList(families: string[]): string {
	return families
		.map((family) =>
			GENERIC_FONT_FAMILIES.has(family)
				? family
				: `"${family.replace(/"/g, '\\"')}"`,
		)
		.join(", ");
}

export const DEFAULT_TERMINAL_FONT_FAMILIES = [
	"JetBrains Mono",
	"JetBrainsMono Nerd Font",
	"MesloLGM Nerd Font",
	"MesloLGM NF",
	"MesloLGS NF",
	"MesloLGS Nerd Font",
	"Hack Nerd Font",
	"FiraCode Nerd Font",
	"CaskaydiaCove Nerd Font",
	"Menlo",
	"Monaco",
	"Courier New",
	"monospace",
] as const;

export const DEFAULT_TERMINAL_FONT_FAMILY = serializeFontFamilyList([
	...DEFAULT_TERMINAL_FONT_FAMILIES,
]);

export const DEFAULT_TERMINAL_FONT_SIZE = 13;

const MONOSPACE_GENERIC_FAMILIES = new Set(["monospace", "ui-monospace"]);

function parseFontFamilyList(cssValue: string): string[] {
	const families: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (const ch of cssValue) {
		if (inQuote) {
			if (ch === inQuote) inQuote = null;
			else current += ch;
		} else if (ch === '"' || ch === "'") {
			inQuote = ch;
		} else if (ch === ",") {
			const trimmed = current.trim();
			if (trimmed) families.push(trimmed);
			current = "";
		} else {
			current += ch;
		}
	}
	const last = current.trim();
	if (last) families.push(last);
	return families;
}

const monospaceCheckCache = new Map<string, boolean>();

function isFontFamilyMonospace(family: string): boolean {
	const key = family.toLowerCase();
	if (MONOSPACE_GENERIC_FAMILIES.has(key)) return true;

	const cached = monospaceCheckCache.get(key);
	if (cached !== undefined) return cached;

	try {
		if (typeof document === "undefined") return true;
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext?.("2d");
		if (!ctx) return true;

		ctx.font = `16px "${family}"`;
		const narrow = ctx.measureText("iiiiii").width;
		const wide = ctx.measureText("MMMMMM").width;
		const isMono = Math.abs(narrow - wide) < 1;
		monospaceCheckCache.set(key, isMono);
		return isMono;
	} catch {
		return true;
	}
}

export function sanitizeTerminalFontFamily(
	cssValue: string | null | undefined,
): string {
	if (!cssValue || !cssValue.trim()) return DEFAULT_TERMINAL_FONT_FAMILY;
	const families = parseFontFamilyList(cssValue);
	if (families.length === 0) return DEFAULT_TERMINAL_FONT_FAMILY;

	const primary = families[0];
	const primaryKey = primary.toLowerCase();

	if (GENERIC_FONT_FAMILIES.has(primaryKey)) {
		if (MONOSPACE_GENERIC_FAMILIES.has(primaryKey)) {
			return serializeFontFamilyList(families);
		}
		console.warn(
			`[terminal] Font stack "${cssValue}" has no monospace primary family; falling back to default terminal font.`,
		);
		return DEFAULT_TERMINAL_FONT_FAMILY;
	}

	if (!isFontFamilyMonospace(primary)) {
		console.warn(
			`[terminal] Font "${primary}" is not monospace; falling back to default terminal font.`,
		);
		return DEFAULT_TERMINAL_FONT_FAMILY;
	}

	const hasMonoTail = families.some((f) =>
		MONOSPACE_GENERIC_FAMILIES.has(f.toLowerCase()),
	);
	const result = hasMonoTail ? families : [...families, "monospace"];
	return serializeFontFamilyList(result);
}

export function buildFontFamilyCss(family: string): string {
	const sanitized = sanitizeTerminalFontFamily(family);
	return sanitized;
}
