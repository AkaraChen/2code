/**
 * Canvas contexts that can actually see locally installed fonts.
 *
 * WebKit only resolves system-installed font families for canvases attached to
 * the document. A detached `document.createElement("canvas")` — and every
 * `OffscreenCanvas` — measures against a different, fallback-only font
 * environment. Measured on macOS WKWebView with SarasaNZSSlab NFM at 14px:
 *
 *   detached / offscreen : 8.401px   (fallback, 0.6 em)
 *   attached / DOM       : 7.000px   (the real font, 0.5 em)
 *
 * Every measurement in this feature therefore goes through an attached canvas.
 */

const HOST_ID = "2code-font-metrics-host";

function getHost(): HTMLElement | null {
	if (typeof document === "undefined" || !document.body) return null;

	const existing = document.getElementById(HOST_ID);
	if (existing instanceof HTMLElement) return existing;

	const host = document.createElement("div");
	host.id = HOST_ID;
	host.setAttribute("aria-hidden", "true");
	// Must stay rendered — `display: none` would take it out of layout and
	// defeats the purpose of attaching it.
	host.style.position = "absolute";
	host.style.top = "0";
	host.style.left = "-9999px";
	host.style.width = "1px";
	host.style.height = "1px";
	host.style.overflow = "hidden";
	host.style.visibility = "hidden";
	host.style.pointerEvents = "none";
	document.body.appendChild(host);
	return host;
}

export interface AttachedContext {
	ctx: CanvasRenderingContext2D;
	dispose: () => void;
}

/** A dedicated attached context, for callers that keep font state on it. */
export function createAttachedContext(): AttachedContext | null {
	const host = getHost();
	if (!host) return null;

	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	host.appendChild(canvas);

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		canvas.remove();
		return null;
	}
	return { ctx, dispose: () => canvas.remove() };
}

let shared: AttachedContext | null | undefined;

/** Shared attached context for one-off measurements. */
export function getSharedAttachedContext(): CanvasRenderingContext2D | null {
	if (shared === undefined) shared = createAttachedContext();
	return shared?.ctx ?? null;
}

/** Drops the shared context. Test seam only. */
export function resetSharedAttachedContext(): void {
	shared?.dispose();
	shared = undefined;
}
